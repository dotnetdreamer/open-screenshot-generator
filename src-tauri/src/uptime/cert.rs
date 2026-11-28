//! The dates and names on a site's certificate, read from the DER bytes the
//! TLS library hands over. Only the start of the certificate is read (the
//! issuer, the validity and the subject), so a small walker over DER's
//! tag, length and value triples is enough.

use super::clock::{days_from_civil, DAY, HOUR, MINUTE, SECOND};
use super::model::Cert;

struct Der<'a> {
    data: &'a [u8],
}

impl<'a> Der<'a> {
    /// The next element: its tag, its contents, and what follows it.
    fn next(&self) -> Option<(u8, &'a [u8], Der<'a>)> {
        let (&tag, rest) = self.data.split_first()?;
        let (&first, rest) = rest.split_first()?;
        let (length, rest) = if first < 0x80 {
            (first as usize, rest)
        } else {
            let count = (first & 0x7F) as usize;
            if count == 0 || count > 4 || rest.len() < count {
                return None;
            }
            let length = rest[..count].iter().fold(0usize, |total, &byte| (total << 8) | byte as usize);
            (length, &rest[count..])
        };
        if rest.len() < length {
            return None;
        }
        Some((tag, &rest[..length], Der { data: &rest[length..] }))
    }
}

/// UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime (YYYYMMDDHHMMSSZ) as ms.
fn time(tag: u8, value: &[u8]) -> Option<i64> {
    let text = std::str::from_utf8(value).ok()?;
    let text = text.strip_suffix('Z')?;
    let digits = |range: std::ops::Range<usize>| -> Option<i64> { text.get(range)?.parse::<i64>().ok() };
    let (year, rest) = match tag {
        0x17 => {
            let short = digits(0..2)?;
            (if short >= 50 { 1900 + short } else { 2000 + short }, 2)
        }
        0x18 => (digits(0..4)?, 4),
        _ => return None,
    };
    let month = digits(rest..rest + 2)? as u32;
    let day = digits(rest + 2..rest + 4)? as u32;
    let hour = digits(rest + 4..rest + 6)?;
    let minute = digits(rest + 6..rest + 8)?;
    let second = digits(rest + 8..rest + 10).unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    Some(days_from_civil(year, month, day) * DAY + hour * HOUR + minute * MINUTE + second * SECOND)
}

/// The common name of a Name, or its organisation when it has none.
fn name(value: &[u8]) -> String {
    let mut common = None;
    let mut organisation = None;
    let mut sets = Der { data: value };
    while let Some((_, set, rest)) = sets.next() {
        sets = rest;
        let mut pairs = Der { data: set };
        while let Some((_, pair, rest)) = pairs.next() {
            pairs = rest;
            let Some((0x06, oid, after)) = Der { data: pair }.next() else { continue };
            let Some((_, text, _)) = after.next() else { continue };
            let text = String::from_utf8_lossy(text).into_owned();
            match oid {
                [0x55, 0x04, 0x03] => common = Some(text),
                [0x55, 0x04, 0x0A] => organisation = Some(text),
                _ => {}
            }
        }
    }
    common.or(organisation).unwrap_or_default()
}

pub fn read(der: &[u8]) -> Option<Cert> {
    let (_, certificate, _) = Der { data: der }.next()?;
    let (_, tbs, _) = Der { data: certificate }.next()?;
    let (tag, _, rest) = Der { data: tbs }.next()?;
    // The version comes first as [0], except on a version 1 certificate,
    // which starts at the serial number.
    let fields = if tag == 0xA0 { rest.next()?.2 } else { rest };
    let (_, _signature, rest) = fields.next()?;
    let (_, issuer, rest) = rest.next()?;
    let (_, validity, rest) = rest.next()?;
    let (_, subject, _) = rest.next()?;
    let (before_tag, before, after) = Der { data: validity }.next()?;
    let (after_tag, after, _) = after.next()?;
    Some(Cert { issued: time(before_tag, before)?, expires: time(after_tag, after)?, issuer: name(issuer), subject: name(subject) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tlv(tag: u8, value: &[u8]) -> Vec<u8> {
        let mut out = vec![tag];
        if value.len() < 0x80 {
            out.push(value.len() as u8);
        } else {
            out.push(0x82);
            out.extend_from_slice(&(value.len() as u16).to_be_bytes());
        }
        out.extend_from_slice(value);
        out
    }

    fn rdn(oid_last: u8, text: &str) -> Vec<u8> {
        let mut pair = tlv(0x06, &[0x55, 0x04, oid_last]);
        pair.extend(tlv(0x0C, text.as_bytes()));
        tlv(0x31, &tlv(0x30, &pair))
    }

    fn certificate(version: bool, before: (u8, &str), after: (u8, &str)) -> Vec<u8> {
        let mut tbs = Vec::new();
        if version {
            tbs.extend(tlv(0xA0, &tlv(0x02, &[2])));
        }
        tbs.extend(tlv(0x02, &[0x01, 0x23]));
        tbs.extend(tlv(0x30, &tlv(0x06, &[0x2A, 0x86, 0x48])));
        let mut issuer = rdn(0x06, "US");
        issuer.extend(rdn(0x0A, "Let's Encrypt"));
        issuer.extend(rdn(0x03, "R11"));
        tbs.extend(tlv(0x30, &issuer));
        let mut validity = tlv(before.0, before.1.as_bytes());
        validity.extend(tlv(after.0, after.1.as_bytes()));
        tbs.extend(tlv(0x30, &validity));
        tbs.extend(tlv(0x30, &rdn(0x03, "example.com")));
        // Enough padding to need a long length form.
        tbs.extend(tlv(0x30, &[0u8; 200]));
        let mut whole = tlv(0x30, &tbs);
        whole.extend(tlv(0x30, &tlv(0x06, &[0x2A])));
        whole.extend(tlv(0x03, &[0, 1, 2, 3]));
        tlv(0x30, &whole)
    }

    #[test]
    fn dates_and_names_are_read() {
        let cert = read(&certificate(true, (0x17, "251001120000Z"), (0x17, "251230115959Z"))).unwrap();
        assert_eq!(cert.issuer, "R11");
        assert_eq!(cert.subject, "example.com");
        assert_eq!(cert.issued, days_from_civil(2025, 10, 1) * DAY + 12 * HOUR);
        assert_eq!(cert.expires, days_from_civil(2025, 12, 30) * DAY + 11 * HOUR + 59 * MINUTE + 59 * SECOND);
    }

    #[test]
    fn a_v1_certificate_and_generalized_time_read_too() {
        let cert = read(&certificate(false, (0x17, "491231235959Z"), (0x18, "20500101000000Z"))).unwrap();
        assert_eq!(cert.issued, days_from_civil(2049, 12, 31) * DAY + 23 * HOUR + 59 * MINUTE + 59 * SECOND);
        assert_eq!(cert.expires, days_from_civil(2050, 1, 1) * DAY);
    }

    #[test]
    fn junk_is_refused() {
        assert!(read(&[]).is_none());
        assert!(read(&[0x30, 0x82, 0xFF]).is_none());
        let mut cut = certificate(true, (0x17, "251001120000Z"), (0x17, "251230115959Z"));
        cut.truncate(40);
        assert!(read(&cut).is_none());
        assert!(read(&certificate(true, (0x17, "2510011200Z"), (0x17, "nonsense"))).is_none());
    }
}
