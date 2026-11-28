//! A small DNS client: one question over UDP, again over TCP when the answer
//! is too big for UDP, and the records of the asked type read out as text.
//! Written here rather than added as a library because a check needs only
//! this much, and the operating system's own lookup answers A and AAAA only.
//!
//! The server asked is the one the user typed, or the first in
//! /etc/resolv.conf, which macOS and Linux keep pointed at the servers the
//! network gave them. Windows has no such file, so there an A or AAAA check
//! with no server goes through the system lookup instead, and the other types
//! ask the user for a server.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

pub fn type_code(name: &str) -> Option<u16> {
    Some(match name {
        "A" => 1,
        "NS" => 2,
        "CNAME" => 5,
        "MX" => 15,
        "TXT" => 16,
        "AAAA" => 28,
        "CAA" => 257,
        _ => return None,
    })
}

/// What the server said.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// 0 is an answer, 2 a server failure, 3 a name that doesn't exist.
    pub rcode: u8,
    pub records: Vec<String>,
    pub truncated: bool,
}

pub fn rcode_name(rcode: u8) -> &'static str {
    match rcode {
        1 => "FORMERR",
        2 => "SERVFAIL",
        3 => "NXDOMAIN",
        4 => "NOTIMP",
        5 => "REFUSED",
        _ => "an error",
    }
}

/// The question as bytes: a header asking for recursion, then the name.
pub fn query(id: u16, name: &str, qtype: u16) -> Result<Vec<u8>, String> {
    let mut packet = Vec::with_capacity(32 + name.len());
    packet.extend_from_slice(&id.to_be_bytes());
    // Recursion desired, one question.
    packet.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for label in name.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err(format!("{name} isn't a domain name"));
        }
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    packet.push(0);
    packet.extend_from_slice(&qtype.to_be_bytes());
    packet.extend_from_slice(&1u16.to_be_bytes());
    Ok(packet)
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Option<u8> {
        let value = *self.data.get(self.at)?;
        self.at += 1;
        Some(value)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes([self.u8()?, self.u8()?]))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes([self.u8()?, self.u8()?, self.u8()?, self.u8()?]))
    }
    fn bytes(&mut self, count: usize) -> Option<&'a [u8]> {
        let slice = self.data.get(self.at..self.at.checked_add(count)?)?;
        self.at += count;
        Some(slice)
    }
}

/// A name, following compression pointers. Pointers may only point back, so
/// a loop in a broken packet ends.
fn name_at(data: &[u8], start: usize) -> Option<(String, usize)> {
    let mut labels: Vec<String> = Vec::new();
    let mut at = start;
    let mut end = None;
    let mut jumps = 0;
    loop {
        let length = *data.get(at)? as usize;
        if length & 0xC0 == 0xC0 {
            let pointer = ((length & 0x3F) << 8) | *data.get(at + 1)? as usize;
            if end.is_none() {
                end = Some(at + 2);
            }
            if pointer >= at || jumps > 32 {
                return None;
            }
            jumps += 1;
            at = pointer;
            continue;
        }
        if length == 0 {
            let end = end.unwrap_or(at + 1);
            return Some((labels.join(".").to_lowercase(), end));
        }
        let label = data.get(at + 1..at + 1 + length)?;
        labels.push(String::from_utf8_lossy(label).into_owned());
        at += 1 + length;
        if labels.len() > 127 {
            return None;
        }
    }
}

fn character_strings(mut data: &[u8]) -> String {
    let mut text = String::new();
    while let Some((&length, rest)) = data.split_first() {
        let length = (length as usize).min(rest.len());
        text.push_str(&String::from_utf8_lossy(&rest[..length]));
        data = &rest[length..];
    }
    text
}

/// The records of `qtype` in an answer to the question with `id`.
pub fn parse(packet: &[u8], id: u16, qtype: u16) -> Result<Answer, String> {
    let broken = || "The DNS server's answer couldn't be read".to_string();
    let mut reader = Reader { data: packet, at: 0 };
    if reader.u16().ok_or_else(broken)? != id {
        return Err("The DNS answer was for another question".into());
    }
    let flags = reader.u16().ok_or_else(broken)?;
    if flags & 0x8000 == 0 {
        return Err(broken());
    }
    let truncated = flags & 0x0200 != 0;
    let rcode = (flags & 0x000F) as u8;
    let questions = reader.u16().ok_or_else(broken)?;
    let answers = reader.u16().ok_or_else(broken)?;
    reader.u16().ok_or_else(broken)?;
    reader.u16().ok_or_else(broken)?;
    for _ in 0..questions {
        let (_, end) = name_at(packet, reader.at).ok_or_else(broken)?;
        reader.at = end;
        reader.u16().ok_or_else(broken)?;
        reader.u16().ok_or_else(broken)?;
    }
    let mut records = Vec::new();
    for _ in 0..answers {
        let (_, end) = name_at(packet, reader.at).ok_or_else(broken)?;
        reader.at = end;
        let kind = reader.u16().ok_or_else(broken)?;
        let _class = reader.u16().ok_or_else(broken)?;
        let _ttl = reader.u32().ok_or_else(broken)?;
        let length = reader.u16().ok_or_else(broken)? as usize;
        let start = reader.at;
        let data = reader.bytes(length).ok_or_else(broken)?;
        if kind != qtype {
            continue;
        }
        let text = match kind {
            1 if data.len() == 4 => Ipv4Addr::new(data[0], data[1], data[2], data[3]).to_string(),
            28 if data.len() == 16 => {
                let mut octets = [0u8; 16];
                octets.copy_from_slice(data);
                Ipv6Addr::from(octets).to_string()
            }
            2 | 5 => name_at(packet, start).ok_or_else(broken)?.0,
            15 if data.len() > 2 => {
                let preference = u16::from_be_bytes([data[0], data[1]]);
                format!("{preference} {}", name_at(packet, start + 2).ok_or_else(broken)?.0)
            }
            16 => character_strings(data),
            257 if data.len() > 2 => {
                let flags = data[0];
                let tag_length = (data[1] as usize).min(data.len() - 2);
                let tag = String::from_utf8_lossy(&data[2..2 + tag_length]);
                let value = String::from_utf8_lossy(&data[2 + tag_length..]);
                format!("{flags} {tag} \"{value}\"")
            }
            _ => continue,
        };
        records.push(text);
    }
    Ok(Answer { rcode, records, truncated })
}

/// The name servers this computer uses, from /etc/resolv.conf.
pub fn system_servers() -> Vec<SocketAddr> {
    #[cfg(unix)]
    {
        std::fs::read_to_string("/etc/resolv.conf").map(|text| servers_in(&text)).unwrap_or_default()
    }
    #[cfg(not(unix))]
    {
        Vec::new()
    }
}

pub fn servers_in(resolv_conf: &str) -> Vec<SocketAddr> {
    resolv_conf
        .lines()
        .filter_map(|line| line.trim().strip_prefix("nameserver"))
        .filter_map(|rest| {
            let address = rest.trim();
            // A link-local IPv6 server carries its interface (fe80::1%en0),
            // which an address can't hold here.
            address.split('%').next()?.parse::<IpAddr>().ok()
        })
        .map(|ip| SocketAddr::new(ip, 53))
        .take(3)
        .collect()
}

fn next_id() -> u16 {
    use std::sync::atomic::{AtomicU16, Ordering};
    static COUNTER: AtomicU16 = AtomicU16::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    (nanos as u16) ^ COUNTER.fetch_add(0x9E37, Ordering::Relaxed) ^ (std::process::id() as u16)
}

/// Ask one server, within `limit`.
pub fn ask(server: SocketAddr, name: &str, qtype: u16, limit: Duration) -> std::io::Result<Answer> {
    let started = Instant::now();
    let id = next_id();
    let packet = query(id, name, qtype).map_err(std::io::Error::other)?;
    let bind: SocketAddr = if server.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
    let socket = UdpSocket::bind(bind)?;
    socket.connect(server)?;
    socket.send(&packet)?;
    let mut buffer = [0u8; 4096];
    let answer = loop {
        let left = limit.checked_sub(started.elapsed()).filter(|left| !left.is_zero()).ok_or(std::io::ErrorKind::TimedOut)?;
        socket.set_read_timeout(Some(left))?;
        let size = match socket.recv(&mut buffer) {
            Ok(size) => size,
            Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock) => return Err(std::io::ErrorKind::TimedOut.into()),
            Err(error) => return Err(error),
        };
        // An answer to an earlier question that came late is skipped.
        match parse(&buffer[..size], id, qtype) {
            Ok(answer) => break answer,
            Err(_) if size >= 2 && u16::from_be_bytes([buffer[0], buffer[1]]) != id => continue,
            Err(message) => return Err(std::io::Error::other(message)),
        }
    };
    if !answer.truncated {
        return Ok(answer);
    }
    let left = limit.checked_sub(started.elapsed()).filter(|left| !left.is_zero()).ok_or(std::io::ErrorKind::TimedOut)?;
    let mut stream = TcpStream::connect_timeout(&server, left)?;
    stream.set_read_timeout(Some(left))?;
    stream.set_write_timeout(Some(left))?;
    let mut framed = (packet.len() as u16).to_be_bytes().to_vec();
    framed.extend_from_slice(&packet);
    stream.write_all(&framed)?;
    let mut length = [0u8; 2];
    stream.read_exact(&mut length)?;
    let mut reply = vec![0u8; u16::from_be_bytes(length) as usize];
    stream.read_exact(&mut reply)?;
    parse(&reply, id, qtype).map_err(std::io::Error::other)
}

/// An answer's record matches what the user expects when it says the same
/// thing, ignoring case, a final dot and the quotes round text. A mail
/// server matches with or without its preference number ("5 mx.example.com"
/// and "mx.example.com"), since people type the name.
pub fn matches(record: &str, expected: &str, contains: bool) -> bool {
    let clean = |text: &str| text.trim().trim_matches('"').trim_end_matches('.').to_lowercase();
    let record = clean(record);
    let expected = clean(expected);
    if contains {
        record.contains(&expected)
    } else if let Some((preference, name)) = record.split_once(' ').filter(|(number, _)| number.bytes().all(|b| b.is_ascii_digit())) {
        record == expected || (name == expected && !preference.is_empty())
    } else {
        record == expected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_query_is_laid_out_as_the_protocol_says() {
        let packet = query(0x1234, "example.com", 1).unwrap();
        assert_eq!(
            packet,
            vec![0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, 7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0, 1, 0, 1]
        );
        assert!(query(1, "a..b", 1).is_err());
    }

    /// A reply to "example.com A" with one CNAME and one A record, the second
    /// name compressed.
    fn reply(id: u16) -> Vec<u8> {
        let mut packet = vec![(id >> 8) as u8, id as u8, 0x81, 0x80, 0, 1, 0, 2, 0, 0, 0, 0];
        packet.extend_from_slice(&[7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0, 1, 0, 1]);
        // example.com CNAME www.example.com
        packet.extend_from_slice(&[0xC0, 12, 0, 5, 0, 1, 0, 0, 0, 60, 0, 6, 3, b'w', b'w', b'w', 0xC0, 12]);
        // www.example.com A 93.184.215.14 (the name points at the CNAME's data)
        packet.extend_from_slice(&[0xC0, 41, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 93, 184, 215, 14]);
        packet
    }

    #[test]
    fn answers_are_read_with_compressed_names() {
        let answer = parse(&reply(7), 7, 1).unwrap();
        assert_eq!(answer.rcode, 0);
        assert_eq!(answer.records, vec!["93.184.215.14".to_string()]);
        let names = parse(&reply(7), 7, 5).unwrap();
        assert_eq!(names.records, vec!["www.example.com".to_string()]);
        assert!(parse(&reply(7), 8, 1).is_err());
    }

    #[test]
    fn broken_packets_are_refused_not_followed() {
        let mut looped = reply(3);
        // The first answer's name points at itself.
        looped[29] = 0xC0;
        looped[30] = 29;
        assert!(parse(&looped, 3, 1).is_err());
        assert!(parse(&reply(3)[..20], 3, 1).is_err());
        assert!(parse(&[], 3, 1).is_err());
    }

    #[test]
    fn mx_txt_and_caa_records_read_as_text() {
        let mut packet = vec![0, 9, 0x81, 0x80, 0, 0, 0, 3, 0, 0, 0, 0];
        // MX 10 mail.x
        packet.extend_from_slice(&[1, b'x', 0, 0, 15, 0, 1, 0, 0, 0, 1, 0, 10, 0, 10, 4, b'm', b'a', b'i', b'l', 1, b'x', 0]);
        // TXT "v=spf1" "-all"
        packet.extend_from_slice(&[1, b'x', 0, 0, 16, 0, 1, 0, 0, 0, 1, 0, 12, 6, b'v', b'=', b's', b'p', b'f', b'1', 4, b'-', b'a', b'l', b'l']);
        // CAA 0 issue "le"
        packet.extend_from_slice(&[1, b'x', 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 9, 0, 5, b'i', b's', b's', b'u', b'e', b'l', b'e']);
        assert_eq!(parse(&packet, 9, 15).unwrap().records, vec!["10 mail.x".to_string()]);
        assert_eq!(parse(&packet, 9, 16).unwrap().records, vec!["v=spf1-all".to_string()]);
        assert_eq!(parse(&packet, 9, 257).unwrap().records, vec!["0 issue \"le\"".to_string()]);
    }

    #[test]
    fn a_missing_name_reads_as_nxdomain() {
        let packet = vec![0, 5, 0x81, 0x83, 0, 0, 0, 0, 0, 0, 0, 0];
        let answer = parse(&packet, 5, 1).unwrap();
        assert_eq!(answer.rcode, 3);
        assert!(answer.records.is_empty());
        assert_eq!(rcode_name(3), "NXDOMAIN");
    }

    #[test]
    fn resolv_conf_servers_are_found() {
        let text = "# comment\nnameserver 192.168.1.1\nnameserver fe80::1%en0\nnameserver 2001:4860:4860::8888\nsearch lan\n";
        assert_eq!(
            servers_in(text),
            vec![
                "192.168.1.1:53".parse::<SocketAddr>().unwrap(),
                "[fe80::1]:53".parse::<SocketAddr>().unwrap(),
                "[2001:4860:4860::8888]:53".parse::<SocketAddr>().unwrap()
            ]
        );
    }

    #[test]
    fn expected_values_match_loosely() {
        assert!(matches("www.example.com", "WWW.Example.com.", false));
        assert!(matches("\"v=spf1 include:_spf.google.com ~all\"", "include:_spf.google.com", true));
        assert!(!matches("1.2.3.4", "1.2.3.5", false));
        assert!(matches("5 gmail-smtp-in.l.google.com.", "gmail-smtp-in.l.google.com", false));
        assert!(matches("5 gmail-smtp-in.l.google.com", "5 gmail-smtp-in.l.google.com", false));
        assert!(!matches("5 gmail-smtp-in.l.google.com", "10 gmail-smtp-in.l.google.com", false));
        assert!(!matches("5 alt1.gmail-smtp-in.l.google.com", "gmail-smtp-in.l.google.com", false));
    }
}
