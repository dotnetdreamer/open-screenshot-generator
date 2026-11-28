//! What Uptime keeps: the things the user watches (monitors), the result of
//! each check (a beat), the changes worth a line in the history (events), the
//! hourly totals the charts and percentages are read from, and where alerts
//! go. Every field crosses to the page with its camelCase name, the shape
//! src/lib/uptime/types.ts reads.
//!
//! `Monitor::normalize` is the one place a monitor from the page is checked.
//! Its errors reach the page's toast, so they are short plain sentences.

use std::net::{IpAddr, SocketAddr};

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest::Url;

/// More than anyone watches by hand, and few enough that a check of every one
/// at the shortest interval stays light.
pub const MAX_MONITORS: usize = 200;
pub const MIN_INTERVAL: u32 = 20;
pub const MAX_INTERVAL: u32 = 86_400;
pub const MAX_TIMEOUT: u32 = 120;
pub const MAX_TARGETS: usize = 20;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A web page or an API, over http or https.
    #[default]
    Http,
    /// A TCP port on a server: a database, a game server, a mail server.
    Port,
    /// An ICMP echo to a computer.
    Ping,
    /// A DNS record of a domain.
    Dns,
    /// The app's page on the App Store or Google Play.
    Store,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Header {
    pub name: String,
    pub value: String,
}

/// One thing the user watches. Every kind's fields are on it, as uptime-kuma
/// keeps them, so a monitor switched from one kind to another keeps what was
/// typed for the first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Monitor {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// Seconds between checks.
    pub interval: u32,
    /// Seconds a check may take.
    pub timeout: u32,
    /// Failed checks in a row that are only "checking again" before the
    /// monitor counts as down. 0 calls it down on the first failure.
    pub retries: u32,
    /// Seconds between the checks that confirm a failure.
    pub retry_interval: u32,
    pub paused: bool,
    /// When a pause ends by itself (ms since 1970). None with `paused` set
    /// waits for the user.
    pub paused_until: Option<i64>,
    /// Alert targets this monitor leaves out. New targets reach every monitor.
    pub skip_alerts: Vec<String>,
    /// Checks slower than this many milliseconds are marked slow. 0 is off.
    pub slow_ms: u32,
    pub created: i64,

    // A web page.
    pub url: String,
    pub method: String,
    pub headers: Vec<Header>,
    pub body: String,
    /// The status codes that count as up, such as "200-299" or "200-299, 301".
    pub accept: String,
    /// Redirects to follow. 0 takes the first answer as it is.
    pub redirects: u32,
    pub ignore_tls: bool,
    /// Alert this many days before the certificate runs out. 0 is off.
    pub cert_days: u32,
    pub keyword: String,
    /// Up when the words are NOT on the page.
    pub keyword_absent: bool,
    pub keyword_case: bool,
    /// A value in a JSON answer, such as `status` or `data.items[0].state`.
    pub json_path: String,
    /// eq, ne, contains, lt or gt.
    pub json_op: String,
    pub json_expected: String,

    // A port, a ping or a DNS record.
    pub host: String,
    pub port: u16,
    pub dns_type: String,
    /// The DNS server to ask, "" for the one this computer uses.
    pub dns_server: String,
    /// Values the answer must include, separated by commas. "" takes any answer.
    pub dns_expect: String,

    // A store listing.
    /// "apple" or "google".
    pub store: String,
    /// The App Store's number for the app, or the Google Play package name.
    pub app_id: String,
    /// Two letters, lower case.
    pub country: String,
    /// Google Play only: up while the app's page is there with a
    /// Pre-register button or no button, for an app open for
    /// pre-registration. Off, only Install or a price counts as up.
    pub listed_ok: bool,
    /// The name is one Uptime made (from the address, or the store's name
    /// for the app), so it may follow the monitor to a new target. None in a
    /// monitor saved before this was kept.
    pub auto_name: Option<bool>,
}

impl Default for Monitor {
    fn default() -> Self {
        Monitor {
            id: String::new(),
            name: String::new(),
            kind: Kind::Http,
            interval: 60,
            timeout: 10,
            retries: 1,
            retry_interval: 20,
            paused: false,
            paused_until: None,
            skip_alerts: Vec::new(),
            slow_ms: 0,
            created: 0,
            url: String::new(),
            method: "GET".into(),
            headers: Vec::new(),
            body: String::new(),
            accept: "200-299".into(),
            redirects: 10,
            ignore_tls: false,
            cert_days: 14,
            keyword: String::new(),
            keyword_absent: false,
            keyword_case: false,
            json_path: String::new(),
            json_op: "eq".into(),
            json_expected: String::new(),
            host: String::new(),
            port: 443,
            dns_type: "A".into(),
            dns_server: String::new(),
            dns_expect: String::new(),
            store: "apple".into(),
            app_id: String::new(),
            country: "us".into(),
            listed_ok: false,
            auto_name: None,
        }
    }
}

pub const METHODS: [&str; 7] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
pub const JSON_OPS: [&str; 5] = ["eq", "ne", "contains", "lt", "gt"];
pub const DNS_TYPES: [&str; 7] = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA"];

impl Monitor {
    /// What the page sent, trimmed and held to the limits, or the first
    /// problem in words the user can act on.
    pub fn normalize(mut self) -> Result<Monitor, String> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            return Err("Give the monitor a name".into());
        }
        if self.name.chars().count() > 80 {
            return Err("Use a name of 80 letters or fewer".into());
        }
        self.interval = self.interval.clamp(MIN_INTERVAL, MAX_INTERVAL);
        self.timeout = self.timeout.clamp(1, MAX_TIMEOUT).min(self.interval);
        self.retries = self.retries.min(10);
        self.retry_interval = self.retry_interval.clamp(10, 3600);
        self.slow_ms = self.slow_ms.min(120_000);
        self.skip_alerts.retain(|id| !id.is_empty());
        self.skip_alerts.truncate(MAX_TARGETS);
        match self.kind {
            Kind::Http => self.normalize_http()?,
            Kind::Port => {
                self.host = clean_host(&self.host)?;
                if self.port == 0 {
                    return Err("Type a port number from 1 to 65535".into());
                }
            }
            Kind::Ping => self.host = clean_host(&self.host)?,
            Kind::Dns => {
                self.host = clean_host(&self.host)?;
                if self.host.parse::<IpAddr>().is_ok() {
                    return Err("Type a domain name, such as example.com".into());
                }
                self.dns_type = self.dns_type.trim().to_uppercase();
                if !DNS_TYPES.contains(&self.dns_type.as_str()) {
                    return Err("Pick a record type from the list".into());
                }
                self.dns_server = self.dns_server.trim().to_string();
                if !self.dns_server.is_empty() && dns_server_addr(&self.dns_server).is_none() {
                    return Err("Type the DNS server as a number address, such as 1.1.1.1".into());
                }
                self.dns_expect = self.dns_expect.trim().to_string();
                if self.dns_expect.chars().count() > 500 {
                    return Err("Keep the expected answer under 500 letters".into());
                }
            }
            Kind::Store => {
                self.store = self.store.trim().to_lowercase();
                self.app_id = self.app_id.trim().to_string();
                self.country = self.country.trim().to_lowercase();
                match self.store.as_str() {
                    "apple" => {
                        // A number, so 0361309726 is 361309726, the way Apple reads it.
                        let number = self.app_id.trim_start_matches('0');
                        if number.is_empty() || self.app_id.len() > 12 || !self.app_id.bytes().all(|b| b.is_ascii_digit()) {
                            return Err("Type the App Store number of the app, such as 1234567890".into());
                        }
                        self.app_id = number.to_string();
                    }
                    "google" => {
                        if !is_package_name(&self.app_id) {
                            return Err("Type the Google Play package name, such as com.example.app".into());
                        }
                    }
                    _ => return Err("Pick the App Store or Google Play".into()),
                }
                if self.country.len() != 2 || !self.country.bytes().all(|b| b.is_ascii_lowercase()) {
                    return Err("Pick a country from the list".into());
                }
            }
        }
        Ok(self)
    }

    fn normalize_http(&mut self) -> Result<(), String> {
        self.url = self.url.trim().to_string();
        let url = Url::parse(&self.url).map_err(|_| "Type the full web address, starting with https://".to_string())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("Use an address that starts with https:// or http://".into());
        }
        if url.host_str().map_or(true, str::is_empty) {
            return Err("Type the full web address, starting with https://".into());
        }
        self.method = self.method.trim().to_uppercase();
        if self.method.is_empty() {
            self.method = "GET".into();
        }
        if !METHODS.contains(&self.method.as_str()) {
            return Err("Pick a method from the list".into());
        }
        self.headers = self
            .headers
            .iter()
            .map(|header| Header { name: header.name.trim().to_string(), value: header.value.trim().to_string() })
            .filter(|header| !header.name.is_empty())
            .collect();
        if self.headers.len() > 30 {
            return Err("Use 30 headers or fewer".into());
        }
        for header in &self.headers {
            if !header.name.bytes().all(is_token_byte) {
                return Err(format!("The header name \"{}\" has letters a header can't use", header.name));
            }
            if header.value.contains(['\r', '\n']) || header.value.len() > 8192 {
                return Err(format!("The value of the header \"{}\" can't be used", header.name));
            }
        }
        if self.body.len() > 64 * 1024 {
            return Err("Keep the body under 64 KB".into());
        }
        self.accept = self.accept.trim().to_string();
        if self.accept.is_empty() {
            self.accept = "200-299".into();
        }
        if parse_accept(&self.accept).is_none() {
            return Err("Type status codes as numbers or ranges, such as 200-299, 301".into());
        }
        self.redirects = self.redirects.min(20);
        self.cert_days = self.cert_days.min(365);
        if self.keyword.chars().count() > 500 {
            return Err("Keep the words to look for under 500 letters".into());
        }
        self.json_path = self.json_path.trim().to_string();
        if self.json_path.chars().count() > 200 {
            return Err("Keep the JSON path under 200 letters".into());
        }
        if !self.json_path.is_empty() && json_path_steps(&self.json_path).is_none() {
            return Err("Write the JSON path as names and [numbers], such as data.items[0].status".into());
        }
        if self.json_op.is_empty() {
            self.json_op = "eq".into();
        }
        if !JSON_OPS.contains(&self.json_op.as_str()) {
            return Err("Pick how to compare the JSON value from the list".into());
        }
        if self.json_expected.chars().count() > 500 {
            return Err("Keep the expected JSON value under 500 letters".into());
        }
        Ok(())
    }

    /// What the monitor points at, for alerts and the history.
    pub fn target(&self) -> String {
        match self.kind {
            Kind::Http => self.url.clone(),
            Kind::Port => format!("{}:{}", bracket(&self.host), self.port),
            Kind::Ping => self.host.clone(),
            Kind::Dns => format!("{} {}", self.dns_type, self.host),
            Kind::Store => match self.store.as_str() {
                "google" => format!("Google Play {} ({})", self.app_id, self.country.to_uppercase()),
                _ => format!("App Store {} ({})", self.app_id, self.country.to_uppercase()),
            },
        }
    }

    /// The most a check can stand for: the wait until the next check (the
    /// interval, or the retry interval while a failure is being confirmed),
    /// the time that check may take, and 15 seconds for the schedule to get
    /// to it. Past that, the rest of a gap counts as neither up nor down: the
    /// checks were held up, the app was closed or the computer slept.
    pub fn cover_ms(&self, status: BeatStatus) -> i64 {
        let wait = if status == BeatStatus::Pending { self.retry_interval } else { self.interval };
        (wait as i64 + self.timeout as i64 + 15) * 1000
    }

    /// Everything that decides what a check does. A check that started before
    /// any of it changed answers a question nobody asks any more.
    pub fn same_check(&self, other: &Monitor) -> bool {
        self.check_part() == other.check_part()
    }

    /// The monitor less what doesn't change what is checked.
    fn check_part(&self) -> Monitor {
        Monitor {
            name: String::new(),
            paused: false,
            paused_until: None,
            skip_alerts: Vec::new(),
            created: 0,
            interval: 0,
            retry_interval: 0,
            retries: 0,
            slow_ms: 0,
            cert_days: 0,
            auto_name: None,
            ..self.clone()
        }
    }

    /// A fingerprint of what is checked (`same_check`), saved with the
    /// monitor's state, so a state saved for another target is never
    /// restored. FNV-1a, which stays the same from one build to the next.
    pub fn target_key(&self) -> u64 {
        let text = serde_json::to_string(&self.check_part()).unwrap_or_default();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in text.bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        // 0 is a state saved before fingerprints were kept.
        hash.max(1)
    }
}

/// `[v6]` for an IPv6 address, as an address with a port writes it.
pub fn bracket(host: &str) -> String {
    if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

fn is_package_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 150 || !name.contains('.') {
        return false;
    }
    name.split('.').all(|part| {
        let mut bytes = part.bytes();
        matches!(bytes.next(), Some(first) if first.is_ascii_alphabetic())
            && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
    })
}

/// A host name or an address, as the user typed it, made into the form the
/// checks use: lower case, the international form of a name (xn--), no
/// brackets round an IPv6 address.
pub fn clean_host(text: &str) -> Result<String, String> {
    let text = text.trim().trim_end_matches('.');
    let bare = text.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).unwrap_or(text);
    if bare.is_empty() {
        return Err("Type the server's name or address, such as example.com".into());
    }
    if let Ok(ip) = bare.parse::<IpAddr>() {
        return Ok(ip.to_string());
    }
    if bare.contains(['/', ':', ' ', '@', '?', '#']) {
        return Err("Type only the server's name, such as example.com, without https:// or a path".into());
    }
    let url = Url::parse(&format!("http://{bare}/")).map_err(|_| "That server name can't be used".to_string())?;
    let host = url.host_str().unwrap_or_default().to_string();
    let labels_ok = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    });
    if host.is_empty() || host.len() > 253 || !labels_ok {
        return Err("That server name can't be used".into());
    }
    Ok(host)
}

/// A DNS server typed as an address, with or without a port.
pub fn dns_server_addr(text: &str) -> Option<SocketAddr> {
    if let Ok(ip) = text.parse::<IpAddr>() {
        return Some(SocketAddr::new(ip, 53));
    }
    text.parse::<SocketAddr>().ok().filter(|addr| addr.port() != 0)
}

/// "200-299, 301" as ranges. None when a part isn't a code or a range.
pub fn parse_accept(text: &str) -> Option<Vec<(u16, u16)>> {
    let mut ranges = Vec::new();
    for part in text.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (low, high) = match part.split_once('-') {
            Some((low, high)) => (low.trim().parse::<u16>().ok()?, high.trim().parse::<u16>().ok()?),
            None => {
                let code = part.parse::<u16>().ok()?;
                (code, code)
            }
        };
        if !(100..=599).contains(&low) || !(100..=599).contains(&high) || low > high {
            return None;
        }
        ranges.push((low, high));
    }
    (!ranges.is_empty()).then_some(ranges)
}

pub fn accepts(text: &str, code: u16) -> bool {
    parse_accept(text).unwrap_or_else(|| vec![(200, 299)]).iter().any(|&(low, high)| (low..=high).contains(&code))
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Key(String),
    Index(usize),
}

/// `data.items[0].status` as steps. A leading `$` or `$.` is allowed, as
/// JSONPath writes it.
pub fn json_path_steps(path: &str) -> Option<Vec<Step>> {
    let path = path.trim();
    let path = path.strip_prefix("$.").or_else(|| path.strip_prefix('$')).unwrap_or(path);
    let mut steps = Vec::new();
    let mut chars = path.chars().peekable();
    let mut key = String::new();
    while let Some(c) = chars.next() {
        match c {
            '.' => {
                if !key.is_empty() {
                    steps.push(Step::Key(std::mem::take(&mut key)));
                } else if !matches!(steps.last(), Some(Step::Index(_))) {
                    return None;
                }
            }
            '[' => {
                if !key.is_empty() {
                    steps.push(Step::Key(std::mem::take(&mut key)));
                }
                let mut inside = String::new();
                loop {
                    match chars.next() {
                        Some(']') => break,
                        Some(c) => inside.push(c),
                        None => return None,
                    }
                }
                let inside = inside.trim();
                if let Ok(index) = inside.parse::<usize>() {
                    steps.push(Step::Index(index));
                } else {
                    let quoted = inside
                        .strip_prefix('"')
                        .and_then(|rest| rest.strip_suffix('"'))
                        .or_else(|| inside.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')))?;
                    steps.push(Step::Key(quoted.to_string()));
                }
            }
            c => key.push(c),
        }
    }
    if !key.is_empty() {
        steps.push(Step::Key(key));
    }
    (!steps.is_empty()).then_some(steps)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BeatStatus {
    Up,
    Down,
    /// Failed, and being checked again before it counts as down.
    Pending,
    /// The check failed while this computer had no network, so it says
    /// nothing about the monitor.
    Offline,
    /// The check couldn't tell either way (`Outcome::inconclusive`).
    Unclear,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// One check. Kept short on purpose: one line per check, for 30 days.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Beat {
    /// When the check started, ms since 1970.
    pub t: i64,
    pub s: BeatStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
    /// Why it failed, as a code the page can act on (`timeout`, `dns`...).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub why: String,
    /// Why it failed, in words.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub msg: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub slow: bool,
}

/// Where a monitor stands now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    #[default]
    Unknown,
    Up,
    Down,
    Pending,
    Paused,
}

/// A change worth a line in the history.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub t: i64,
    /// down, up, paused, resumed, cert, version, added, changed.
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub msg: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub why: String,
    /// For "up": ms from the first failed check to this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dur: Option<i64>,
    /// For "up": of `dur`, the ms the app was open and checking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
}

/// An hour's totals. Uptime is `up / (up + down)` over the hours asked for,
/// so an hour the app was closed counts for nothing either way.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Bucket {
    /// How the hour was written: `Bucket::FORMAT`. A line without it came
    /// from a test build before Uptime shipped, which kept stretches in
    /// whole seconds, and is left out (`is_current`).
    #[serde(default = "earlier_format")]
    pub v: u8,
    /// The start of the hour, ms since 1970.
    pub t: i64,
    /// Ms seen up.
    pub up: i64,
    /// Ms seen down.
    pub down: i64,
    /// Checks.
    pub n: u32,
    /// Checks that failed.
    pub fails: u32,
    /// The response times of the checks that passed, summed.
    pub sum: u64,
    pub cnt: u32,
    pub min: u32,
    pub max: u32,
    /// The stretches of the hour that were seen, as [start, end, down] in ms
    /// from the start of the hour, in order. A window that starts or ends
    /// inside the hour takes only its own part of them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<[u32; 3]>,
    /// Where the latest time added ends, in ms from the start of the hour.
    #[serde(skip_serializing_if = "is_zero")]
    pub until: u32,
}

impl Default for Bucket {
    fn default() -> Self {
        Self { v: Self::FORMAT, t: 0, up: 0, down: 0, n: 0, fails: 0, sum: 0, cnt: 0, min: 0, max: 0, spans: Vec::new(), until: 0 }
    }
}

fn earlier_format() -> u8 {
    0
}

fn is_zero(value: &u32) -> bool {
    *value == 0
}

const HOUR_MS: i64 = 3_600_000;

/// A bucket's stretches stop being kept past this many; its totals go on.
/// Checks every 10 seconds flipping each time make 360.
const MAX_SPANS: usize = 720;

impl Bucket {
    /// Stretches in ms, the time past `MAX_SPANS` after the last one.
    pub const FORMAT: u8 = 1;

    /// Written by this build. Earlier test builds kept whole seconds, and
    /// where in a second the time fell can't be known: rules for guessing it
    /// put up time on stretches that were down, more time in a window than
    /// it lasts, and lost 75 s when a window moved by 1 ms. So such an hour
    /// counts for nothing.
    pub fn is_current(&self) -> bool {
        self.v == Self::FORMAT
    }

    /// Adds `[from, to)`, which lies inside this hour, seen up or down.
    pub fn add_span(&mut self, from: i64, to: i64, down: bool) {
        if to <= from {
            return;
        }
        if down {
            self.down += to - from;
        } else {
            self.up += to - from;
        }
        let start = (from - self.t).clamp(0, HOUR_MS) as u32;
        let end = (to - self.t).clamp(0, HOUR_MS) as u32;
        self.until = self.until.max(end);
        if end <= start {
            return;
        }
        let flag = down as u32;
        let at = self.spans.partition_point(|span| span[0] < start);
        // Joins a stretch it touches with the same state, before or after.
        if at > 0 && self.spans[at - 1][1] >= start && self.spans[at - 1][2] == flag {
            let before = &mut self.spans[at - 1];
            before[1] = before[1].max(end);
            if at < self.spans.len() && self.spans[at][0] <= self.spans[at - 1][1] && self.spans[at][2] == flag {
                let after = self.spans.remove(at);
                self.spans[at - 1][1] = self.spans[at - 1][1].max(after[1]);
            }
            return;
        }
        if at < self.spans.len() && self.spans[at][0] <= end && self.spans[at][2] == flag {
            self.spans[at][0] = start;
            self.spans[at][1] = self.spans[at][1].max(end);
            return;
        }
        if self.spans.len() < MAX_SPANS {
            self.spans.insert(at, [start, end, flag]);
        }
    }

    /// Ms seen up and down between `from` and `to`, at `now`. A range that
    /// holds all the time the hour has seen answers from its totals. One
    /// that cuts the hour takes its part of the stretches, exactly. The time
    /// they don't hold came after the last one (past `MAX_SPANS`), so it is
    /// spread from there to where the hour's time ends, which is never later
    /// than now, and never more of it than fits.
    pub fn time_in(&self, from: i64, to: i64, now: i64) -> (i64, i64) {
        let latest = if self.until > 0 { self.t + self.until as i64 } else { self.t + HOUR_MS };
        let data_end = latest.min(now.max(self.t));
        if from <= self.t && to >= data_end {
            return (self.up, self.down);
        }
        let overlap = |start: i64, stop: i64| (stop.min(to) - start.max(from)).max(0);
        let (mut up, mut down) = (0, 0);
        let (mut span_up, mut span_down) = (0, 0);
        for span in &self.spans {
            let (start, stop) = (self.t + span[0] as i64, self.t + span[1] as i64);
            if span[2] == 1 {
                down += overlap(start, stop);
                span_down += stop - start;
            } else {
                up += overlap(start, stop);
                span_up += stop - start;
            }
        }
        let rest_up = (self.up - span_up).max(0);
        let rest_down = (self.down - span_down).max(0);
        let rest = rest_up + rest_down;
        let after = self.spans.last().map_or(self.t, |last| self.t + last[1] as i64);
        let room = data_end - after;
        if rest > 0 && room > 0 {
            let placed = rest.min(room) as f64 * overlap(after, data_end) as f64 / room as f64;
            up += (placed * rest_up as f64 / rest as f64).round() as i64;
            down += (placed * rest_down as f64 / rest as f64).round() as i64;
        }
        (up, down)
    }
}

/// The name a store check gives a monitor, as `storeName` in UptimeForm.tsx
/// makes it: "Pages: Create Documents on the App Store".
pub fn store_name(app_name: &str, store: &str) -> String {
    format!("{app_name} on {}", if store == "google" { "Google Play" } else { "the App Store" }).chars().take(80).collect()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cert {
    /// When it runs out, ms since 1970.
    pub expires: i64,
    pub issued: i64,
    pub issuer: String,
    pub subject: String,
}

/// What the last answer said, beyond up or down.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Detail {
    pub at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    /// Where the redirects ended, when not where they started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cert: Option<Cert>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<String>,
    /// The JSON value found at the path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    /// What Google Play offers: Install, a price, or Pre-register.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
    /// The error as the network library put it, for the details view.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tech: Option<String>,
}

/// A place alerts are sent besides this computer's own notifications.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Target {
    pub id: String,
    /// slack, discord, telegram, ntfy or webhook.
    pub kind: String,
    pub name: String,
    pub url: String,
    pub token: String,
    pub chat: String,
    pub topic: String,
    pub enabled: bool,
    pub down: bool,
    pub up: bool,
    pub cert: bool,
    pub news: bool,
}

impl Default for Target {
    fn default() -> Self {
        Target {
            id: String::new(),
            kind: "webhook".into(),
            name: String::new(),
            url: String::new(),
            token: String::new(),
            chat: String::new(),
            topic: String::new(),
            enabled: true,
            down: true,
            up: true,
            cert: true,
            news: true,
        }
    }
}

pub const TARGET_KINDS: [&str; 5] = ["slack", "discord", "telegram", "ntfy", "webhook"];

impl Target {
    pub fn normalize(mut self) -> Result<Target, String> {
        self.kind = self.kind.trim().to_lowercase();
        if !TARGET_KINDS.contains(&self.kind.as_str()) {
            return Err("Pick where to send alerts from the list".into());
        }
        self.name = self.name.trim().chars().take(60).collect();
        self.url = self.url.trim().to_string();
        self.token = self.token.trim().to_string();
        self.chat = self.chat.trim().to_string();
        self.topic = self.topic.trim().to_string();
        match self.kind.as_str() {
            "slack" => {
                web_address(&self.url)?;
                if !self.url.starts_with("https://hooks.slack.com/") {
                    return Err("Paste the Slack webhook address. It starts with https://hooks.slack.com/".into());
                }
            }
            "discord" => {
                web_address(&self.url)?;
                if !(self.url.starts_with("https://discord.com/api/webhooks/") || self.url.starts_with("https://discordapp.com/api/webhooks/")) {
                    return Err("Paste the Discord webhook address. It starts with https://discord.com/api/webhooks/".into());
                }
            }
            "telegram" => {
                let (bot, secret) = self.token.split_once(':').unwrap_or(("", ""));
                if bot.is_empty() || !bot.bytes().all(|b| b.is_ascii_digit()) || secret.len() < 20 || !secret.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
                    return Err("Paste the bot token BotFather gave you, such as 123456:ABC-DEF...".into());
                }
                let chat_ok = self.chat.strip_prefix('-').unwrap_or(&self.chat).bytes().all(|b| b.is_ascii_digit())
                    || (self.chat.starts_with('@') && self.chat.len() > 1 && self.chat[1..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'));
                if self.chat.is_empty() || !chat_ok {
                    return Err("Type the chat number, such as -1001234567890, or a channel name starting with @".into());
                }
            }
            "ntfy" => {
                if self.url.is_empty() {
                    self.url = "https://ntfy.sh".into();
                }
                web_address(&self.url)?;
                if self.topic.is_empty() || self.topic.len() > 64 || !self.topic.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
                    return Err("Type a topic of letters, numbers, - and _".into());
                }
            }
            _ => {
                web_address(&self.url)?;
            }
        }
        if self.name.is_empty() {
            self.name = match self.kind.as_str() {
                "slack" => "Slack",
                "discord" => "Discord",
                "telegram" => "Telegram",
                "ntfy" => "ntfy",
                _ => "Webhook",
            }
            .into();
        }
        Ok(self)
    }
}

/// An https address, or plain http on this computer only, so alerts never
/// leave the computer unencrypted.
fn web_address(text: &str) -> Result<Url, String> {
    let url = Url::parse(text).map_err(|_| "Paste the full address, starting with https://".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err("Use an address that starts with https://".into()),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// This computer's own notifications.
    pub desktop: bool,
    pub sound: bool,
    /// The number of monitors that are down on the app's icon in the Dock.
    pub badge: bool,
    /// Minutes between reminders while a monitor stays down. 0 never reminds.
    pub remind: u32,
    pub targets: Vec<Target>,
    /// Moves on with each save. A save made from settings with an older
    /// one is refused (`Engine::save_settings`): two editor windows each
    /// save the whole settings, and the older copy undid the other's change.
    pub rev: u64,
}

/// What a save made from older settings is refused with. `SETTINGS_CHANGED`
/// in store.ts is the same words: the page reads the settings again and
/// makes its change to those.
pub const SETTINGS_CHANGED: &str = "Alerts were changed in another window at the same moment. Try again";

impl Default for Settings {
    fn default() -> Self {
        Settings { desktop: true, sound: true, badge: true, remind: 0, targets: Vec::new(), rev: 0 }
    }
}

impl Settings {
    pub fn normalize(mut self) -> Result<Settings, String> {
        self.remind = match self.remind {
            0 => 0,
            minutes => minutes.clamp(5, 24 * 60),
        };
        if self.targets.len() > MAX_TARGETS {
            return Err(format!("Use {MAX_TARGETS} places for alerts or fewer"));
        }
        self.targets = self.targets.into_iter().map(Target::normalize).collect::<Result<_, _>>()?;
        Ok(self)
    }
}

/// monitors.json.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub monitors: Vec<Monitor>,
    pub settings: Settings,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web(url: &str) -> Monitor {
        Monitor { name: "Site".into(), url: url.into(), ..Monitor::default() }
    }

    #[test]
    fn a_web_monitor_needs_a_full_http_address() {
        assert!(web("https://example.com").normalize().is_ok());
        assert!(web("http://192.168.1.10:8080/health").normalize().is_ok());
        assert!(web("example.com").normalize().is_err());
        assert!(web("ftp://example.com").normalize().is_err());
        assert!(web("file:///etc/passwd").normalize().is_err());
        assert!(web("javascript:alert(1)").normalize().is_err());
    }

    #[test]
    fn limits_are_held_and_names_are_required() {
        let mut monitor = web("https://example.com");
        monitor.interval = 1;
        monitor.timeout = 900;
        monitor.retries = 99;
        let monitor = monitor.normalize().unwrap();
        assert_eq!(monitor.interval, MIN_INTERVAL);
        assert_eq!(monitor.timeout, MIN_INTERVAL);
        assert_eq!(monitor.retries, 10);
        let mut nameless = web("https://example.com");
        nameless.name = "   ".into();
        assert!(nameless.normalize().is_err());
    }

    #[test]
    fn headers_that_could_split_a_request_are_refused() {
        let mut monitor = web("https://example.com");
        monitor.headers = vec![Header { name: "X-Test".into(), value: "a\r\nInjected: yes".into() }];
        assert!(monitor.clone().normalize().is_err());
        monitor.headers = vec![Header { name: "Bad Name".into(), value: "x".into() }];
        assert!(monitor.clone().normalize().is_err());
        monitor.headers = vec![Header { name: " Authorization ".into(), value: " Bearer abc ".into() }, Header::default()];
        let clean = monitor.normalize().unwrap();
        assert_eq!(clean.headers, vec![Header { name: "Authorization".into(), value: "Bearer abc".into() }]);
    }

    #[test]
    fn status_code_lists_parse() {
        assert_eq!(parse_accept("200-299"), Some(vec![(200, 299)]));
        assert_eq!(parse_accept("200-299, 301 ,404"), Some(vec![(200, 299), (301, 301), (404, 404)]));
        assert_eq!(parse_accept("abc"), None);
        assert_eq!(parse_accept("299-200"), None);
        assert_eq!(parse_accept("700"), None);
        assert!(accepts("200-299", 204));
        assert!(!accepts("200-299", 301));
        assert!(accepts("200-299,301", 301));
    }

    #[test]
    fn hosts_are_cleaned() {
        assert_eq!(clean_host(" Example.COM. ").unwrap(), "example.com");
        assert_eq!(clean_host("[::1]").unwrap(), "::1");
        assert_eq!(clean_host("10.0.0.1").unwrap(), "10.0.0.1");
        assert_eq!(clean_host("bücher.de").unwrap(), "xn--bcher-kva.de");
        assert!(clean_host("https://example.com").is_err());
        assert!(clean_host("example.com/path").is_err());
        assert!(clean_host("-bad-.com").is_err());
        assert!(clean_host("").is_err());
    }

    #[test]
    fn json_paths_parse() {
        assert_eq!(json_path_steps("status"), Some(vec![Step::Key("status".into())]));
        assert_eq!(
            json_path_steps("$.data.items[0].state"),
            Some(vec![Step::Key("data".into()), Step::Key("items".into()), Step::Index(0), Step::Key("state".into())])
        );
        assert_eq!(json_path_steps("[2]"), Some(vec![Step::Index(2)]));
        assert_eq!(json_path_steps("a[\"b.c\"]"), Some(vec![Step::Key("a".into()), Step::Key("b.c".into())]));
        assert_eq!(json_path_steps("a..b"), None);
        assert_eq!(json_path_steps("a[0"), None);
    }

    #[test]
    fn store_listings_are_checked() {
        let apple = Monitor { name: "App".into(), kind: Kind::Store, store: "apple".into(), app_id: "1234567890".into(), country: "US".into(), ..Monitor::default() };
        assert_eq!(apple.clone().normalize().unwrap().country, "us");
        assert!(Monitor { app_id: "12ab".into(), ..apple.clone() }.normalize().is_err());
        let google = Monitor { store: "google".into(), app_id: "com.example.app".into(), ..apple.clone() };
        assert!(google.clone().normalize().is_ok());
        assert!(Monitor { app_id: "example".into(), ..google.clone() }.normalize().is_err());
        assert!(Monitor { app_id: "com.1example.app".into(), ..google }.normalize().is_err());
    }

    #[test]
    fn dns_monitors_need_a_name_and_a_known_type() {
        let dns = Monitor { name: "DNS".into(), kind: Kind::Dns, host: "example.com".into(), dns_type: "mx".into(), ..Monitor::default() };
        assert_eq!(dns.clone().normalize().unwrap().dns_type, "MX");
        assert!(Monitor { dns_type: "SRV".into(), ..dns.clone() }.normalize().is_err());
        assert!(Monitor { host: "1.2.3.4".into(), ..dns.clone() }.normalize().is_err());
        assert!(Monitor { dns_server: "1.1.1.1".into(), ..dns.clone() }.normalize().is_ok());
        assert!(Monitor { dns_server: "[2606:4700::1111]:53".into(), ..dns.clone() }.normalize().is_ok());
        assert!(Monitor { dns_server: "dns.google".into(), ..dns }.normalize().is_err());
    }

    #[test]
    fn alert_targets_are_checked() {
        let slack = Target { kind: "slack".into(), url: "https://hooks.slack.com/services/T0/B0/x".into(), ..Target::default() };
        assert_eq!(slack.clone().normalize().unwrap().name, "Slack");
        assert!(Target { url: "https://evil.example/".into(), ..slack.clone() }.normalize().is_err());
        let hook = Target { kind: "webhook".into(), url: "http://example.com/hook".into(), ..Target::default() };
        assert!(hook.clone().normalize().is_err());
        assert!(Target { url: "http://localhost:8080/hook".into(), ..hook.clone() }.normalize().is_ok());
        let telegram = Target { kind: "telegram".into(), token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc".into(), chat: "-1001234567890".into(), ..Target::default() };
        assert!(telegram.clone().normalize().is_ok());
        assert!(Target { chat: "abc".into(), ..telegram }.normalize().is_err());
        let ntfy = Target { kind: "ntfy".into(), topic: "my-alerts".into(), ..Target::default() };
        assert_eq!(ntfy.normalize().unwrap().url, "https://ntfy.sh");
    }

    #[test]
    fn a_monitor_round_trips_through_json_with_missing_fields() {
        let monitor: Monitor = serde_json::from_str(r#"{"id":"m1","name":"A","url":"https://a.b"}"#).unwrap();
        assert_eq!(monitor.interval, 60);
        assert_eq!(monitor.method, "GET");
        let text = serde_json::to_string(&monitor).unwrap();
        assert!(text.contains("\"retryInterval\":20"));
        let beat = Beat { t: 1, s: BeatStatus::Up, ms: Some(12), code: Some(200), why: String::new(), msg: String::new(), slow: false };
        assert_eq!(serde_json::to_string(&beat).unwrap(), r#"{"t":1,"s":"up","ms":12,"code":200}"#);
    }

    #[test]
    fn a_bucket_keeps_its_stretches_in_order_and_joins_neighbours() {
        let hour = 1_800_000_000_000 - 1_800_000_000_000 % 3_600_000;
        let mut bucket = Bucket { t: hour, ..Bucket::default() };
        bucket.add_span(hour + 600_000, hour + 1_200_000, false);
        bucket.add_span(hour, hour + 600_000, false);
        bucket.add_span(hour + 1_200_000, hour + 1_800_000, true);
        bucket.add_span(hour + 1_800_000, hour + 3_600_000, false);
        assert_eq!(bucket.spans, vec![[0, 1_200_000, 0], [1_200_000, 1_800_000, 1], [1_800_000, 3_600_000, 0]]);
        assert_eq!((bucket.up, bucket.down), (3_000_000, 600_000));
        // The whole hour, then only its second half.
        assert_eq!(bucket.time_in(hour - 1, hour + 3_600_000, i64::MAX), (3_000_000, 600_000));
        assert_eq!(bucket.time_in(hour + 1_800_000, hour + 3_600_000, i64::MAX), (1_800_000, 0));
        assert_eq!(bucket.time_in(hour + 1_500_000, hour + 2_000_000, i64::MAX), (200_000, 300_000));
        // Stretches survive a trip through JSON.
        let back: Bucket = serde_json::from_str(&serde_json::to_string(&bucket).unwrap()).unwrap();
        assert_eq!(back, bucket);
        // A line carries its format; one without it is an earlier build's.
        assert!(back.is_current());
        let [seconds, rewritten] = crate::uptime::history::earlier_hour_lines(hour);
        assert!(!serde_json::from_str::<Bucket>(&seconds).unwrap().is_current());
        assert!(!serde_json::from_str::<Bucket>(&rewritten).unwrap().is_current());
    }

    #[test]
    fn time_without_stretches_counts_in_proportion() {
        // Time no stretch holds, with no stretch before it, spreads over the hour.
        let hour = 1_800_000_000_000 - 1_800_000_000_000 % 3_600_000;
        let bucket = Bucket { t: hour, up: 3_000_000, down: 600_000, ..Bucket::default() };
        assert_eq!(bucket.time_in(hour + 1_800_000, hour + 3_600_000, i64::MAX), (1_500_000, 300_000));
        assert_eq!(bucket.time_in(hour, hour + 3_600_000, i64::MAX), (3_000_000, 600_000));
    }

    #[test]
    fn a_check_covers_its_own_wait_and_timeout() {
        let monitor = Monitor { interval: 60, retry_interval: 20, timeout: 10, ..Monitor::default() };
        assert_eq!(monitor.cover_ms(BeatStatus::Up), 85_000);
        assert_eq!(monitor.cover_ms(BeatStatus::Down), 85_000);
        assert_eq!(monitor.cover_ms(BeatStatus::Pending), 45_000);
    }

    #[test]
    fn stretches_keep_the_milliseconds() {
        // The fourth audit: 2.804 s up after a minute down written the old
        // way showed 4.76% (3 s up) instead of 4.46%.
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let mut bucket = Bucket { t, down: 60_000, n: 1, fails: 1, ..Bucket::default() };
        bucket.add_span(t + 600_500, t + 603_304, false);
        let now = t + 603_400;
        assert_eq!(bucket.time_in(now - 86_400_000, now, i64::MAX), (2_804, 60_000));
    }

    /// Hours as this build writes them, a few long stretches or more than
    /// `MAX_SPANS` short ones, each read through many windows: no window
    /// holds more than it lasts, windows that split the hour add up to its
    /// totals, and moving where a window starts by 1 ms moves what it holds
    /// by at most that much.
    #[test]
    fn windows_add_up_and_never_overflow() {
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let mut seed: u64 = 7;
        let mut next = |limit: i64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) % limit as u64) as i64
        };
        let mut overflowed = 0;
        for case in 0..64 {
            let mut bucket = Bucket { t, ..Bucket::default() };
            let mut at = next(300_000);
            let dense = case % 4 == 3;
            for _ in 0..(if dense { 900 } else { next(30) }) {
                let length = if dense { 500 + next(2_500) } else { 500 + next(40_000) };
                if at + length >= 3_600_000 {
                    break;
                }
                bucket.add_span(t + at, t + at + length, next(2) == 1);
                at += length + if dense { next(1_200) } else { next(5_000) };
            }
            if bucket.spans.len() == MAX_SPANS && (bucket.up + bucket.down) > bucket.spans.iter().map(|span| (span[1] - span[0]) as i64).sum::<i64>() {
                overflowed += 1;
            }
            let now = t + at.min(3_599_999) + next(60_000);
            let end = now.min(t + 3_600_000);
            let (mut sum_up, mut sum_down) = (0, 0);
            let mut from = t;
            while from < end {
                let to = (from + 1 + next(120_000)).min(end);
                let (up, down) = bucket.time_in(from, to, now);
                assert!(up >= 0 && down >= 0 && up + down <= to - from + 1, "case {case}: {up} + {down} in {} ms", to - from);
                if from > t {
                    let (up_later, down_later) = bucket.time_in(from + 1, to, now);
                    assert!((up + down) - (up_later + down_later) <= 2, "case {case}: 1 ms moved {} ms", (up + down) - (up_later + down_later));
                }
                sum_up += up;
                sum_down += down;
                from = to;
            }
            assert!((sum_up - bucket.up).abs() <= 64 && (sum_down - bucket.down).abs() <= 64, "case {case}: ({sum_up}, {sum_down}) for ({}, {})", bucket.up, bucket.down);
            // The window that leaves out only the first ms.
            let (up, down) = bucket.time_in(t + 1, end, now);
            assert!((bucket.up + bucket.down) - (up + down) <= 2, "case {case}: the first ms took {} ms", (bucket.up + bucket.down) - (up + down));
        }
        assert!(overflowed >= 8, "only {overflowed} cases went past MAX_SPANS");
    }

    #[test]
    fn totals_that_dont_fit_never_fill_more_than_the_window() {
        // Not written by this build, but by hand say: 100 s up in an hour
        // whose time ends 10 s in. A window that cuts it holds at most itself.
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let bucket = Bucket { t, up: 100_000, until: 10_000, ..Bucket::default() };
        let (up, down) = bucket.time_in(t + 1, t + 10_000, t + 60_000);
        assert!(up + down <= 9_999, "{up} + {down} in 9,999 ms");
    }

    #[test]
    fn time_past_the_last_stretch_spreads_after_it() {
        // 720 stretches of 2 s with 1 s between, then 30 s more seen up.
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let mut bucket = Bucket { t, ..Bucket::default() };
        for index in 0..MAX_SPANS as i64 {
            bucket.add_span(t + index * 3_000, t + index * 3_000 + 2_000, index % 2 == 1);
        }
        let last = t + (MAX_SPANS as i64 - 1) * 3_000 + 2_000;
        bucket.add_span(last + 10_000, last + 40_000, false);
        assert_eq!(bucket.spans.len(), MAX_SPANS);
        let now = last + 60_000;
        // Nothing of it before the last kept stretch, all of it after.
        assert_eq!(bucket.time_in(t, last, now), (720_000, 720_000));
        assert_eq!(bucket.time_in(last, now, now), (30_000, 0));
        // Spread over the 40 s from the last stretch to where the time ends.
        assert_eq!(bucket.time_in(last, last + 20_000, now), (15_000, 0));
    }

    #[test]
    fn time_this_build_measured_is_never_scaled() {
        // The eighth audit: 10 s of new downtime in an hour an earlier build
        // had rewritten read 9,574 ms, scaled down with the rewritten seconds.
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let [_, rewritten] = crate::uptime::history::earlier_hour_lines(t);
        let mut bucket: Bucket = serde_json::from_str(&rewritten).unwrap();
        bucket.add_span(t + 3_585_000, t + 3_595_000, true);
        assert_eq!(bucket.time_in(t + 3_585_000, t + 3_595_000, t + 3_600_000), (0, 10_000));
    }

    /// The third audit's inputs: 87 checks up for 20.9 s, each followed by
    /// one down for 20.1 s.
    fn alternating(t: i64) -> (Bucket, Vec<(i64, i64, bool)>) {
        let mut bucket = Bucket { t, ..Bucket::default() };
        let mut spans = Vec::new();
        let mut at = t + 10_400;
        for _ in 0..87 {
            spans.push((at, at + 20_900, false));
            spans.push((at + 20_900, at + 41_000, true));
            at += 41_000;
        }
        for &(from, to, down) in &spans {
            bucket.add_span(from, to, down);
        }
        (bucket, spans)
    }

    #[test]
    fn a_window_holding_every_check_counts_exactly() {
        // The fourth audit: 87 cycles, and 78.3 s of downtime added to a
        // window that held every check.
        let t = 1_800_000_000_000 - (1_800_000_000_000 % 3_600_000);
        let (bucket, spans) = alternating(t);
        let now = spans.last().unwrap().1 + 50;
        assert_eq!(bucket.time_in(now - 86_400_000, now, i64::MAX), (87 * 20_900, 87 * 20_100));
        // A window that starts inside the hour takes exactly its part.
        let from = t + 500_000;
        let expected = spans.iter().fold((0, 0), |(up, down), &(a, b, is_down)| {
            let overlap = (b.min(now) - a.max(from)).max(0);
            if is_down {
                (up, down + overlap)
            } else {
                (up + overlap, down)
            }
        });
        assert_eq!(bucket.time_in(from, now, i64::MAX), expected);
    }

    #[test]
    fn an_app_store_number_loses_its_leading_zeros() {
        let monitor = Monitor { id: "m1".into(), name: "A".into(), kind: Kind::Store, store: "apple".into(), app_id: " 0361309726 ".into(), country: "us".into(), ..Monitor::default() };
        assert_eq!(monitor.clone().normalize().unwrap().app_id, "361309726");
        assert!(Monitor { app_id: "000".into(), ..monitor }.normalize().is_err());
    }

    #[test]
    fn same_check_ignores_what_a_check_doesnt_read() {
        let a = web("https://example.com").normalize().unwrap();
        let mut b = a.clone();
        b.name = "Other".into();
        b.interval = 300;
        b.paused = true;
        assert!(a.same_check(&b));
        b.url = "https://example.org".into();
        assert!(!a.same_check(&b));
    }
}
