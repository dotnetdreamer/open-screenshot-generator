//! Ping: one ICMP echo request and the time until its reply.
//!
//! On macOS and Linux the app opens an ICMP datagram socket, the kind the
//! system's own ping uses, which needs no administrator rights (Linux allows
//! it for the groups in net.ipv4.ping_group_range, which covers every group
//! on the common desktops). std has no such socket, so it is opened with the
//! C library's socket() and then used as a UdpSocket, whose send_to and
//! recv_from are the same calls underneath. Windows runs its own ping.exe
//! with fixed arguments, the same way Capture runs adb.

use std::io;
use std::net::IpAddr;
use std::sync::atomic::AtomicU16;
use std::time::Duration;

pub fn echo(ip: IpAddr, limit: Duration) -> io::Result<Duration> {
    imp::echo(ip, limit)
}

static SEQUENCE: AtomicU16 = AtomicU16::new(1);

/// An echo request: type, code, checksum, identifier, sequence, then a
/// payload that says who sent it and when, so a reply is matched to it even
/// where Linux rewrites the identifier.
fn request(v6: bool, seq: u16) -> Vec<u8> {
    let mut packet = vec![if v6 { 128 } else { 8 }, 0, 0, 0];
    packet.extend_from_slice(&(std::process::id() as u16).to_be_bytes());
    packet.extend_from_slice(&seq.to_be_bytes());
    packet.extend_from_slice(b"osg-uptime");
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    packet.extend_from_slice(&stamp.to_be_bytes());
    packet.resize(8 + 32, 0);
    // The kernel fills in an ICMPv6 checksum, which covers the addresses.
    if !v6 {
        let sum = checksum(&packet);
        packet[2..4].copy_from_slice(&sum.to_be_bytes());
    }
    packet
}

fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    for pair in data.chunks(2) {
        let word = if pair.len() == 2 { u16::from_be_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], 0]) };
        sum += word as u32;
    }
    while sum > 0xFFFF {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !(sum as u16)
}

/// Whether a received packet is the reply to `sent`. macOS hands an IPv4
/// reply over with its IP header in front; Linux doesn't.
fn is_reply(data: &[u8], v6: bool, sent: &[u8]) -> bool {
    let data = match data.first() {
        Some(first) if !v6 && first >> 4 == 4 => match data.get(((first & 0x0F) as usize) * 4..) {
            Some(rest) => rest,
            None => return false,
        },
        _ => data,
    };
    let reply_type = if v6 { 129 } else { 0 };
    data.len() >= sent.len() && data[0] == reply_type && data[6..8] == sent[6..8] && data[8..sent.len()] == sent[8..]
}

/// The reply time in a line of Windows ping's output, in any language: the
/// number just before "ms" on the line that carries TTL= (IPv4) or the
/// address (IPv6).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_reply_ms(text: &str, ip: IpAddr) -> Option<u64> {
    let address = ip.to_string();
    text.lines()
        .filter(|line| line.to_ascii_uppercase().contains("TTL=") || (ip.is_ipv6() && line.contains(&address)))
        .find_map(number_before_ms)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn number_before_ms(line: &str) -> Option<u64> {
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(found) = line[from..].find("ms") {
        let at = from + found;
        from = at + 2;
        let mut end = at;
        if end > 0 && bytes[end - 1] == b' ' {
            end -= 1;
        }
        let mut start = end;
        while start > 0 && bytes[start - 1].is_ascii_digit() {
            start -= 1;
        }
        if start < end && start > 0 && matches!(bytes[start - 1], b'=' | b'<' | b' ') {
            return line[start..end].parse().ok();
        }
    }
    None
}

#[cfg(unix)]
mod imp {
    use std::io;
    use std::net::{IpAddr, SocketAddr, UdpSocket};
    use std::os::fd::FromRawFd;
    use std::os::raw::c_int;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    extern "C" {
        fn socket(domain: c_int, kind: c_int, protocol: c_int) -> c_int;
    }

    const AF_INET: c_int = 2;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    const AF_INET6: c_int = 30;
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    const AF_INET6: c_int = 10;
    const SOCK_DGRAM: c_int = 2;
    const IPPROTO_ICMP: c_int = 1;
    const IPPROTO_ICMPV6: c_int = 58;

    pub fn echo(ip: IpAddr, limit: Duration) -> io::Result<Duration> {
        let v6 = ip.is_ipv6();
        let (domain, protocol) = if v6 { (AF_INET6, IPPROTO_ICMPV6) } else { (AF_INET, IPPROTO_ICMP) };
        // SAFETY: socket() takes plain integers and returns a new descriptor or -1.
        let fd = unsafe { socket(domain, SOCK_DGRAM, protocol) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the descriptor was opened just above and nothing else owns it.
        let socket = unsafe { UdpSocket::from_raw_fd(fd) };
        let seq = super::SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let packet = super::request(v6, seq);
        let started = Instant::now();
        socket.send_to(&packet, SocketAddr::new(ip, 0))?;
        let mut buffer = [0u8; 1500];
        loop {
            let left = limit.checked_sub(started.elapsed()).filter(|left| !left.is_zero()).ok_or(io::ErrorKind::TimedOut)?;
            socket.set_read_timeout(Some(left))?;
            let (size, from) = match socket.recv_from(&mut buffer) {
                Ok(received) => received,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Err(io::ErrorKind::TimedOut.into()),
                Err(error) => return Err(error),
            };
            if from.ip() == ip && super::is_reply(&buffer[..size], v6, &packet) {
                return Ok(started.elapsed());
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::net::IpAddr;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    pub fn echo(ip: IpAddr, limit: Duration) -> io::Result<Duration> {
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let mut command = Command::new(format!("{system}\\System32\\PING.EXE"));
        command
            .args(["-n", "1", "-w"])
            .arg(limit.as_millis().max(1).to_string())
            .arg(if ip.is_ipv6() { "-6" } else { "-4" })
            .arg(ip.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::claude_code::hide_console(&mut command);
        let output = command.output()?;
        let text = String::from_utf8_lossy(&output.stdout);
        match super::windows_reply_ms(&text, ip) {
            Some(ms) if output.status.success() => Ok(Duration::from_millis(ms.max(1))),
            _ => Err(io::ErrorKind::TimedOut.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_carry_a_valid_checksum() {
        let packet = request(false, 7);
        assert_eq!(packet[0], 8);
        assert_eq!(packet.len(), 40);
        // A packet with its checksum in place sums to zero.
        assert_eq!(checksum(&packet), 0);
        assert_eq!(request(true, 7)[0], 128);
    }

    #[test]
    fn replies_are_matched_with_or_without_an_ip_header() {
        let sent = request(false, 9);
        let mut reply = sent.clone();
        reply[0] = 0;
        // Linux rewrites the identifier.
        reply[4] = 0xAB;
        assert!(is_reply(&reply, false, &sent));
        let mut with_header = vec![0x45; 1];
        with_header.extend_from_slice(&[0u8; 19]);
        with_header.extend_from_slice(&reply);
        assert!(is_reply(&with_header, false, &sent));
        let mut other = reply.clone();
        other[7] ^= 1;
        assert!(!is_reply(&other, false, &sent));
        assert!(!is_reply(&sent, false, &sent));
        let six = request(true, 3);
        let mut six_reply = six.clone();
        six_reply[0] = 129;
        assert!(is_reply(&six_reply, true, &six));
    }

    #[test]
    fn windows_output_is_read_in_several_languages() {
        let v4: IpAddr = "142.250.185.78".parse().unwrap();
        let english = "\r\nPinging 142.250.185.78 with 32 bytes of data:\r\nReply from 142.250.185.78: bytes=32 time=14ms TTL=117\r\n\r\nPing statistics for 142.250.185.78:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\nApproximate round trip times in milli-seconds:\r\n    Minimum = 14ms, Maximum = 14ms, Average = 14ms\r\n";
        assert_eq!(windows_reply_ms(english, v4), Some(14));
        let german = "Antwort von 142.250.185.78: Bytes=32 Zeit=9ms TTL=117\r\n";
        assert_eq!(windows_reply_ms(german, v4), Some(9));
        let french = "Réponse de 142.250.185.78 : octets=32 temps=23 ms TTL=117\r\n";
        assert_eq!(windows_reply_ms(french, v4), Some(23));
        let fast = "Reply from 127.0.0.1: bytes=32 time<1ms TTL=128\r\n";
        assert_eq!(windows_reply_ms(fast, "127.0.0.1".parse().unwrap()), Some(1));
        let lost = "Request timed out.\r\n\r\nPing statistics for 142.250.185.78:\r\n    Packets: Sent = 1, Received = 0, Lost = 1 (100% loss),\r\n";
        assert_eq!(windows_reply_ms(lost, v4), None);
        let unreachable = "Reply from 192.168.1.1: Destination host unreachable.\r\n";
        assert_eq!(windows_reply_ms(unreachable, v4), None);
        let v6: IpAddr = "2001:4860:4860::8888".parse().unwrap();
        assert_eq!(windows_reply_ms("Reply from 2001:4860:4860::8888: time=18ms \r\n", v6), Some(18));
    }

    #[cfg(unix)]
    #[test]
    fn this_computer_answers_its_own_ping() {
        let ip: IpAddr = "127.0.0.1".parse().unwrap();
        match echo(ip, Duration::from_secs(2)) {
            Ok(time) => assert!(time < Duration::from_secs(2)),
            // A Linux machine whose ping_group_range leaves this user out.
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {}
            Err(error) => panic!("ping 127.0.0.1 failed: {error}"),
        }
    }
}
