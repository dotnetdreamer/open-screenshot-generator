//! The checks themselves. Each one answers with an `Outcome`: whether the
//! monitor passed, how long the answer took, and when it failed, why, as a
//! short code for the page and a sentence for people. Those sentences go into
//! notifications and the history as they are, so they say what happened in
//! everyday words and leave the library's own error for the details view.
//!
//! Web pages and store listings go through the HTTP client the Tauri HTTP
//! plugin already ships (reqwest with rustls). Ports, pings and DNS records
//! use the standard library's sockets on a thread of their own.

use std::collections::HashMap;
use std::io;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri_plugin_http::reqwest::{self, redirect, Client, Method};

use super::clock::now_ms;
use super::model::{accepts, dns_server_addr, json_path_steps, Detail, Kind, Monitor, Step};
use super::{cert, dns, ping};

/// Pages are read this far when no words or JSON value are looked for: far
/// enough to know the page arrives, not so far that a large file is
/// downloaded every minute.
const SKIM_LIMIT: u64 = 256 * 1024;
/// And this far when the check reads the page.
const READ_LIMIT: usize = 4 * 1024 * 1024;

const USER_AGENT: &str = concat!("Mozilla/5.0 (compatible; OpenScreenshotGenerator-Uptime/", env!("CARGO_PKG_VERSION"), ")");

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub ms: Option<u32>,
    pub code: Option<u16>,
    pub why: String,
    pub msg: String,
    pub detail: Detail,
    /// The check failed without finding out anything about the monitor: a
    /// store page it can't read, a store that didn't answer, a setting this
    /// computer can't run. It is recorded and shown, and counts as neither up
    /// nor down.
    pub inconclusive: bool,
}

impl Outcome {
    fn up(elapsed: Duration) -> Outcome {
        Outcome { ok: true, ms: Some(millis(elapsed)), detail: Detail { at: now_ms(), ..Detail::default() }, ..Outcome::default() }
    }

    fn fail(why: &str, msg: impl Into<String>) -> Outcome {
        Outcome { ok: false, why: why.into(), msg: msg.into(), detail: Detail { at: now_ms(), ..Detail::default() }, ..Outcome::default() }
    }

    fn unclear(mut self) -> Outcome {
        self.inconclusive = true;
        self
    }

    fn tech(mut self, text: impl Into<String>) -> Outcome {
        let text: String = text.into();
        self.detail.tech = (!text.is_empty()).then(|| text.chars().take(600).collect());
        self
    }

    fn offer(mut self, text: &str) -> Outcome {
        self.detail.offer = Some(text.to_string());
        self
    }

    pub fn timeout(seconds: u32) -> Outcome {
        Outcome::fail("timeout", format!("No answer within {}", seconds_text(seconds)))
    }

    /// The failure codes that a lost network connection on this computer
    /// would also give.
    pub fn may_be_offline(&self) -> bool {
        !self.ok && matches!(self.why.as_str(), "timeout" | "dns" | "unreachable" | "error" | "reset")
    }
}

fn millis(elapsed: Duration) -> u32 {
    elapsed.as_millis().min(u32::MAX as u128) as u32
}

fn seconds_text(seconds: u32) -> String {
    if seconds == 1 {
        "1 second".into()
    } else {
        format!("{seconds} seconds")
    }
}

/// The clients a check can use, one per way of following redirects and
/// treating certificates. None keeps a connection open between checks, so
/// every check connects the way a new visitor would and sees the current
/// certificate.
#[derive(Default)]
pub struct Clients {
    cache: Mutex<HashMap<(u32, bool), Client>>,
}

impl Clients {
    pub fn get(&self, redirects: u32, insecure: bool) -> Result<Client, String> {
        let mut cache = self.cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(client) = cache.get(&(redirects, insecure)) {
            return Ok(client.clone());
        }
        let policy = if redirects == 0 { redirect::Policy::none() } else { redirect::Policy::limited(redirects as usize) };
        let client = Client::builder()
            .redirect(policy)
            .danger_accept_invalid_certs(insecure)
            .tls_info(true)
            .pool_max_idle_per_host(0)
            .user_agent(USER_AGENT)
            .build()
            .map_err(|error| error.to_string())?;
        cache.insert((redirects, insecure), client.clone());
        Ok(client)
    }
}

/// Runs the check for a web page or a store listing. The other kinds block,
/// and run through `blocking`.
pub async fn run_async(monitor: &Monitor, clients: &Clients) -> Outcome {
    match monitor.kind {
        Kind::Http => http(monitor, clients).await,
        Kind::Store => store(monitor, clients).await,
        _ => blocking(monitor),
    }
}

pub fn is_async(kind: Kind) -> bool {
    matches!(kind, Kind::Http | Kind::Store)
}

pub fn blocking(monitor: &Monitor) -> Outcome {
    match monitor.kind {
        Kind::Port => port(monitor),
        Kind::Ping => ping_check(monitor),
        Kind::Dns => dns_check(monitor),
        _ => Outcome::fail("error", "This check can't run here").unclear(),
    }
}

// ---- web pages --------------------------------------------------------

/// Every message in the error's chain, outermost first.
fn chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(next) = source {
        let text = next.to_string();
        if !parts.iter().any(|part| part.contains(&text)) {
            parts.push(text);
        }
        source = next.source();
    }
    parts.join(": ")
}

fn io_kind(error: &(dyn std::error::Error + 'static)) -> Option<io::ErrorKind> {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(next) = source {
        if let Some(io) = next.downcast_ref::<io::Error>() {
            return Some(io.kind());
        }
        source = next.source();
    }
    None
}

fn cert_problem(lower: &str) -> &'static str {
    if lower.contains("expired") {
        "The site's security certificate has run out"
    } else if lower.contains("notvalidforname") || lower.contains("not valid for name") || lower.contains("name mismatch") {
        "The site's security certificate is for a different address"
    } else if lower.contains("unknownissuer") || lower.contains("unknown issuer") || lower.contains("self signed") || lower.contains("selfsigned") {
        "The site's security certificate isn't from a trusted issuer"
    } else if lower.contains("notvalidyet") || lower.contains("not valid yet") {
        "The site's security certificate isn't valid yet"
    } else {
        "The secure connection to the site failed"
    }
}

/// A failed request as a reason. The order matters: a timeout can carry an
/// I/O error underneath, and a TLS failure mentions the connection.
pub fn classify(error: &reqwest::Error, timeout: u32) -> Outcome {
    let tech = chain(error);
    let lower = tech.to_lowercase();
    let outcome = if error.is_timeout() {
        Outcome::timeout(timeout)
    } else if error.is_redirect() {
        Outcome::fail("redirects", "The page sends visitors round in too many redirects")
    } else if lower.contains("dns error") || lower.contains("failed to lookup address") || lower.contains("nodename nor servname") || lower.contains("name or service not known") || lower.contains("no such host") {
        Outcome::fail("dns", "The address couldn't be found")
    } else if lower.contains("certificate") || lower.contains("tls") || lower.contains("handshake") || lower.contains("ssl") {
        Outcome::fail("tls", cert_problem(&lower))
    } else {
        match io_kind(error) {
            Some(io::ErrorKind::ConnectionRefused) => Outcome::fail("refused", "The server refused the connection"),
            Some(io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted | io::ErrorKind::BrokenPipe | io::ErrorKind::UnexpectedEof) => {
                Outcome::fail("reset", "The connection was cut off before the page arrived")
            }
            Some(io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable) => Outcome::fail("unreachable", "The server can't be reached from this network"),
            Some(io::ErrorKind::TimedOut) => Outcome::timeout(timeout),
            _ if lower.contains("connection refused") => Outcome::fail("refused", "The server refused the connection"),
            _ if lower.contains("connection reset") || lower.contains("connection closed") || lower.contains("broken pipe") => {
                Outcome::fail("reset", "The connection was cut off before the page arrived")
            }
            _ if lower.contains("unreachable") || lower.contains("no route to host") => Outcome::fail("unreachable", "The server can't be reached from this network"),
            _ => Outcome::fail("error", "The check couldn't reach the page"),
        }
    };
    outcome.tech(tech)
}

/// The reason phrase for a status code, for "The page answered 503 Service
/// Unavailable".
fn status_text(code: u16) -> String {
    match reqwest::StatusCode::from_u16(code).ok().and_then(|status| status.canonical_reason()) {
        Some(reason) => format!("{code} {reason}"),
        None => code.to_string(),
    }
}

fn shorten(text: &str, length: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= length {
        text.to_string()
    } else {
        format!("{}...", text.chars().take(length).collect::<String>())
    }
}

/// The value at a path, as text: a string without its quotes, anything else
/// as JSON.
pub fn json_value(body: &Value, path: &str) -> Option<String> {
    let mut value = body;
    for step in json_path_steps(path)? {
        value = match step {
            Step::Key(key) => value.get(key.as_str())?,
            Step::Index(index) => value.get(index)?,
        };
    }
    Some(match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    })
}

/// Compares a found value with the expected one. Numbers compare as numbers
/// for "less" and "more", and text compares without case.
pub fn json_compare(found: &str, op: &str, expected: &str) -> bool {
    let found_trim = found.trim();
    let expected = expected.trim();
    let number = |text: &str| text.parse::<f64>().ok();
    match op {
        "ne" => !found_trim.eq_ignore_ascii_case(expected),
        "contains" => found_trim.to_lowercase().contains(&expected.to_lowercase()),
        "lt" => matches!((number(found_trim), number(expected)), (Some(a), Some(b)) if a < b),
        "gt" => matches!((number(found_trim), number(expected)), (Some(a), Some(b)) if a > b),
        _ => found_trim.eq_ignore_ascii_case(expected),
    }
}

fn op_words(op: &str) -> &'static str {
    match op {
        "ne" => "anything but",
        "contains" => "something containing",
        "lt" => "less than",
        "gt" => "more than",
        _ => "",
    }
}

async fn http(monitor: &Monitor, clients: &Clients) -> Outcome {
    let client = match clients.get(monitor.redirects, monitor.ignore_tls) {
        Ok(client) => client,
        Err(error) => return Outcome::fail("error", "The check couldn't start").tech(error).unclear(),
    };
    let method = Method::from_bytes(monitor.method.as_bytes()).unwrap_or(Method::GET);
    let has_body = !monitor.body.is_empty() && !matches!(method, Method::GET | Method::HEAD);
    let mut request = client.request(method.clone(), &monitor.url).timeout(Duration::from_secs(monitor.timeout as u64));
    let mut content_type = false;
    for header in &monitor.headers {
        content_type |= header.name.eq_ignore_ascii_case("content-type");
        request = request.header(header.name.as_str(), header.value.as_str());
    }
    if has_body {
        let looks_json = matches!(monitor.body.trim_start().chars().next(), Some('{' | '['));
        if !content_type && looks_json {
            request = request.header("Content-Type", "application/json");
        }
        request = request.body(monitor.body.clone());
    }
    let started = Instant::now();
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => return classify(&error, monitor.timeout),
    };
    let code = response.status().as_u16();
    let mut detail = Detail { at: now_ms(), ..Detail::default() };
    detail.ip = response.remote_addr().map(|addr| addr.ip().to_string());
    if response.url().as_str() != monitor.url && response.url().as_str().trim_end_matches('/') != monitor.url.trim_end_matches('/') {
        detail.final_url = Some(response.url().to_string());
    }
    detail.server = response.headers().get("server").and_then(|value| value.to_str().ok()).map(|text| shorten(text, 80));
    detail.cert = response.extensions().get::<reqwest::tls::TlsInfo>().and_then(|info| info.peer_certificate()).and_then(cert::read);

    let reads = !monitor.keyword.is_empty() || !monitor.json_path.is_empty();
    let mut body: Vec<u8> = Vec::new();
    let mut total: u64 = 0;
    if method != Method::HEAD {
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    total += chunk.len() as u64;
                    if reads && body.len() < READ_LIMIT {
                        let room = READ_LIMIT - body.len();
                        body.extend_from_slice(&chunk[..chunk.len().min(room)]);
                    }
                    if (!reads && total >= SKIM_LIMIT) || (reads && body.len() >= READ_LIMIT) {
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let mut outcome = classify(&error, monitor.timeout);
                    outcome.code = Some(code);
                    outcome.detail = Detail { tech: outcome.detail.tech.clone(), ..detail };
                    return outcome;
                }
            }
        }
    }
    let elapsed = started.elapsed();
    detail.bytes = Some(total);

    let mut outcome = if !accepts(&monitor.accept, code) {
        let mut outcome = Outcome::fail("status", format!("The page answered {}", status_text(code)));
        if (300..400).contains(&code) {
            if let Some(location) = response.headers().get("location").and_then(|value| value.to_str().ok()) {
                outcome.msg = format!("The page answered {} and points to {}", status_text(code), shorten(location, 80));
            }
        }
        outcome
    } else if !monitor.keyword.is_empty() {
        let text = String::from_utf8_lossy(&body);
        let found = if monitor.keyword_case { text.contains(&monitor.keyword) } else { text.to_lowercase().contains(&monitor.keyword.to_lowercase()) };
        let shown = shorten(&monitor.keyword, 60);
        match (found, monitor.keyword_absent) {
            (true, true) => Outcome::fail("keyword_found", format!("\"{shown}\" is on the page")),
            (false, false) => Outcome::fail("keyword", format!("\"{shown}\" isn't on the page")),
            _ => Outcome::up(elapsed),
        }
    } else {
        Outcome::up(elapsed)
    };
    if outcome.ok && !monitor.json_path.is_empty() {
        outcome = match serde_json::from_slice::<Value>(&body) {
            Err(_) => Outcome::fail("json_invalid", "The answer isn't JSON"),
            Ok(json) => match json_value(&json, &monitor.json_path) {
                None => Outcome::fail("json_invalid", format!("{} isn't in the answer", monitor.json_path)),
                Some(found) => {
                    detail.found = Some(shorten(&found, 200));
                    if monitor.json_expected.trim().is_empty() || json_compare(&found, &monitor.json_op, &monitor.json_expected) {
                        Outcome::up(elapsed)
                    } else {
                        let wanted = format!("{} \"{}\"", op_words(&monitor.json_op), shorten(monitor.json_expected.trim(), 60));
                        Outcome::fail("json", format!("{} is \"{}\", not {}", monitor.json_path, shorten(&found, 60), wanted.trim()))
                    }
                }
            },
        };
    }
    outcome.code = Some(code);
    outcome.ms = Some(millis(elapsed));
    let tech = outcome.detail.tech.take();
    outcome.detail = Detail { tech, ..detail };
    outcome
}

// ---- store listings ---------------------------------------------------

async fn store(monitor: &Monitor, clients: &Clients) -> Outcome {
    let client = match clients.get(5, false) {
        Ok(client) => client,
        Err(error) => return Outcome::fail("error", "The check couldn't start").tech(error).unclear(),
    };
    let url = if monitor.store == "google" {
        format!("https://play.google.com/store/apps/details?id={}&hl=en&gl={}", monitor.app_id, monitor.country.to_uppercase())
    } else {
        format!("https://itunes.apple.com/lookup?id={}&country={}&entity=software", monitor.app_id, monitor.country)
    };
    let started = Instant::now();
    // A store that doesn't answer says nothing about the app.
    let response = match client.get(&url).timeout(Duration::from_secs(monitor.timeout as u64)).send().await {
        Ok(response) => response,
        Err(error) => return classify(&error, monitor.timeout).unclear(),
    };
    let code = response.status().as_u16();
    let final_host = response.url().host_str().unwrap_or_default().to_string();
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(error) => return classify(&error, monitor.timeout).unclear(),
    };
    store_answer(monitor, code, &final_host, &body, started.elapsed())
}

/// What a store's answer says about the app. Only a definite "not there"
/// (`store_missing`) is down, and only the store's own address can say it:
/// Google Play's 404 or its page without the app on offer, or the App
/// Store's lookup answering with no such app. Anything else is
/// inconclusive, so a store having a bad minute, a consent page on the way,
/// or Google changing its page never sends a false alert.
pub fn store_answer(monitor: &Monitor, code: u16, final_host: &str, body: &[u8], elapsed: Duration) -> Outcome {
    let country = monitor.country.to_uppercase();
    let google = monitor.store == "google";
    let store_name = if google { "Google Play" } else { "The App Store" };
    let store_host = if google { "play.google.com" } else { "itunes.apple.com" };
    let mut outcome = if final_host != store_host {
        Outcome::fail("error", format!("{store_name} showed another page instead of the app"))
    } else if code == 404 && google {
        Outcome::fail("store_missing", format!("The app isn't on Google Play in {country}"))
    } else if code != 200 {
        Outcome::fail("status", format!("{store_name} answered {}", status_text(code)))
    } else if google {
        let html = String::from_utf8_lossy(body);
        let mut outcome = match play_offer(&html) {
            PlayOffer::Install => Outcome::up(elapsed).offer("Install"),
            PlayOffer::Buy(price) => Outcome::up(elapsed).offer(&price),
            // Open for pre-registration, which only a monitor watching for
            // that counts as up. Read signed out, such a page often shows no
            // button at all, the same as an app not offered in the country.
            PlayOffer::PreRegister if monitor.listed_ok => Outcome::up(elapsed).offer("Pre-register"),
            PlayOffer::PreRegister => Outcome::fail("store_missing", format!("Google Play only takes pre-registrations for the app in {country}")),
            PlayOffer::NotOffered if monitor.listed_ok => Outcome::up(elapsed).offer("Listed"),
            PlayOffer::NotOffered => Outcome::fail("store_missing", format!("Google Play lists the app but doesn't offer it in {country}")),
            PlayOffer::Unreadable => Outcome::fail("error", "Google Play's page couldn't be read"),
        };
        outcome.detail.app_name = play_title(&html);
        outcome
    } else {
        let json = serde_json::from_slice::<Value>(body).ok();
        let count = json.as_ref().and_then(|json| json.get("resultCount")).and_then(Value::as_u64);
        let results = json.as_ref().and_then(|json| json.get("results")).and_then(Value::as_array).map(Vec::len);
        match (json.as_ref().and_then(|json| apple_app(json, &monitor.app_id)), count, results) {
            (Some(app), _, _) => {
                let mut outcome = Outcome::up(elapsed);
                outcome.detail.version = app.get("version").and_then(Value::as_str).map(str::to_string);
                outcome.detail.app_name = app.get("trackName").and_then(Value::as_str).map(str::to_string);
                outcome
            }
            (None, Some(0), Some(0)) => Outcome::fail("store_missing", format!("The app isn't on the App Store in {country}")),
            // The number belongs to something else, such as an artist.
            (None, _, _) if json.as_ref().is_some_and(|json| apple_something_else(json, &monitor.app_id)) => {
                Outcome::fail("store_missing", format!("App Store number {} isn't an app", monitor.app_id))
            }
            _ => Outcome::fail("error", "The App Store's answer couldn't be read"),
        }
    };
    if !outcome.ok && outcome.why != "store_missing" {
        outcome.inconclusive = true;
    }
    outcome.code = Some(code);
    outcome.ms = Some(millis(elapsed));
    outcome
}

/// What Google Play's page offers in the country asked for, from its main
/// button. A page with its own buttons (Share, Add to wishlist) but none of
/// these lists the app without offering it there, the way Hulu's page does
/// in the Netherlands, with a 200 all the same.
#[derive(Debug, PartialEq)]
pub enum PlayOffer {
    Install,
    /// A paid app, with its price.
    Buy(String),
    PreRegister,
    NotOffered,
    /// Not the app page Uptime knows: Google may have changed it.
    Unreadable,
}

/// The aria-label of every <button> on a page.
fn button_labels(html: &str) -> Vec<String> {
    let mut labels = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find("<button") {
        let Some(length) = rest[at..].find('>') else { break };
        let tag = &rest[at..at + length];
        if let Some(start) = tag.find("aria-label=\"") {
            let value = &tag[start + 12..];
            if let Some(end) = value.find('"') {
                labels.push(decode_entities(&value[..end]));
            }
        }
        rest = &rest[at + length..];
    }
    labels
}

pub fn play_offer(html: &str) -> PlayOffer {
    let labels = button_labels(html);
    if labels.iter().any(|label| label == "Install") {
        return PlayOffer::Install;
    }
    if let Some(label) = labels.iter().find(|label| label.as_str() == "Buy" || label.ends_with(" Buy")) {
        return PlayOffer::Buy(label.trim_end_matches("Buy").trim().to_string());
    }
    if labels.iter().any(|label| label == "Pre-register") {
        return PlayOffer::PreRegister;
    }
    if labels.iter().any(|label| label == "Share" || label == "Add to wishlist") {
        return PlayOffer::NotOffered;
    }
    PlayOffer::Unreadable
}

/// The app in an App Store lookup answer: the result that is software with
/// the number asked for, read as a number, so 0361309726 finds 361309726 as
/// Apple does. The lookup answers a number that belongs to an artist or a
/// book just the same.
pub fn apple_app<'a>(json: &'a Value, app_id: &str) -> Option<&'a Value> {
    let wanted = app_id.parse::<u64>().ok()?;
    json.get("results")?.as_array()?.iter().find(|result| {
        result.get("wrapperType").and_then(Value::as_str) == Some("software") && result.get("trackId").and_then(Value::as_u64) == Some(wanted)
    })
}

/// Whether the lookup says the number belongs to something other than an
/// app: a result that isn't software and carries the number as its own id.
/// A result that says nothing about the number says nothing.
fn apple_something_else(json: &Value, app_id: &str) -> bool {
    let Ok(wanted) = app_id.parse::<u64>() else { return false };
    json.get("results").and_then(Value::as_array).is_some_and(|results| {
        results.iter().any(|result| {
            result.get("wrapperType").and_then(Value::as_str).is_some_and(|kind| kind != "software")
                && ["artistId", "collectionId", "trackId"].iter().any(|key| result.get(*key).and_then(Value::as_u64) == Some(wanted))
        })
    })
}

/// The app's name from a Google Play page's title ("Name - Apps on Google Play").
fn play_title(html: &str) -> Option<String> {
    let start = html.find("<title")?;
    let open_end = html[start..].find('>')? + start + 1;
    let close = html[open_end..].find("</title>")? + open_end;
    let title = html[open_end..close].trim();
    let name = title.split(" - Apps on Google Play").next().unwrap_or(title).trim();
    (!name.is_empty()).then(|| decode_entities(name))
}

fn decode_entities(text: &str) -> String {
    text.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">")
}

// ---- ports, pings, DNS --------------------------------------------------

fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, Outcome> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![SocketAddr::new(ip, port)]);
    }
    match (host, port).to_socket_addrs() {
        Ok(addresses) => {
            let mut addresses: Vec<SocketAddr> = addresses.collect();
            // IPv4 first: a computer with an IPv6 address but no IPv6 route
            // would otherwise spend the whole timeout on the first address.
            addresses.sort_by_key(|addr| addr.is_ipv6());
            if addresses.is_empty() {
                Err(Outcome::fail("dns", "The address couldn't be found"))
            } else {
                Ok(addresses)
            }
        }
        Err(error) => Err(Outcome::fail("dns", "The address couldn't be found").tech(error.to_string())),
    }
}

fn socket_failure(error: &io::Error, timeout: u32) -> Outcome {
    let outcome = match error.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => Outcome::timeout(timeout),
        io::ErrorKind::ConnectionRefused => Outcome::fail("refused", "The server refused the connection"),
        io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted => Outcome::fail("reset", "The connection was cut off"),
        io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable => Outcome::fail("unreachable", "The server can't be reached from this network"),
        io::ErrorKind::PermissionDenied => Outcome::fail("error", "This computer doesn't let the app make that connection").unclear(),
        _ => Outcome::fail("error", "The connection failed"),
    };
    outcome.tech(error.to_string())
}

fn port(monitor: &Monitor) -> Outcome {
    let started = Instant::now();
    let limit = Duration::from_secs(monitor.timeout as u64);
    let addresses = match resolve(&monitor.host, monitor.port) {
        Ok(addresses) => addresses,
        Err(outcome) => return outcome,
    };
    let mut last: Option<io::Error> = None;
    for address in addresses {
        let Some(left) = limit.checked_sub(started.elapsed()).filter(|left| !left.is_zero()) else { break };
        let connecting = Instant::now();
        match TcpStream::connect_timeout(&address, left) {
            Ok(stream) => {
                drop(stream);
                let mut outcome = Outcome::up(connecting.elapsed());
                outcome.detail.ip = Some(address.ip().to_string());
                return outcome;
            }
            Err(error) => last = Some(error),
        }
    }
    match last {
        Some(error) => socket_failure(&error, monitor.timeout),
        None => Outcome::timeout(monitor.timeout),
    }
}

fn ping_check(monitor: &Monitor) -> Outcome {
    let started = Instant::now();
    let limit = Duration::from_secs(monitor.timeout as u64);
    let address = match resolve(&monitor.host, 0) {
        Ok(addresses) => addresses[0].ip(),
        Err(outcome) => return outcome,
    };
    let left = limit.checked_sub(started.elapsed()).unwrap_or(Duration::from_millis(1)).max(Duration::from_millis(1));
    let mut outcome = match ping::echo(address, left) {
        Ok(time) => Outcome::up(time),
        Err(error) if matches!(error.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock) => {
            Outcome::fail("timeout", format!("No reply within {}", seconds_text(monitor.timeout))).tech(error.to_string())
        }
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            Outcome::fail("error", "This computer doesn't let the app send a ping").tech(error.to_string()).unclear()
        }
        Err(error) => socket_failure(&error, monitor.timeout),
    };
    outcome.detail.ip = Some(address.to_string());
    outcome
}

fn dns_check(monitor: &Monitor) -> Outcome {
    let started = Instant::now();
    let limit = Duration::from_secs(monitor.timeout as u64);
    let Some(qtype) = dns::type_code(&monitor.dns_type) else {
        return Outcome::fail("error", "This record type can't be checked").unclear();
    };
    let servers: Vec<SocketAddr> = if monitor.dns_server.is_empty() { dns::system_servers() } else { dns_server_addr(&monitor.dns_server).into_iter().collect() };
    let records: Vec<String>;
    let mut asked = None;
    if servers.is_empty() {
        // No server to ask directly (Windows, with none typed): the system
        // lookup covers addresses.
        if !matches!(qtype, 1 | 28) {
            return Outcome::fail("error", "Type a DNS server to ask, such as your router's address or 1.1.1.1").unclear();
        }
        match (monitor.host.as_str(), 0).to_socket_addrs() {
            Ok(found) => records = found.filter(|addr| addr.is_ipv6() == (qtype == 28)).map(|addr| addr.ip().to_string()).collect(),
            Err(error) => return Outcome::fail("dns", format!("{} couldn't be found", monitor.host)).tech(error.to_string()),
        }
    } else {
        let mut last_error = None;
        let mut answer = None;
        for server in servers.iter().take(2) {
            let Some(left) = limit.checked_sub(started.elapsed()).filter(|left| !left.is_zero()) else { break };
            match dns::ask(*server, &monitor.host, qtype, left) {
                Ok(found) => {
                    asked = Some(*server);
                    answer = Some(found);
                    break;
                }
                Err(error) => last_error = Some(error),
            }
        }
        let Some(answer) = answer else {
            return match last_error {
                Some(error) if matches!(error.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock) => Outcome::fail("timeout", format!("The DNS server didn't answer within {}", seconds_text(monitor.timeout))).tech(error.to_string()),
                Some(error) => socket_failure(&error, monitor.timeout),
                None => Outcome::timeout(monitor.timeout),
            };
        };
        if answer.rcode == 3 {
            return Outcome::fail("dns", format!("{} doesn't exist", monitor.host)).tech(format!("{} answered NXDOMAIN", asked.map(|a| a.ip().to_string()).unwrap_or_default()));
        }
        if answer.rcode != 0 {
            return Outcome::fail("dns", format!("The DNS server answered with {}", dns::rcode_name(answer.rcode)));
        }
        records = answer.records;
    }
    let elapsed = started.elapsed();
    let mut outcome = if records.is_empty() {
        Outcome::fail("dns_empty", format!("{} has no {} records", monitor.host, monitor.dns_type))
    } else {
        let contains = matches!(qtype, 16 | 257);
        let missing: Vec<&str> = monitor
            .dns_expect
            .split(',')
            .map(str::trim)
            .filter(|wanted| !wanted.is_empty())
            .filter(|wanted| !records.iter().any(|record| dns::matches(record, wanted, contains)))
            .collect();
        if missing.is_empty() {
            Outcome::up(elapsed)
        } else {
            Outcome::fail("dns_mismatch", format!("The {} records don't include {}", monitor.dns_type, shorten(&missing.join(", "), 80)))
        }
    };
    outcome.ms = Some(millis(elapsed));
    outcome.detail.answers = records.into_iter().take(20).map(|record| shorten(&record, 300)).collect();
    outcome.detail.ip = asked.map(|server| server.ip().to_string());
    outcome
}

/// Whether this computer has a network route at all. Connecting a UDP
/// socket sends nothing; it only asks the system for a route, which a
/// computer with Wi-Fi off or the cable out doesn't have. The addresses are
/// the ones set aside for documentation, so nothing is ever sent to them.
pub fn has_route() -> bool {
    let try_route = |bind: &str, to: &str| -> bool {
        std::net::UdpSocket::bind(bind).and_then(|socket| socket.connect(to)).is_ok()
    };
    try_route("0.0.0.0:0", "192.0.2.1:9") || try_route("[::]:0", "[2001:db8::1]:9")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn json_values_are_found_and_compared() {
        let body: Value = serde_json::from_str(r#"{"status":"ok","data":{"items":[{"count":3,"live":true}]}}"#).unwrap();
        assert_eq!(json_value(&body, "status").as_deref(), Some("ok"));
        assert_eq!(json_value(&body, "$.data.items[0].count").as_deref(), Some("3"));
        assert_eq!(json_value(&body, "data.items[0].live").as_deref(), Some("true"));
        assert_eq!(json_value(&body, "data.items[1]"), None);
        assert!(json_compare("ok", "eq", "OK"));
        assert!(json_compare("degraded", "ne", "ok"));
        assert!(json_compare("All systems go", "contains", "systems"));
        assert!(json_compare("3", "lt", "10"));
        assert!(!json_compare("30", "lt", "10"));
        assert!(json_compare("30", "gt", "10"));
        assert!(!json_compare("abc", "gt", "10"));
    }

    #[test]
    fn play_titles_are_read() {
        assert_eq!(play_title("<html><head><title>Ludo &amp; Friends - Apps on Google Play</title>").as_deref(), Some("Ludo & Friends"));
        assert_eq!(play_title("<title id=\"x\">Plain</title>").as_deref(), Some("Plain"));
        assert_eq!(play_title("no title"), None);
    }

    #[test]
    fn an_open_and_a_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let open = listener.local_addr().unwrap().port();
        let monitor = Monitor { kind: Kind::Port, host: "127.0.0.1".into(), port: open, timeout: 2, ..Monitor::default() };
        let outcome = port(&monitor);
        assert!(outcome.ok, "{outcome:?}");
        assert_eq!(outcome.detail.ip.as_deref(), Some("127.0.0.1"));
        drop(listener);
        let closed = port(&Monitor { port: open, ..monitor });
        assert!(!closed.ok);
        assert_eq!(closed.why, "refused");
    }

    #[test]
    fn an_unknown_name_fails_as_dns() {
        let monitor = Monitor { kind: Kind::Port, host: "no-such-host.invalid".into(), port: 80, timeout: 5, ..Monitor::default() };
        let outcome = port(&monitor);
        assert!(!outcome.ok);
        assert_eq!(outcome.why, "dns");
    }

    /// A one-shot web server on this computer that answers with `reply`.
    fn serve(reply: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/health", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = vec![0u8; 4096];
            let size = stream.read(&mut request).unwrap_or(0);
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&request[..size]).into_owned()
        });
        (url, handle)
    }

    fn run(monitor: &Monitor) -> Outcome {
        tauri::async_runtime::block_on(async { run_async(monitor, &Clients::default()).await })
    }

    #[test]
    fn a_page_that_answers_200_with_the_words_is_up() {
        let (url, server) = serve("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nServer: test\r\nContent-Length: 27\r\nConnection: close\r\n\r\n<h1>Welcome to Shop</h1>  \n");
        let monitor = Monitor { url, keyword: "welcome".into(), headers: vec![super::super::model::Header { name: "X-Probe".into(), value: "1".into() }], ..Monitor::default() };
        let outcome = run(&monitor);
        assert!(outcome.ok, "{outcome:?}");
        assert_eq!(outcome.code, Some(200));
        assert_eq!(outcome.detail.server.as_deref(), Some("test"));
        let request = server.join().unwrap();
        assert!(request.to_lowercase().contains("x-probe: 1"));
        assert!(request.contains("OpenScreenshotGenerator-Uptime"));
    }

    #[test]
    fn a_503_is_down_with_its_reason() {
        let (url, _server) = serve("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let outcome = run(&Monitor { url, ..Monitor::default() });
        assert!(!outcome.ok);
        assert_eq!(outcome.why, "status");
        assert_eq!(outcome.msg, "The page answered 503 Service Unavailable");
        assert_eq!(outcome.code, Some(503));
    }

    #[test]
    fn missing_words_and_present_words_fail() {
        let (url, _server) = serve("HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nMaintenance!!");
        let outcome = run(&Monitor { url, keyword: "Welcome".into(), ..Monitor::default() });
        assert_eq!(outcome.why, "keyword");
        assert_eq!(outcome.msg, "\"Welcome\" isn't on the page");
        let (url, _server) = serve("HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nMaintenance!!");
        let outcome = run(&Monitor { url, keyword: "maintenance".into(), keyword_absent: true, ..Monitor::default() });
        assert_eq!(outcome.why, "keyword_found");
    }

    #[test]
    fn a_json_value_that_changed_fails() {
        let (url, _server) = serve("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{\"status\":\"degraded\"");
        let outcome = run(&Monitor { url: url.clone(), json_path: "status".into(), json_expected: "ok".into(), ..Monitor::default() });
        // The body above is cut short, so it isn't JSON.
        assert_eq!(outcome.why, "json_invalid");
        let (url, _server) = serve("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 21\r\nConnection: close\r\n\r\n{\"status\":\"degraded\"}");
        let outcome = run(&Monitor { url, json_path: "status".into(), json_expected: "ok".into(), ..Monitor::default() });
        assert_eq!(outcome.why, "json");
        assert_eq!(outcome.msg, "status is \"degraded\", not \"ok\"");
        assert_eq!(outcome.detail.found.as_deref(), Some("degraded"));
    }

    #[test]
    fn a_redirect_not_followed_says_where_it_points() {
        let (url, _server) = serve("HTTP/1.1 301 Moved Permanently\r\nLocation: https://example.com/new\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let outcome = run(&Monitor { url, redirects: 0, ..Monitor::default() });
        assert_eq!(outcome.why, "status");
        assert_eq!(outcome.msg, "The page answered 301 Moved Permanently and points to https://example.com/new");
    }

    #[test]
    fn a_server_that_never_answers_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let hold = thread::spawn(move || {
            let accepted = listener.accept();
            thread::sleep(Duration::from_secs(3));
            drop(accepted);
        });
        let outcome = run(&Monitor { url, timeout: 1, ..Monitor::default() });
        assert_eq!(outcome.why, "timeout", "{outcome:?}");
        assert_eq!(outcome.msg, "No answer within 1 second");
        hold.join().unwrap();
    }

    #[test]
    fn a_refused_connection_reads_as_refused() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        drop(listener);
        let outcome = run(&Monitor { url, ..Monitor::default() });
        assert_eq!(outcome.why, "refused", "{outcome:?}");
    }

    #[test]
    fn the_route_question_answers_at_once() {
        // The answer itself depends on the test machine's network. What
        // matters here is that asking takes no time: nothing is sent.
        let started = Instant::now();
        let _ = has_route();
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    // Cut from the real pages fetched 2026-11-26: Hulu (Install in the US,
    // no button in the Netherlands) and Minecraft ($6.99 Buy).
    const PLAY_BUTTON: &str = r#"<button class="VfPpkd-LgbsSe VfPpkd-LgbsSe-OWXEXe-k8QpJ VfPpkd-LgbsSe-OWXEXe-dgl2Hf nCP5yc AjY5Oe DuMIQc LQeN7 MjT6xe sOCCfd brKGGd BhQfub  zwjsl" jscontroller="soHxf" jsaction="click:cOuCgd; mousedown:UX7yZ" aria-label="LABEL"><span>LABEL</span></button>"#;
    const PLAY_PAGE_BUTTONS: &str = r#"<button class="VfPpkd-LgbsSe ksBjEc lKxP2d LQeN7 yIoKuc aLey0c" jscontroller="soHxf" aria-label="Share"></button><button class="VfPpkd-LgbsSe ksBjEc lKxP2d LQeN7 LS2TS aLey0c" jscontroller="soHxf" aria-label="Add to wishlist"></button>"#;

    fn play_page(cta: Option<&str>) -> String {
        let button = cta.map(|label| PLAY_BUTTON.replace("LABEL", label)).unwrap_or_default();
        format!("<html><head><title>Hulu: Stream TV shows &amp; movies - Apps on Google Play</title></head><body>{button}{PLAY_PAGE_BUTTONS}</body></html>")
    }

    #[test]
    fn google_play_counts_only_an_app_it_offers() {
        assert_eq!(play_offer(&play_page(Some("Install"))), PlayOffer::Install);
        assert_eq!(play_offer(&play_page(Some("$6.99 Buy"))), PlayOffer::Buy("$6.99".into()));
        assert_eq!(play_offer(&play_page(Some("€3.99 Buy"))), PlayOffer::Buy("€3.99".into()));
        assert_eq!(play_offer(&play_page(Some("Pre-register"))), PlayOffer::PreRegister);
        // Hulu in the Netherlands: the page is there, the button isn't.
        assert_eq!(play_offer(&play_page(None)), PlayOffer::NotOffered);
        assert_eq!(play_offer("<html><body>Something else</body></html>"), PlayOffer::Unreadable);
        assert_eq!(play_offer("<button aria-label=\"Install\""), PlayOffer::Unreadable);
    }

    #[test]
    fn a_store_answer_that_isnt_about_the_app_is_never_down() {
        // The third audit: Apple answering 200 with an error, and a redirect
        // that ended in a 404 on Google's consent page.
        let quick = Duration::from_millis(200);
        let apple = Monitor { kind: Kind::Store, store: "apple".into(), app_id: "361309726".into(), country: "us".into(), ..Monitor::default() };
        let maintenance = store_answer(&apple, 200, "itunes.apple.com", br#"{"error":"maintenance"}"#, quick);
        assert!(!maintenance.ok && maintenance.inconclusive, "{maintenance:?}");
        let google = Monitor { kind: Kind::Store, store: "google".into(), app_id: "com.example.app".into(), country: "us".into(), ..Monitor::default() };
        let consent = store_answer(&google, 404, "consent.google.com", b"", quick);
        assert!(!consent.ok && consent.inconclusive, "{consent:?}");
        // The store's own answers stay definite.
        assert_eq!(store_answer(&google, 404, "play.google.com", b"", quick).why, "store_missing");
        let none = store_answer(&apple, 200, "itunes.apple.com", br#"{"resultCount":0,"results":[]}"#, quick);
        assert_eq!((none.why.as_str(), none.inconclusive), ("store_missing", false));
    }

    #[test]
    fn an_app_store_number_is_read_as_a_number() {
        // The fourth audit: Apple answered Pages for 0361309726, as 361309726.
        let quick = Duration::from_millis(200);
        let apple = Monitor { kind: Kind::Store, store: "apple".into(), app_id: "0361309726".into(), country: "us".into(), ..Monitor::default() };
        let pages = br#"{"resultCount":1,"results":[{"wrapperType":"software","trackId":361309726,"trackName":"Pages: Create Documents","version":"16.0"}]}"#;
        let answer = store_answer(&apple, 200, "itunes.apple.com", pages, quick);
        assert!(answer.ok, "{answer:?}");
        assert_eq!(answer.detail.version.as_deref(), Some("16.0"));
    }

    #[test]
    fn only_a_result_about_the_number_says_it_isnt_an_app() {
        // The fourth audit: {"resultCount":1,"results":[{}]} read as "isn't an app".
        let quick = Duration::from_millis(200);
        let apple = Monitor { kind: Kind::Store, store: "apple".into(), app_id: "909253".into(), country: "us".into(), ..Monitor::default() };
        let answer = |body: &[u8]| store_answer(&apple, 200, "itunes.apple.com", body, quick);
        let empty = answer(br#"{"resultCount":1,"results":[{}]}"#);
        assert!(!empty.ok && empty.inconclusive, "{empty:?}");
        let someone_else = answer(br#"{"resultCount":1,"results":[{"wrapperType":"artist","artistId":1}]}"#);
        assert!(!someone_else.ok && someone_else.inconclusive, "{someone_else:?}");
        let artist = answer(br#"{"resultCount":1,"results":[{"wrapperType":"artist","artistId":909253}]}"#);
        assert_eq!((artist.why.as_str(), artist.inconclusive), ("store_missing", false));
    }

    #[test]
    fn pre_registration_counts_as_up_only_when_asked_for() {
        // The third audit: a Pre-register button passed for "people can install it".
        let quick = Duration::from_millis(200);
        let google = Monitor { kind: Kind::Store, store: "google".into(), app_id: "com.example.app".into(), country: "us".into(), ..Monitor::default() };
        let page = play_page(Some("Pre-register"));
        let install = store_answer(&google, 200, "play.google.com", page.as_bytes(), quick);
        assert_eq!((install.ok, install.why.as_str(), install.inconclusive), (false, "store_missing", false));
        let listed = Monitor { listed_ok: true, ..google };
        let open = store_answer(&listed, 200, "play.google.com", page.as_bytes(), quick);
        assert!(open.ok);
        assert_eq!(open.detail.offer.as_deref(), Some("Pre-register"));
    }

    #[test]
    fn only_a_definite_answer_from_a_store_is_down() {
        let listing = Monitor { kind: Kind::Store, store: "google".into(), app_id: "com.hulu.plus".into(), country: "nl".into(), ..Monitor::default() };
        let quick = Duration::from_millis(200);
        let answer = |code: u16, host: &str, body: &str| store_answer(&listing, code, host, body.as_bytes(), quick);
        let not_offered = answer(200, "play.google.com", &play_page(None));
        assert_eq!((not_offered.ok, not_offered.why.as_str(), not_offered.inconclusive), (false, "store_missing", false));
        assert_eq!(not_offered.msg, "Google Play lists the app but doesn't offer it in NL");
        assert!(answer(404, "play.google.com", "").why == "store_missing" && !answer(404, "play.google.com", "").inconclusive);
        for unclear in [answer(200, "play.google.com", "<html>changed</html>"), answer(503, "play.google.com", ""), answer(200, "consent.google.com", "<html></html>")] {
            assert!(!unclear.ok && unclear.inconclusive, "{unclear:?}");
        }
        let installable = answer(200, "play.google.com", &play_page(Some("Install")));
        assert!(installable.ok);
        assert_eq!(installable.detail.offer.as_deref(), Some("Install"));
        // Watching a page open for pre-registration: listed is enough.
        let listed = Monitor { listed_ok: true, ..listing.clone() };
        let preregistration = store_answer(&listed, 200, "play.google.com", play_page(None).as_bytes(), quick);
        assert!(preregistration.ok);
        assert_eq!(preregistration.detail.offer.as_deref(), Some("Listed"));
        let apple = Monitor { store: "apple".into(), app_id: "909253".into(), country: "us".into(), ..listing };
        let artist = store_answer(&apple, 200, "itunes.apple.com", br#"{"resultCount":1,"results":[{"wrapperType":"artist","artistId":909253}]}"#, quick);
        assert_eq!((artist.why.as_str(), artist.inconclusive), ("store_missing", false));
        assert_eq!(artist.msg, "App Store number 909253 isn't an app");
        assert!(store_answer(&apple, 200, "itunes.apple.com", b"<html>maintenance</html>", quick).inconclusive);
    }

    #[test]
    fn an_app_store_number_must_be_an_app() {
        // What the lookup answers for 909253, as fetched 2026-11-26.
        let artist: Value = serde_json::from_str(r#"{"resultCount":1,"results":[{"wrapperType":"artist","artistType":"Artist","artistName":"Jack Johnson","artistLinkUrl":"https://music.apple.com/us/artist/jack-johnson/909253","artistId":909253}]}"#).unwrap();
        assert!(apple_app(&artist, "909253").is_none());
        let pages: Value = serde_json::from_str(r#"{"resultCount":1,"results":[{"wrapperType":"software","kind":"software","trackId":361309726,"trackName":"Pages: Create Documents","version":"16.0"}]}"#).unwrap();
        assert_eq!(apple_app(&pages, "361309726").and_then(|app| app.get("version")).and_then(Value::as_str), Some("16.0"));
        assert!(apple_app(&pages, "361309727").is_none());
        let empty: Value = serde_json::from_str(r#"{"resultCount":0,"results":[]}"#).unwrap();
        assert!(apple_app(&empty, "361309726").is_none());
    }
}
