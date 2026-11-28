//! Uptime: the app checks the user's websites, servers and store listings
//! from this computer on a schedule, keeps the history on disk and alerts
//! when one goes down or comes back. Nothing is hosted anywhere: the checks
//! run in this process while the app is open, and the time it is closed or
//! the computer sleeps counts as neither up nor down.
//!
//! One thread (`run`) owns the schedule. It starts each check that is due,
//! on the async runtime for web pages and store listings and on a thread of
//! its own for ports, pings and DNS records, and each check reports back
//! through `record`, which works out the new state, writes the history,
//! sends the alerts and tells the page. A check carries a token, and a
//! result whose token is no longer the monitor's (the monitor was edited,
//! paused or deleted while the check ran, or the check ran past its
//! deadline) is dropped.
//!
//! Two things a monitor on a server never meets are handled here. A check
//! that fails while this computer has no network route is recorded as
//! offline and held against nobody. And after the computer wakes from
//! sleep, checks wait 20 seconds for the network to come back.
//!
//! Uptime is time based: each check stands for the time until the next one
//! (`close_last`), never more than two intervals, and a run of failed checks
//! that are only being confirmed counts as down once it is confirmed and as
//! up if the next check passes. The page reads hourly totals of that time.
//!
//! The page uses the abs_uptime_* commands, from editor windows only, and
//! hears about each check through `uptime://beat`, about everything else
//! through `uptime://state`, and about alerts through `uptime://alert`.

pub mod alerts;
mod cert;
pub mod checks;
pub mod clock;
mod dns;
pub mod history;
pub mod model;
mod ping;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use alerts::{Alert, Delivery};
use checks::Outcome;
use clock::{hour_of, now_ms, DAY, HOUR, MINUTE};
use history::{Files, Saved};
use model::{Beat, BeatStatus, Bucket, Config, Detail, Event, Kind, Monitor, Settings, State, Target, MAX_MONITORS};

pub const BEAT_EVENT: &str = "uptime://beat";
pub const STATE_EVENT: &str = "uptime://state";
pub const ALERT_EVENT: &str = "uptime://alert";

/// Checks kept in memory per monitor, for the bars in the list.
const RECENT: usize = 100;
/// Checks under way at once. More wait their turn.
const MAX_RUNNING: usize = 12;
/// Hours kept in memory, for the percentages in the list.
const MEMORY_HOURS: i64 = 31 * DAY;
const WAKE_GRACE: Duration = Duration::from_secs(20);
/// How far the wall clock may run ahead of the monotonic one before it
/// counts as a sleep.
const SLEPT_MS: i64 = 30_000;
/// A sleep of at least this, however short, is left out of the time a check
/// stands for, and a check under way across it is dropped. Less is the two
/// clocks being read a moment apart.
const SLEPT_ANY_MS: i64 = 1000;
const FLUSH_EVERY: Duration = Duration::from_secs(600);
const PRUNE_EVERY: Duration = Duration::from_secs(6 * 3600);
/// How far past its own timeout a check may run before it counts as timed out.
const DEADLINE_SLACK: Duration = Duration::from_secs(5);
const DELIVERIES: usize = 30;

pub struct UptimeState(pub Arc<Engine>);

impl Default for UptimeState {
    fn default() -> Self {
        UptimeState(Arc::new(Engine::default()))
    }
}

#[derive(Default)]
pub struct Engine {
    inner: Mutex<Inner>,
    wake: Condvar,
    clients: checks::Clients,
    running: AtomicUsize,
    /// Goes up with every change to any monitor's history, so the page knows
    /// to read the outages and the hours again (`Summary::revision`).
    history: AtomicU64,
    /// Goes up with every change to any monitor's state, so the page can
    /// tell which of two summaries is newer (`Summary::stamp`).
    stamps: AtomicU64,
    app: OnceLock<AppHandle>,
    files: OnceLock<Files>,
    /// Held while a monitor's files are written or removed, and taken before
    /// `inner`, so a write decided before a clear, a delete, a new target or
    /// shutdown never lands after it.
    disk: Mutex<()>,
    /// Webhook deliveries, sent one at a time per place in the order queued.
    outbox: Mutex<Outbox>,
    /// Signalled when a delivery is done, for a clear waiting on one.
    delivered: Condvar,
    /// Held while the Dock badge is worked out and set, so a count worked
    /// out earlier never lands after a later one.
    badge: Mutex<()>,
}

/// Webhook deliveries waiting for their place, and those on their way.
#[derive(Default)]
struct Outbox {
    /// By target id, oldest first, each with its monitor's generation.
    queues: HashMap<String, VecDeque<(Target, Alert, u64)>>,
    /// By monitor id: moves on when the monitor is cleared or deleted, and a
    /// delivery queued before that isn't sent.
    generations: HashMap<String, u64>,
    /// Targets with a sender running.
    sending: HashSet<String>,
    /// Requests started and not yet done, by monitor id and by place id.
    started: HashMap<String, usize>,
    started_places: HashMap<String, usize>,
}

#[derive(Default)]
struct Inner {
    loaded: bool,
    stopping: bool,
    /// Set by anything that changes the schedule, so the scheduler looks again.
    kick: bool,
    monitors: Vec<Monitor>,
    settings: Settings,
    live: HashMap<String, Live>,
    deliveries: VecDeque<Delivery>,
    offline_since: Option<i64>,
    next_token: u64,
    hold_until: Option<Instant>,
    badge: Option<i64>,
    /// Every alert sent, for the tests below.
    #[cfg(test)]
    sent: Vec<Alert>,
    /// Makes `record` read every check as made with no network.
    #[cfg(test)]
    no_route: bool,
    /// Runs once in `record` after the check is counted and before it is
    /// written, where a clear can come in.
    #[cfg(test)]
    between: Option<Box<dyn FnOnce() + Send>>,
    /// Runs once in `record` just before its alerts go out.
    #[cfg(test)]
    before_alerts: Option<Box<dyn FnOnce() + Send>>,
    /// Runs once in `flush_hours` between taking the hours and writing them.
    #[cfg(test)]
    between_flush: Option<Box<dyn FnOnce() + Send>>,
    /// Runs once as the Dock badge is about to be worked out.
    #[cfg(test)]
    before_badge: Option<Box<dyn FnOnce() + Send>>,
    /// Holds back the next webhook delivery this long before it is sent.
    #[cfg(test)]
    delivery_delay: Option<Duration>,
    /// Runs once between working out the Dock badge and setting it.
    #[cfg(test)]
    before_badge_set: Option<Box<dyn FnOnce() + Send>>,
    /// Every Dock badge set, in order.
    #[cfg(test)]
    badge_sets: Vec<Option<i64>>,
    /// Runs once as a webhook delivery fetches its HTTP client.
    #[cfg(test)]
    at_client: Option<Box<dyn FnOnce() + Send>>,
    /// Runs once just before a webhook request starts.
    #[cfg(test)]
    before_request: Option<Box<dyn FnOnce() + Send>>,
    /// When each view went to the page.
    #[cfg(test)]
    emits: Vec<Instant>,
}

struct Running {
    token: u64,
    deadline: Instant,
    started: i64,
    /// `skew()` when the check started. It grows by the length of any sleep.
    started_skew: i64,
}

/// The wall clock minus the monotonic one, in ms. The monotonic clock stops
/// while the computer sleeps, so this grows by the length of every sleep.
fn skew() -> i64 {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    let origin = *ORIGIN.get_or_init(Instant::now);
    now_ms() - origin.elapsed().as_millis() as i64
}

/// A monitor's state while the app runs.
struct Live {
    running: Option<Running>,
    next: Instant,
    state: State,
    since: Option<i64>,
    fails: u32,
    first_fail: Option<i64>,
    /// The last check, whose time is added to the hours when the next arrives.
    last: Option<Beat>,
    /// Time spent "checking again", waiting to be called up or down.
    pool: Vec<(i64, i64)>,
    recent: VecDeque<Beat>,
    hours: BTreeMap<i64, Bucket>,
    dirty: BTreeSet<i64>,
    detail: Detail,
    cert_warned: Option<u32>,
    version: Option<String>,
    last_alert: i64,
    down_since: Option<i64>,
    down_seen: i64,
    down_why: String,
    down_msg: String,
    /// The answer times of the checks that passed in about the last day,
    /// for an average over exactly 24 hours.
    answers: VecDeque<(i64, u32)>,
    /// `Engine::history` when this monitor's history last changed.
    revision: u64,
    /// `Engine::stamps` when this monitor's state last changed.
    stamp: u64,
    /// `skew()` when the last check started, so a sleep since then, however
    /// short, is left out of the time the check stands for.
    last_skew: i64,
}

fn add_time(hours: &mut BTreeMap<i64, Bucket>, dirty: &mut BTreeSet<i64>, from: i64, to: i64, down: bool) -> i64 {
    let mut at = from;
    let mut total = 0;
    while at < to {
        let hour = hour_of(at);
        let end = (hour + HOUR).min(to);
        let bucket = hours.entry(hour).or_insert_with(|| Bucket { t: hour, ..Bucket::default() });
        bucket.add_span(at, end, down);
        total += end - at;
        dirty.insert(hour);
        at = end;
    }
    total
}

impl Live {
    fn fresh(next: Instant) -> Live {
        Live {
            running: None,
            next,
            state: State::Unknown,
            since: None,
            fails: 0,
            first_fail: None,
            last: None,
            pool: Vec::new(),
            recent: VecDeque::new(),
            hours: BTreeMap::new(),
            dirty: BTreeSet::new(),
            detail: Detail::default(),
            cert_warned: None,
            version: None,
            last_alert: 0,
            down_since: None,
            down_seen: 0,
            down_why: String::new(),
            down_msg: String::new(),
            answers: VecDeque::new(),
            revision: 0,
            stamp: 0,
            last_skew: skew(),
        }
    }

    /// The monitor now checks something else: what the old target answered
    /// (its state, version, certificate, last answer) says nothing about the
    /// new one. The history stays.
    fn reset_target(&mut self) {
        self.state = State::Unknown;
        self.since = None;
        self.fails = 0;
        self.first_fail = None;
        self.down_since = None;
        self.down_seen = 0;
        self.down_why.clear();
        self.down_msg.clear();
        self.version = None;
        self.cert_warned = None;
        self.detail = Detail::default();
    }

    fn saved(&self, monitor: &Monitor) -> Saved {
        Saved {
            target: monitor.target_key(),
            state: self.state,
            since: self.since,
            fails: self.fails,
            first_fail: self.first_fail,
            last: self.last.clone(),
            detail: self.detail.clone(),
            cert_warned: self.cert_warned,
            version: self.version.clone(),
            last_alert: self.last_alert,
            down_since: self.down_since,
            down_seen: self.down_seen,
            down_why: self.down_why.clone(),
            down_msg: self.down_msg.clone(),
            open: self.dirty.iter().filter_map(|hour| self.hours.get(hour).cloned()).collect(),
        }
    }

    fn restore(&mut self, saved: Saved) {
        self.state = saved.state;
        self.since = saved.since;
        self.fails = saved.fails;
        self.first_fail = saved.first_fail;
        self.last = saved.last;
        self.detail = saved.detail;
        self.cert_warned = saved.cert_warned;
        self.version = saved.version;
        self.last_alert = saved.last_alert;
        self.down_since = saved.down_since;
        self.down_seen = saved.down_seen;
        self.down_why = saved.down_why;
        self.down_msg = saved.down_msg;
        // An hour an earlier test build left open counts for nothing, as in
        // `Files::hours`.
        for bucket in saved.open.into_iter().filter(Bucket::is_current) {
            self.dirty.insert(bucket.t);
            self.hours.insert(bucket.t, bucket);
        }
    }

    /// After a restart, whether the app was quit, crashed or was killed: the
    /// check left open ended when the app did, which isn't known here, so it
    /// counts for nothing, and a failure being confirmed starts over.
    fn forget_open(&mut self) {
        self.last = None;
        self.pool.clear();
        self.first_fail = None;
        if self.state != State::Down {
            self.fails = 0;
        }
    }

    /// Adds the time the last check stands for to the hours, now that what
    /// follows it is known: the next check at `until`, or nothing (`next` is
    /// None) because the monitor stops being checked. A check never stands
    /// for more than `Monitor::cover_ms`.
    fn close_last(&mut self, until: i64, until_skew: i64, monitor: &Monitor, next: Option<BeatStatus>) {
        if let Some(last) = self.last.clone() {
            // Time asleep since the last check started, however short. Under a
            // second is the two clocks being read a moment apart.
            let slept = until_skew - self.last_skew;
            let slept = if slept >= SLEPT_ANY_MS { slept } else { 0 };
            let end = (until - slept).min(last.t + monitor.cover_ms(last.s)).max(last.t);
            // While a failure is being confirmed or the monitor is down, all
            // of a check's time is time the app was open and watching, a check
            // that couldn't tell included, so it isn't taken for time the app
            // was closed.
            if self.first_fail.is_some() || self.state == State::Down {
                self.down_seen += end - last.t;
            }
            match last.s {
                BeatStatus::Up => {
                    add_time(&mut self.hours, &mut self.dirty, last.t, end, false);
                }
                BeatStatus::Down => {
                    add_time(&mut self.hours, &mut self.dirty, last.t, end, true);
                }
                BeatStatus::Pending => self.pool.push((last.t, end)),
                BeatStatus::Offline | BeatStatus::Unclear => {}
            }
        }
        match next {
            Some(BeatStatus::Up) | Some(BeatStatus::Down) => {
                let down = next == Some(BeatStatus::Down);
                for (from, to) in std::mem::take(&mut self.pool) {
                    add_time(&mut self.hours, &mut self.dirty, from, to, down);
                }
            }
            Some(BeatStatus::Pending) => {}
            Some(BeatStatus::Offline) | Some(BeatStatus::Unclear) | None => self.pool.clear(),
        }
    }

    /// The check's own line in its hour: counted, and its response time.
    fn count(&mut self, beat: &Beat) {
        if matches!(beat.s, BeatStatus::Offline | BeatStatus::Unclear) {
            return;
        }
        let hour = hour_of(beat.t);
        let bucket = self.hours.entry(hour).or_insert_with(|| Bucket { t: hour, ..Bucket::default() });
        bucket.n += 1;
        if matches!(beat.s, BeatStatus::Down | BeatStatus::Pending) {
            bucket.fails += 1;
        }
        if let (BeatStatus::Up, Some(ms)) = (beat.s, beat.ms) {
            bucket.sum += ms as u64;
            bucket.min = if bucket.cnt == 0 { ms } else { bucket.min.min(ms) };
            bucket.max = bucket.max.max(ms);
            bucket.cnt += 1;
            self.answers.push_back((beat.t, ms));
        }
        self.dirty.insert(hour);
        while self.answers.front().is_some_and(|(t, _)| *t < beat.t - DAY - HOUR) {
            self.answers.pop_front();
        }
    }

    /// The share of `[from, to)` seen up, from the time seen in it: whole
    /// hours from their totals, the hours at the ends from their stretches.
    fn uptime_between(&self, from: i64, to: i64) -> Option<f64> {
        let (up, down) = self
            .hours
            .range(hour_of(from)..)
            .take_while(|(hour, _)| **hour < to)
            .fold((0i64, 0i64), |(up, down), (_, bucket)| {
                // These windows end now, so `to` is also where time ends.
                let (bucket_up, bucket_down) = bucket.time_in(from, to, to);
                (up + bucket_up, down + bucket_down)
            });
        (up + down > 0).then(|| up as f64 * 100.0 / (up + down) as f64)
    }

    #[cfg(test)]
    fn uptime_since(&self, from: i64) -> Option<f64> {
        self.uptime_between(from, i64::MAX)
    }

    /// The average answer time of the checks that passed since `from`, which
    /// is at most a day back.
    fn average_since(&self, from: i64) -> Option<u32> {
        let (sum, count) = self.answers.iter().filter(|(t, _)| *t >= from).fold((0u64, 0u64), |(sum, count), (_, ms)| (sum + *ms as u64, count + 1));
        (count > 0).then(|| (sum / count) as u32)
    }

    /// Stops the clock on this monitor: the last check's time is added, and
    /// any check under way is forgotten.
    fn stop(&mut self, now: i64, monitor: &Monitor) {
        self.close_last(now, skew(), monitor, None);
        self.last = None;
        self.running = None;
        self.fails = 0;
        self.first_fail = None;
    }
}

/// What the page shows for a monitor in the list and at the top of its page.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub state: State,
    pub since: Option<i64>,
    pub last: Option<Beat>,
    pub recent: Vec<Beat>,
    /// When the next check starts, ms since 1970.
    pub next: Option<i64>,
    pub running: bool,
    pub fails: u32,
    pub uptime24: Option<f64>,
    pub uptime7: Option<f64>,
    pub uptime30: Option<f64>,
    pub avg24: Option<u32>,
    pub detail: Detail,
    pub down_since: Option<i64>,
    pub down_msg: String,
    pub version: Option<String>,
    /// Changes whenever this monitor's history does: an outage, a pause, a
    /// clear. The page reads the outages and hours again when it moves.
    pub revision: u64,
    /// Goes up with every change to this monitor's state. Of two summaries
    /// the page holds, the one with the higher stamp is the newer.
    pub stamp: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub loaded: bool,
    pub monitors: Vec<Monitor>,
    pub summaries: Vec<Summary>,
    pub settings: Settings,
    pub offline_since: Option<i64>,
    pub deliveries: Vec<Delivery>,
    /// Whether this computer's own notifications come from Rust ("native"),
    /// from the page ("page"), or not at all ("none": the development build).
    pub notifications: &'static str,
    pub now: i64,
    /// `Engine::stamps` as this view was made: of two views, the higher is
    /// the newer, monitors list, settings and offline status included.
    pub stamp: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BeatPayload {
    id: String,
    beat: Beat,
    summary: Summary,
    offline_since: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: String,
    #[serde(flatten)]
    pub event: Event,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub ms: Option<u32>,
    pub code: Option<u16>,
    pub why: String,
    pub msg: String,
    pub detail: Detail,
    /// The check couldn't tell up from down, so the monitor wouldn't count it.
    pub inconclusive: bool,
}

/// "4 minutes", "1 hour 5 minutes", "3 days".
pub fn duration_words(ms: i64) -> String {
    let plural = |count: i64, word: &str| if count == 1 { format!("1 {word}") } else { format!("{count} {word}s") };
    let minutes = ms / MINUTE;
    if minutes < 1 {
        return "less than a minute".into();
    }
    if minutes < 60 {
        return plural(minutes, "minute");
    }
    let hours = minutes / 60;
    if hours < 24 {
        let rest = minutes % 60;
        return if rest == 0 { plural(hours, "hour") } else { format!("{} {}", plural(hours, "hour"), plural(rest, "minute")) };
    }
    let days = hours / 24;
    let rest = hours % 24;
    if rest == 0 {
        plural(days, "day")
    } else {
        format!("{} {}", plural(days, "day"), plural(rest, "hour"))
    }
}

/// The warning a certificate with `days_left` has reached: one at the
/// user's chosen number of days, then at 7, 3 and 1. None while it has more.
pub fn cert_threshold(warn_days: u32, days_left: i64) -> Option<u32> {
    if warn_days == 0 || days_left > warn_days as i64 {
        return None;
    }
    let mut steps: Vec<u32> = [warn_days, 7, 3, 1].into_iter().filter(|step| *step <= warn_days).collect();
    steps.sort_unstable();
    steps.dedup();
    steps.into_iter().find(|step| *step as i64 >= days_left).or(Some(1))
}

fn sentence(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() || text.ends_with(['.', '!', '?']) {
        text.to_string()
    } else {
        format!("{text}.")
    }
}

fn host_of(url: &str) -> String {
    tauri_plugin_http::reqwest::Url::parse(url).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string())
}

fn notifications_kind() -> &'static str {
    if cfg!(target_os = "macos") {
        if alerts::native::available() {
            "native"
        } else {
            "none"
        }
    } else {
        "page"
    }
}

impl Engine {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn files(&self) -> Option<&Files> {
        self.files.get()
    }

    fn disk(&self) -> MutexGuard<'_, ()> {
        self.disk.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn outbox(&self) -> MutexGuard<'_, Outbox> {
        self.outbox.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Drops the webhook deliveries for `id` still waiting. Called with the
    /// disk lock held, so none is queued meanwhile.
    fn drop_deliveries(&self, id: &str) {
        let mut outbox = self.outbox();
        *outbox.generations.entry(id.to_string()).or_default() += 1;
        for queue in outbox.queues.values_mut() {
            queue.retain(|(_, alert, _)| alert.id != id);
        }
    }

    /// Waits, at most 16 seconds (a request gives up after 15), for the
    /// requests for `id` already started, so none arrives after a clear or a
    /// delete returns. One not started yet is dropped as it is about to
    /// start (`send_queue`).
    fn wait_for_deliveries(&self, id: &str) {
        self.wait_for_requests(|outbox| outbox.started.get(id).is_some_and(|count| *count > 0));
    }

    fn wait_for_requests(&self, busy: impl Fn(&Outbox) -> bool) {
        let until = Instant::now() + Duration::from_secs(16);
        let mut outbox = self.outbox();
        while busy(&outbox) {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            outbox = match self.delivered.wait_timeout(outbox, left) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
    }

    /// A new history revision, for a monitor whose history just changed.
    fn bump(&self) -> u64 {
        self.history.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// A new stamp, for a monitor whose state just changed.
    fn stamp(&self) -> u64 {
        self.stamps.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn kick(&self, inner: &mut Inner) {
        inner.kick = true;
        self.wake.notify_all();
    }

    fn summary(&self, monitor: &Monitor, live: &Live, now: i64, mono: Instant) -> Summary {
        Summary {
            id: monitor.id.clone(),
            state: if monitor.paused { State::Paused } else { live.state },
            since: live.since,
            last: live.recent.back().cloned(),
            recent: live.recent.iter().cloned().collect(),
            next: (!monitor.paused && live.running.is_none()).then(|| now + live.next.saturating_duration_since(mono).as_millis() as i64),
            running: live.running.is_some(),
            fails: live.fails,
            uptime24: live.uptime_between(now - DAY, now),
            uptime7: live.uptime_between(now - 7 * DAY, now),
            uptime30: live.uptime_between(now - 30 * DAY, now),
            avg24: live.average_since(now - DAY),
            detail: live.detail.clone(),
            down_since: live.down_since,
            down_msg: live.down_msg.clone(),
            version: live.version.clone(),
            revision: live.revision,
            stamp: live.stamp,
        }
    }

    fn view_of(&self, inner: &Inner) -> View {
        let now = now_ms();
        let mono = Instant::now();
        View {
            loaded: inner.loaded,
            monitors: inner.monitors.clone(),
            summaries: inner.monitors.iter().filter_map(|monitor| Some(self.summary(monitor, inner.live.get(&monitor.id)?, now, mono))).collect(),
            settings: inner.settings.clone(),
            offline_since: inner.offline_since,
            deliveries: inner.deliveries.iter().cloned().collect(),
            notifications: notifications_kind(),
            now,
            stamp: self.stamps.load(Ordering::SeqCst),
        }
    }

    pub fn view(&self) -> View {
        let inner = self.lock();
        self.view_of(&inner)
    }

    /// Sends the whole view to the page.
    fn emit_view(&self) {
        let view = self.view();
        if let Some(app) = self.app.get() {
            let _ = app.emit(STATE_EVENT, &view);
        }
        #[cfg(test)]
        self.lock().emits.push(Instant::now());
    }

    fn emit_state(&self) {
        self.emit_view();
        self.update_badge();
    }

    /// Sets the Dock badge to the monitors down now, worked out here rather
    /// than from a view taken earlier, and under its own lock, so an older
    /// count can't land after a newer one. Setting it waits for the main
    /// thread, so this is never called with the disk lock held.
    fn update_badge(&self) {
        #[cfg(test)]
        {
            let before_badge = self.lock().before_badge.take();
            if let Some(before_badge) = before_badge {
                before_badge();
            }
        }
        let _badge = self.badge.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let wanted = {
            let mut inner = self.lock();
            let down = inner.monitors.iter().filter(|monitor| !monitor.paused && inner.live.get(&monitor.id).is_some_and(|live| live.state == State::Down)).count() as i64;
            let wanted = (inner.settings.badge && down > 0).then_some(down);
            if inner.badge == wanted {
                return;
            }
            inner.badge = wanted;
            wanted
        };
        #[cfg(test)]
        {
            let before_badge_set = self.lock().before_badge_set.take();
            if let Some(before_badge_set) = before_badge_set {
                before_badge_set();
            }
            self.lock().badge_sets.push(wanted);
        }
        #[cfg(not(windows))]
        if let Some(window) = self.app.get().and_then(|app| app.get_webview_window("main")) {
            let _ = window.set_badge_count(wanted);
        }
    }

    fn save_config(&self, inner: &Inner) -> Result<(), String> {
        let config = Config { version: 1, monitors: inner.monitors.clone(), settings: inner.settings.clone() };
        let Some(files) = self.files() else { return Ok(()) };
        files.save_config(&config).map_err(|error| {
            eprintln!("uptime: monitors.json couldn't be written: {error}");
            "Uptime couldn't save to this computer's disk. Check that the disk isn't full".to_string()
        })
    }

    fn note_event(&self, id: &str, event: &Event) {
        if let Some(files) = self.files() {
            if let Err(error) = files.append_event(id, event) {
                eprintln!("uptime: an event for {id} couldn't be written: {error}");
            }
        }
    }

    // ---- loading and the schedule -------------------------------------

    fn load(&self) {
        let Some(files) = self.files() else { return };
        let config = files.load_config();
        let now = now_ms();
        let mono = Instant::now();
        let mut seen = HashSet::new();
        let monitors: Vec<Monitor> = config
            .monitors
            .into_iter()
            .filter(|monitor| history::valid_id(&monitor.id) && seen.insert(monitor.id.clone()))
            .take(MAX_MONITORS)
            .collect();
        let mut live = HashMap::new();
        for (index, monitor) in monitors.iter().enumerate() {
            files.prune(&monitor.id, now);
            // The first checks spread over the first seconds, so a long list
            // doesn't start all at once.
            let first = Duration::from_millis((1500 + 350 * index as u64).min(30_000));
            let mut state = Live::fresh(mono + first);
            state.hours = files.hours(&monitor.id, now - MEMORY_HOURS, i64::MAX);
            if let Some(saved) = files.load_live(&monitor.id) {
                // Saved for what the monitor checked before it was pointed
                // elsewhere, if the app was killed before that was saved.
                let moved = saved.target != 0 && saved.target != monitor.target_key();
                state.restore(saved);
                if moved {
                    state.reset_target();
                }
            }
            state.forget_open();
            state.recent = files.recent(&monitor.id, RECENT, now).into();
            state.answers = files
                .beats(&monitor.id, now - DAY - HOUR, now + 1)
                .into_iter()
                .filter_map(|beat| (beat.s == BeatStatus::Up).then_some(beat.ms.map(|ms| (beat.t, ms))).flatten())
                .collect();
            state.revision = self.bump();
            state.stamp = self.stamp();
            live.insert(monitor.id.clone(), state);
        }
        let ask = !monitors.is_empty() && config.settings.desktop;
        {
            let mut inner = self.lock();
            inner.monitors = monitors;
            inner.settings = config.settings;
            inner.live = live;
            inner.loaded = true;
            self.kick(&mut inner);
        }
        self.emit_state();
        if ask {
            alerts::native::ask();
        }
    }

    fn launch(self: &Arc<Self>, inner: &mut Inner, id: &str, mono: Instant) {
        let Some(monitor) = inner.monitors.iter().find(|monitor| monitor.id == id).cloned() else { return };
        inner.next_token += 1;
        let token = inner.next_token;
        let Some(live) = inner.live.get_mut(id) else { return };
        live.running = Some(Running { token, deadline: mono + Duration::from_secs(monitor.timeout as u64) + DEADLINE_SLACK, started: now_ms(), started_skew: skew() });
        self.running.fetch_add(1, Ordering::SeqCst);
        let engine = self.clone();
        if checks::is_async(monitor.kind) {
            tauri::async_runtime::spawn(async move {
                let outcome = checks::run_async(&monitor, &engine.clients).await;
                engine.record(&monitor.id, token, outcome);
            });
        } else {
            let worker = engine.clone();
            let started = std::thread::Builder::new().name("uptime-check".into()).spawn(move || {
                let outcome = checks::blocking(&monitor);
                worker.record(&monitor.id, token, outcome);
            });
            if started.is_err() {
                if let Some(live) = inner.live.get_mut(id) {
                    live.running = None;
                    live.next = mono + Duration::from_secs(30);
                }
                self.running.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }

    /// The computer slept: each monitor's open check ends where the sleep
    /// began, checks that were under way are forgotten (their answers would
    /// be about the sleep), and none starts for 20 seconds while the network
    /// comes back.
    fn slept(&self, inner: &mut Inner, asleep_from: i64, mono: Instant) {
        inner.hold_until = Some(mono + WAKE_GRACE);
        let Inner { monitors, live, .. } = inner;
        for monitor in monitors.iter() {
            let Some(state) = live.get_mut(&monitor.id) else { continue };
            if state.running.take().is_some() {
                self.running.fetch_sub(1, Ordering::SeqCst);
            }
            if !monitor.paused {
                let before = state.last_skew;
                state.close_last(asleep_from, before, monitor, None);
            }
            state.forget_open();
            state.stamp = self.stamp();
            state.next = state.next.max(mono + WAKE_GRACE);
        }
    }

    /// The scheduler. Runs until the app quits.
    pub fn run(self: Arc<Self>) {
        self.load();
        let mut last_wall = now_ms();
        let mut last_mono = Instant::now();
        let mut last_flush = Instant::now();
        let mut last_prune = Instant::now();
        loop {
            let mut overdue: Vec<(String, u64, u32)> = Vec::new();
            let mut resumed: Vec<String> = Vec::new();
            let mut flush_due = false;
            let mut prune = false;
            let wait;
            {
                let mut inner = self.lock();
                if inner.stopping {
                    break;
                }
                inner.kick = false;
                let mono = Instant::now();
                let wall = now_ms();
                // The monotonic clock stops while the computer sleeps and the
                // wall clock doesn't, so a difference between the two is a sleep.
                // The last moment the schedule knew the computer was awake.
                let asleep_from = last_wall;
                let slept = (wall - last_wall) - mono.duration_since(last_mono).as_millis() as i64 > SLEPT_MS;
                last_wall = wall;
                last_mono = mono;
                if slept {
                    self.slept(&mut inner, asleep_from, mono);
                }
                let holding = inner.hold_until.is_some_and(|until| until > mono);

                // Pauses that end by themselves.
                for monitor in inner.monitors.iter_mut() {
                    if monitor.paused && monitor.paused_until.is_some_and(|until| until <= wall) {
                        monitor.paused = false;
                        monitor.paused_until = None;
                        resumed.push(monitor.id.clone());
                    }
                }
                for id in &resumed {
                    if let Some(live) = inner.live.get_mut(id) {
                        live.next = mono;
                    }
                }

                // Checks that ran past their deadline.
                let timeouts: HashMap<String, u32> = inner.monitors.iter().map(|monitor| (monitor.id.clone(), monitor.timeout)).collect();
                for (id, live) in inner.live.iter() {
                    if let Some(running) = &live.running {
                        if running.deadline <= mono {
                            overdue.push((id.clone(), running.token, timeouts.get(id).copied().unwrap_or(10)));
                        }
                    }
                }

                // Checks that are due, the longest waiting first.
                if !holding {
                    let mut due: Vec<(Instant, String)> = inner
                        .monitors
                        .iter()
                        .filter(|monitor| !monitor.paused)
                        .filter_map(|monitor| {
                            let live = inner.live.get(&monitor.id)?;
                            (live.running.is_none() && live.next <= mono).then(|| (live.next, monitor.id.clone()))
                        })
                        .collect();
                    due.sort();
                    for (_, id) in due {
                        if self.running.load(Ordering::SeqCst) >= MAX_RUNNING {
                            break;
                        }
                        self.launch(&mut inner, &id, mono);
                    }
                }

                // When to look again.
                let mut wake = mono + Duration::from_secs(60);
                if let Some(until) = inner.hold_until.filter(|until| *until > mono) {
                    wake = wake.min(until);
                }
                for monitor in &inner.monitors {
                    if monitor.paused {
                        if let Some(until) = monitor.paused_until {
                            wake = wake.min(mono + Duration::from_millis((until - wall).max(0) as u64));
                        }
                        continue;
                    }
                    let Some(live) = inner.live.get(&monitor.id) else { continue };
                    wake = wake.min(match &live.running {
                        Some(running) => running.deadline,
                        None => live.next,
                    });
                }
                if self.running.load(Ordering::SeqCst) >= MAX_RUNNING {
                    // A finished check kicks the scheduler, so no need to spin.
                    wake = mono + Duration::from_secs(5);
                }
                wait = wake.saturating_duration_since(mono).max(Duration::from_millis(50));

                if last_flush.elapsed() >= FLUSH_EVERY {
                    last_flush = Instant::now();
                    flush_due = true;
                }
                if last_prune.elapsed() >= PRUNE_EVERY {
                    last_prune = Instant::now();
                    prune = true;
                }
            }

            for (id, token, timeout) in overdue {
                self.record(&id, token, Outcome::timeout(timeout));
            }
            if !resumed.is_empty() {
                {
                    let inner = self.lock();
                    let _ = self.save_config(&inner);
                }
                {
                    let _disk = self.disk();
                    for id in &resumed {
                        self.note_event(id, &Event { t: now_ms(), kind: "resumed".into(), msg: String::new(), why: String::new(), dur: None, seen: None, code: None });
                    }
                }
                self.emit_state();
            }
            if flush_due {
                self.flush_hours(now_ms());
            }
            if let (true, Some(files)) = (prune, self.files()) {
                let ids: Vec<String> = self.lock().monitors.iter().map(|monitor| monitor.id.clone()).collect();
                for id in ids {
                    // Pruning rewrites hours.jsonl, which a clear may be removing.
                    let _disk = self.disk();
                    files.prune(&id, now_ms());
                }
            }

            let inner = self.lock();
            if inner.stopping {
                break;
            }
            if !inner.kick {
                let _ = self.wake.wait_timeout_while(inner, wait, |inner| !inner.kick && !inner.stopping);
            }
        }
    }

    /// A check came back.
    fn record(self: &Arc<Self>, id: &str, token: u64, outcome: Outcome) {
        // Asked before taking the lock: a failure while this computer has no
        // network at all is the computer's, not the monitor's.
        #[cfg(test)]
        let has_route = !self.lock().no_route;
        #[cfg(not(test))]
        let has_route = checks::has_route();
        let offline = outcome.may_be_offline() && !has_route;
        // One check at a time, from counting it to sending its alerts: a later
        // check, a clear, a new target or shutdown waits, so none of them
        // lands in between and is undone by what this check writes or sends.
        let disk = self.disk();
        let now = now_ms();
        let mut events: Vec<Event> = Vec::new();
        let mut alerts: Vec<Alert> = Vec::new();
        let (beat, saved, payload, settings, skip, renamed) = {
            let mut guard = self.lock();
            let inner = &mut *guard;
            // Shutdown has written everything; nothing more is.
            if inner.stopping {
                return;
            }
            let Some(mut monitor) = inner.monitors.iter().find(|monitor| monitor.id == id).cloned() else { return };
            let Some(live) = inner.live.get_mut(id) else { return };
            let Some(running) = live.running.as_ref().filter(|running| running.token == token) else { return };
            let started = running.started;
            let started_skew = running.started_skew;
            let slept_through = skew() - started_skew >= SLEPT_ANY_MS;
            live.running = None;
            self.running.fetch_sub(1, Ordering::SeqCst);
            inner.kick = true;
            if monitor.paused {
                return;
            }
            if slept_through {
                // The computer slept while this check waited, so its answer
                // (a timeout, most likely) says nothing about the monitor. It
                // runs again once the network is back.
                live.next = Instant::now() + WAKE_GRACE;
                return;
            }
            let status = if outcome.ok {
                BeatStatus::Up
            } else if offline {
                BeatStatus::Offline
            } else if outcome.inconclusive {
                BeatStatus::Unclear
            } else if live.state == State::Down || live.fails + 1 > monitor.retries {
                BeatStatus::Down
            } else {
                BeatStatus::Pending
            };
            let slow = outcome.ok && monitor.slow_ms > 0 && outcome.ms.is_some_and(|ms| ms > monitor.slow_ms);
            let beat = Beat { t: started, s: status, ms: outcome.ms, code: outcome.code, why: outcome.why.clone(), msg: outcome.msg.clone(), slow };
            live.close_last(beat.t, started_skew, &monitor, Some(status));
            live.count(&beat);

            // A listing's name that Uptime made follows the store's name for
            // the app, as "Test it now" in the form does.
            let mut renamed = false;
            if monitor.kind == Kind::Store && monitor.auto_name == Some(true) && outcome.ok {
                if let Some(app_name) = outcome.detail.app_name.as_deref() {
                    let wanted = model::store_name(app_name, &monitor.store);
                    if monitor.name != wanted {
                        monitor.name = wanted;
                        if let Some(stored) = inner.monitors.iter_mut().find(|stored| stored.id == id) {
                            stored.name = monitor.name.clone();
                        }
                        renamed = true;
                    }
                }
            }

            let name = monitor.name.clone();
            let target = monitor.target();
            let alert = |kind: &str, title: String, body: String, down_for: Option<i64>, why: &str| Alert {
                id: monitor.id.clone(),
                name: name.clone(),
                kind: kind.into(),
                title,
                body,
                target: target.clone(),
                at: now,
                down_for,
                why: why.into(),
            };
            let event = |t: i64, kind: &str, msg: String, why: String| Event { t, kind: kind.into(), msg, why, dur: None, seen: None, code: None };
            match status {
                BeatStatus::Up => {
                    if live.state == State::Down {
                        let start = live.down_since.unwrap_or(beat.t);
                        let span = beat.t - start;
                        let mut up = event(beat.t, "up", String::new(), String::new());
                        up.dur = Some(span);
                        up.seen = Some(live.down_seen);
                        up.code = beat.code;
                        events.push(up);
                        // While the app is open every check's time is counted, so
                        // more than an interval missing was time it was closed.
                        let unseen = span - live.down_seen > monitor.interval.max(monitor.retry_interval) as i64 * 1000;
                        let body = if unseen {
                            format!("It was down for {}, but the app was closed for part of that time.", duration_words(span))
                        } else {
                            format!("It was down for {}.", duration_words(span))
                        };
                        alerts.push(alert("up", format!("{} is back up", monitor.name), body, Some(span), ""));
                        live.since = Some(beat.t);
                    } else if live.since.is_none() || live.state == State::Unknown {
                        live.since = Some(beat.t);
                    }
                    live.state = State::Up;
                    live.fails = 0;
                    live.first_fail = None;
                    live.down_since = None;
                    live.down_seen = 0;
                    live.down_why.clear();
                    live.down_msg.clear();
                }
                BeatStatus::Pending => {
                    live.fails += 1;
                    live.first_fail.get_or_insert(beat.t);
                    live.state = State::Pending;
                }
                BeatStatus::Down => {
                    live.fails += 1;
                    if live.state != State::Down {
                        let start = live.first_fail.unwrap_or(beat.t);
                        live.down_since = Some(start);
                        live.since = Some(start);
                        live.down_why = beat.why.clone();
                        live.down_msg = beat.msg.clone();
                        let mut down = event(start, "down", beat.msg.clone(), beat.why.clone());
                        down.code = beat.code;
                        events.push(down);
                        alerts.push(alert("down", format!("{} is down", monitor.name), sentence(&beat.msg), None, &beat.why));
                        live.last_alert = now;
                        live.state = State::Down;
                    } else if inner.settings.remind > 0 && now - live.last_alert >= inner.settings.remind as i64 * MINUTE {
                        let span = now - live.down_since.unwrap_or(now);
                        alerts.push(alert(
                            "reminder",
                            format!("{} is still down", monitor.name),
                            format!("Down for {}. {}", duration_words(span), sentence(&beat.msg)),
                            Some(span),
                            &beat.why,
                        ));
                        live.last_alert = now;
                    }
                }
                BeatStatus::Offline | BeatStatus::Unclear => {}
            }

            // The last answer that said something about the monitor stays.
            if !matches!(status, BeatStatus::Offline | BeatStatus::Unclear) {
                live.detail = outcome.detail.clone();
            }
            if monitor.kind == Kind::Http && outcome.ok {
                match outcome.detail.cert.as_ref() {
                    Some(cert) if monitor.cert_days > 0 => {
                        let days_left = (cert.expires - now).div_euclid(DAY);
                        match cert_threshold(monitor.cert_days, days_left) {
                            None => live.cert_warned = None,
                            Some(step) if live.cert_warned.map_or(true, |warned| step < warned) => {
                                live.cert_warned = Some(step);
                                let when = match days_left {
                                    i64::MIN..=0 => "today".to_string(),
                                    1 => "tomorrow".to_string(),
                                    days => format!("in {days} days"),
                                };
                                let host = host_of(&monitor.url);
                                events.push(event(now, "cert", format!("The certificate runs out {when}"), String::new()));
                                alerts.push(alert(
                                    "cert",
                                    format!("The certificate for {host} runs out {when}"),
                                    "Renew it before then, or visitors will see a security warning instead of the site.".into(),
                                    None,
                                    "",
                                ));
                            }
                            Some(_) => {}
                        }
                    }
                    _ => {}
                }
            }
            if monitor.kind == Kind::Store && outcome.ok {
                if let Some(version) = outcome.detail.version.clone() {
                    if live.version.as_ref().is_some_and(|old| *old != version) {
                        let app_name = outcome.detail.app_name.clone().unwrap_or_else(|| monitor.name.clone());
                        events.push(event(now, "version", format!("Version {version} is live"), String::new()));
                        alerts.push(alert(
                            "news",
                            format!("{app_name} {version} is live"),
                            format!("The App Store shows version {version} in {}.", monitor.country.to_uppercase()),
                            None,
                            "",
                        ));
                    }
                    live.version = Some(version);
                }
            }

            if !events.is_empty() {
                live.revision = self.bump();
            }
            live.recent.push_back(beat.clone());
            while live.recent.len() > RECENT {
                live.recent.pop_front();
            }
            live.next = Instant::now() + Duration::from_secs(if status == BeatStatus::Pending { monitor.retry_interval } else { monitor.interval } as u64);
            live.last = Some(beat.clone());
            live.last_skew = started_skew;
            live.stamp = self.stamp();
            let saved = live.saved(&monitor);
            match status {
                BeatStatus::Offline => {
                    inner.offline_since.get_or_insert(now);
                }
                BeatStatus::Up => inner.offline_since = None,
                _ => {}
            }
            let live = inner.live.get(id).expect("the monitor's state was just used");
            let summary = self.summary(&monitor, live, now, Instant::now());
            let payload = BeatPayload { id: id.to_string(), beat: beat.clone(), summary, offline_since: inner.offline_since };
            if renamed {
                let _ = self.save_config(inner);
            }
            self.wake.notify_all();
            (beat, saved, payload, inner.settings.clone(), monitor.skip_alerts.clone(), renamed)
        };
        #[cfg(test)]
        {
            let between = self.lock().between.take();
            if let Some(between) = between {
                between();
            }
        }

        if let Some(files) = self.files() {
            if let Err(error) = files.append_beat(id, &beat) {
                eprintln!("uptime: a check for {id} couldn't be written: {error}");
            }
            if let Err(error) = files.save_live(id, &saved) {
                eprintln!("uptime: {id}/live.json couldn't be written: {error}");
            }
        }
        for event in &events {
            self.note_event(id, event);
        }
        if let Some(app) = self.app.get() {
            let _ = app.emit(BEAT_EVENT, &payload);
        }
        #[cfg(test)]
        {
            let before_alerts = self.lock().before_alerts.take();
            if let Some(before_alerts) = before_alerts {
                before_alerts();
            }
        }
        for alert in alerts {
            self.send(alert, &settings, &skip);
        }
        // The Dock badge waits for the main thread, where shutdown takes the
        // disk lock, so it comes after letting the lock go.
        drop(disk);
        if renamed {
            self.emit_state();
        } else {
            self.update_badge();
        }
    }

    /// Appends the hours changed since the last flush to hours.jsonl, and
    /// lets go of hours too old to keep in memory.
    fn flush_hours(&self, wall: i64) {
        // Taken and written under the disk lock, so shutdown or a clear can't
        // land between the two and then be overwritten by this older copy.
        let _disk = self.disk();
        let flush: Vec<(String, Vec<Bucket>)> = {
            let mut inner = self.lock();
            let mut flush = Vec::new();
            for (id, live) in inner.live.iter_mut() {
                let buckets: Vec<Bucket> = std::mem::take(&mut live.dirty).into_iter().filter_map(|hour| live.hours.get(&hour).cloned()).collect();
                if !buckets.is_empty() {
                    flush.push((id.clone(), buckets));
                }
                let oldest = hour_of(wall - MEMORY_HOURS);
                live.hours = live.hours.split_off(&oldest);
            }
            flush
        };
        #[cfg(test)]
        {
            let between_flush = self.lock().between_flush.take();
            if let Some(between_flush) = between_flush {
                between_flush();
            }
        }
        if let Some(files) = self.files() {
            for (id, buckets) in &flush {
                if let Err(error) = files.append_hours(id, buckets) {
                    eprintln!("uptime: hours for {id} couldn't be written: {error}");
                }
            }
        }
    }

    /// Sends an alert everywhere it should go.
    fn send(self: &Arc<Self>, alert: Alert, settings: &Settings, skip: &[String]) {
        #[cfg(test)]
        self.lock().sent.push(alert.clone());
        if settings.desktop {
            let id = format!("uptime-{}-{}-{}", alert.id, alert.kind, alert.at);
            alerts::native::show(&alert.title, &alert.body, settings.sound, &id);
        }
        if let Some(app) = self.app.get() {
            let _ = app.emit(ALERT_EVENT, &alert);
        }
        for target in settings.targets.iter().filter(|target| !skip.contains(&target.id) && alert.wanted_by(target)) {
            self.deliver_in_background(target.clone(), alert.clone());
        }
    }

    /// Queues a webhook delivery behind the others for the same place, so
    /// a place hears of an outage before it hears of its end.
    fn deliver_in_background(self: &Arc<Self>, target: Target, alert: Alert) {
        let place = target.id.clone();
        let start = {
            let mut outbox = self.outbox();
            let generation = outbox.generations.get(&alert.id).copied().unwrap_or(0);
            outbox.queues.entry(place.clone()).or_default().push_back((target, alert, generation));
            outbox.sending.insert(place.clone())
        };
        if start {
            let engine = self.clone();
            tauri::async_runtime::spawn(async move { engine.send_queue(place).await });
        }
    }

    /// Sends one place's deliveries one at a time, oldest first, until none
    /// is left.
    async fn send_queue(self: Arc<Self>, place: String) {
        loop {
            let next = {
                let mut outbox = self.outbox();
                match outbox.queues.get_mut(&place).and_then(VecDeque::pop_front) {
                    Some((target, alert, generation)) => Some((target, alert, generation)),
                    None => {
                        outbox.queues.remove(&place);
                        outbox.sending.remove(&place);
                        None
                    }
                }
            };
            let Some((target, alert, generation)) = next else { return };
            #[cfg(test)]
            {
                let delay = self.lock().delivery_delay.take();
                if let Some(delay) = delay {
                    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay)).await;
                }
            }
            #[cfg(test)]
            {
                let at_client = self.lock().at_client.take();
                if let Some(at_client) = at_client {
                    at_client();
                }
            }
            let client = self.clients.get(0, false);
            // The last look, as the request starts, under the same lock a clear,
            // a delete or new settings take: the monitor not cleared or deleted
            // since, and the place still there, on, and wanting this alert, as
            // it is set now. Counted as started in the same step, so a clear
            // or a removal either stops it here or waits for it.
            let start = {
                let mut outbox = self.outbox();
                let place_now = if outbox.generations.get(&alert.id).copied().unwrap_or(0) == generation {
                    let inner = self.lock();
                    let skipped = inner.monitors.iter().find(|monitor| monitor.id == alert.id).is_some_and(|monitor| monitor.skip_alerts.contains(&target.id));
                    inner.settings.targets.iter().find(|current| current.id == target.id && alert.wanted_by(current) && !skipped).cloned()
                } else {
                    None
                };
                if let Some(current) = &place_now {
                    *outbox.started.entry(alert.id.clone()).or_default() += 1;
                    *outbox.started_places.entry(current.id.clone()).or_default() += 1;
                }
                place_now
            };
            let Some(current) = start else { continue };
            #[cfg(test)]
            {
                let before_request = self.lock().before_request.take();
                if let Some(before_request) = before_request {
                    before_request();
                }
            }
            let result = match client {
                Ok(client) => alerts::deliver(&client, &current, &alert).await,
                Err(error) => Err(error),
            };
            self.note_delivery(&current, &alert, &result);
            {
                let mut guard = self.outbox();
                let outbox = &mut *guard;
                for (map, key) in [(&mut outbox.started, &alert.id), (&mut outbox.started_places, &current.id)] {
                    if let Some(count) = map.get_mut(key) {
                        *count -= 1;
                        if *count == 0 {
                            map.remove(key);
                        }
                    }
                }
            }
            self.delivered.notify_all();
        }
    }

    fn note_delivery(&self, target: &Target, alert: &Alert, result: &Result<String, String>) {
        let delivery = Delivery {
            at: now_ms(),
            target: target.id.clone(),
            name: target.name.clone(),
            ok: result.is_ok(),
            note: match result {
                Ok(note) | Err(note) => note.clone(),
            },
            title: alert.title.clone(),
        };
        {
            let mut inner = self.lock();
            inner.deliveries.push_front(delivery);
            inner.deliveries.truncate(DELIVERIES);
        }
        // "Sent lately" on the Alerts page shows it now, not with whatever
        // sends the next view. A delivery doesn't change the Dock badge.
        self.emit_view();
    }

    // ---- what the commands do -------------------------------------------

    fn require_loaded(inner: &Inner) -> Result<(), String> {
        if inner.loaded {
            Ok(())
        } else {
            Err("Uptime is still opening. Try again in a moment".into())
        }
    }

    pub fn save(self: &Arc<Self>, monitor: Monitor) -> Result<Monitor, String> {
        let mut monitor = monitor.normalize()?;
        let now = now_ms();
        let disk = self.disk();
        let (event, first) = {
            let mut inner = self.lock();
            Self::require_loaded(&inner)?;
            let targets: HashSet<String> = inner.settings.targets.iter().map(|target| target.id.clone()).collect();
            monitor.skip_alerts.retain(|id| targets.contains(id));
            let existing = (!monitor.id.is_empty()).then(|| inner.monitors.iter().position(|old| old.id == monitor.id)).flatten();
            let result = match existing {
                Some(index) => {
                    let old = inner.monitors[index].clone();
                    monitor.created = old.created;
                    monitor.paused = old.paused;
                    monitor.paused_until = old.paused_until;
                    let changed = !old.same_check(&monitor);
                    inner.monitors[index] = monitor.clone();
                    let live = inner.live.entry(monitor.id.clone()).or_insert_with(|| Live::fresh(Instant::now()));
                    if changed {
                        // What the old settings found says nothing about the new ones.
                        if live.running.is_some() {
                            self.running.fetch_sub(1, Ordering::SeqCst);
                        }
                        live.stop(now, &old);
                        live.pool.clear();
                        live.reset_target();
                        live.next = Instant::now();
                        // On disk before the new settings: a pause saved the
                        // old target's state, and a kill before the next check
                        // would bring it back.
                        if let Some(files) = self.files() {
                            if let Err(error) = files.save_live(&monitor.id, &live.saved(&monitor)) {
                                eprintln!("uptime: {}/live.json couldn't be written: {error}", monitor.id);
                            }
                        }
                    } else if monitor.interval < old.interval {
                        live.next = live.next.min(Instant::now() + Duration::from_secs(monitor.interval as u64));
                    }
                    // "check" tells the page an outage of the old settings ended here.
                    let why = if changed { "check" } else { "" };
                    (Some(Event { t: now, kind: "changed".into(), msg: String::new(), why: why.into(), dur: None, seen: None, code: None }), false)
                }
                None => {
                    if inner.monitors.len() >= MAX_MONITORS {
                        return Err(format!("Uptime watches up to {MAX_MONITORS} monitors. Delete one to add another"));
                    }
                    monitor.id = history::new_id('m');
                    monitor.created = now;
                    monitor.paused = false;
                    monitor.paused_until = None;
                    inner.monitors.push(monitor.clone());
                    inner.live.insert(monitor.id.clone(), Live::fresh(Instant::now()));
                    let first = inner.monitors.len() == 1;
                    (Some(Event { t: now, kind: "added".into(), msg: String::new(), why: String::new(), dur: None, seen: None, code: None }), first)
                }
            };
            if let Some(live) = inner.live.get_mut(&monitor.id) {
                live.revision = self.bump();
                live.stamp = self.stamp();
            }
            self.save_config(&inner)?;
            self.kick(&mut inner);
            result
        };
        if let Some(event) = event {
            self.note_event(&monitor.id, &event);
        }
        drop(disk);
        if first && self.lock().settings.desktop {
            alerts::native::ask();
        }
        self.emit_state();
        Ok(monitor)
    }

    pub fn delete(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let disk = self.disk();
        {
            let mut inner = self.lock();
            Self::require_loaded(&inner)?;
            let Some(index) = inner.monitors.iter().position(|monitor| monitor.id == id) else { return Ok(()) };
            inner.monitors.remove(index);
            self.stamp();
            if let Some(live) = inner.live.remove(id) {
                if live.running.is_some() {
                    self.running.fetch_sub(1, Ordering::SeqCst);
                }
            }
            self.save_config(&inner)?;
            self.kick(&mut inner);
        }
        if let Some(files) = self.files() {
            files.remove(id);
        }
        self.drop_deliveries(id);
        drop(disk);
        // The page hears at once; a request it then waits for sends its own
        // view once recorded (`note_delivery`).
        self.emit_state();
        self.wait_for_deliveries(id);
        Ok(())
    }

    pub fn pause(self: &Arc<Self>, id: &str, until: Option<i64>) -> Result<(), String> {
        let now = now_ms();
        if until.is_some_and(|until| until <= now || until > now + 365 * DAY) {
            return Err("Pick a time in the future for the pause to end".into());
        }
        let disk = self.disk();
        {
            let mut guard = self.lock();
            let inner = &mut *guard;
            Self::require_loaded(inner)?;
            let Some(monitor) = inner.monitors.iter_mut().find(|monitor| monitor.id == id) else { return Err("That monitor isn't there any more".into()) };
            monitor.paused = true;
            monitor.paused_until = until;
            let paused = monitor.clone();
            if let Some(live) = inner.live.get_mut(id) {
                if live.running.is_some() {
                    self.running.fetch_sub(1, Ordering::SeqCst);
                }
                live.stop(now, &paused);
                live.revision = self.bump();
                live.stamp = self.stamp();
                if let Some(files) = self.files.get() {
                    let _ = files.save_live(id, &live.saved(&paused));
                }
            }
            self.save_config(inner)?;
            self.kick(inner);
        }
        let mut event = Event { t: now, kind: "paused".into(), msg: String::new(), why: String::new(), dur: None, seen: None, code: None };
        if let Some(until) = until {
            event.dur = Some(until - now);
        }
        self.note_event(id, &event);
        drop(disk);
        self.emit_state();
        Ok(())
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let disk = self.disk();
        {
            let mut guard = self.lock();
            let inner = &mut *guard;
            Self::require_loaded(inner)?;
            let Some(monitor) = inner.monitors.iter_mut().find(|monitor| monitor.id == id) else { return Err("That monitor isn't there any more".into()) };
            if !monitor.paused {
                return Ok(());
            }
            monitor.paused = false;
            monitor.paused_until = None;
            if let Some(live) = inner.live.get_mut(id) {
                live.next = Instant::now();
                live.revision = self.bump();
                live.stamp = self.stamp();
            }
            self.save_config(inner)?;
            self.kick(inner);
        }
        self.note_event(id, &Event { t: now_ms(), kind: "resumed".into(), msg: String::new(), why: String::new(), dur: None, seen: None, code: None });
        drop(disk);
        self.emit_state();
        Ok(())
    }

    /// Checks one monitor now, or every monitor that isn't paused, a moment
    /// apart.
    pub fn check_now(self: &Arc<Self>, id: Option<&str>) -> Result<(), String> {
        let mut inner = self.lock();
        Self::require_loaded(&inner)?;
        let now = Instant::now();
        let ids: Vec<String> = inner.monitors.iter().filter(|monitor| !monitor.paused && id.map_or(true, |id| monitor.id == id)).map(|monitor| monitor.id.clone()).collect();
        for (index, id) in ids.iter().enumerate() {
            if let Some(live) = inner.live.get_mut(id) {
                if live.running.is_none() {
                    live.next = now + Duration::from_millis(150 * index as u64);
                }
            }
        }
        // A check after the computer woke goes ahead when asked for.
        inner.hold_until = None;
        self.kick(&mut inner);
        Ok(())
    }

    pub fn clear(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let disk = self.disk();
        {
            let mut inner = self.lock();
            Self::require_loaded(&inner)?;
            if !inner.monitors.iter().any(|monitor| monitor.id == id) {
                return Err("That monitor isn't there any more".into());
            }
            if let Some(live) = inner.live.get(id) {
                if live.running.is_some() {
                    self.running.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let mut fresh = Live::fresh(Instant::now());
            fresh.revision = self.bump();
            fresh.stamp = self.stamp();
            inner.live.insert(id.to_string(), fresh);
            if let Some(files) = self.files() {
                files.remove(id);
            }
            self.kick(&mut inner);
        }
        self.drop_deliveries(id);
        drop(disk);
        // The page hears at once; a request it then waits for sends its own
        // view once recorded (`note_delivery`).
        self.emit_state();
        self.wait_for_deliveries(id);
        Ok(())
    }

    pub fn reorder(self: &Arc<Self>, ids: &[String]) -> Result<(), String> {
        {
            let mut inner = self.lock();
            Self::require_loaded(&inner)?;
            let place: HashMap<&str, usize> = ids.iter().enumerate().map(|(index, id)| (id.as_str(), index)).collect();
            inner.monitors.sort_by_key(|monitor| place.get(monitor.id.as_str()).copied().unwrap_or(usize::MAX));
            self.stamp();
            self.save_config(&inner)?;
        }
        self.emit_state();
        Ok(())
    }

    pub fn save_settings(self: &Arc<Self>, settings: Settings) -> Result<Settings, String> {
        let mut settings = settings.normalize()?;
        for target in settings.targets.iter_mut() {
            if !history::valid_id(&target.id) {
                target.id = history::new_id('a');
            }
        }
        let (turned_on, changed) = {
            let mut inner = self.lock();
            Self::require_loaded(&inner)?;
            // Made from older settings, by another window say: saving it
            // would undo what was saved since.
            if settings.rev != inner.settings.rev {
                return Err(model::SETTINGS_CHANGED.into());
            }
            settings.rev = inner.settings.rev + 1;
            let turned_on = settings.desktop && !inner.settings.desktop;
            let changed: Vec<String> = inner.settings.targets.iter().filter(|old| !settings.targets.contains(old)).map(|old| old.id.clone()).collect();
            inner.settings = settings.clone();
            self.stamp();
            self.save_config(&inner)?;
            (turned_on, changed)
        };
        // The page hears at once. A request that started for a place as it
        // was set before can't be called back, so this then waits for it:
        // nothing arrives at a place after it was removed or changed. One not
        // started yet gets the new settings as it starts (`send_queue`).
        self.emit_state();
        if !changed.is_empty() {
            self.wait_for_requests(|outbox| changed.iter().any(|id| outbox.started_places.contains_key(id)));
        }
        if turned_on {
            alerts::native::ask();
        }
        Ok(settings)
    }

    /// A test alert: on this computer when `target` is None, else to that place.
    pub async fn test_alert(self: &Arc<Self>, target: Option<Target>) -> Result<String, String> {
        let alert = Alert {
            id: String::new(),
            name: "Uptime".into(),
            kind: "test".into(),
            title: "Uptime alerts work".into(),
            body: "This is how an alert from Uptime looks.".into(),
            target: String::new(),
            at: now_ms(),
            down_for: None,
            why: String::new(),
        };
        match target {
            None => {
                let sound = self.lock().settings.sound;
                alerts::native::ask();
                if let Some(app) = self.app.get() {
                    let _ = app.emit(ALERT_EVENT, &alert);
                }
                Ok(if alerts::native::show(&alert.title, &alert.body, sound, &format!("uptime-test-{}", alert.at)) { "native" } else { notifications_kind() }.into())
            }
            Some(target) => {
                let mut target = target.normalize()?;
                if target.id.is_empty() {
                    target.id = "new".into();
                }
                let client = self.clients.get(0, false)?;
                let result = alerts::deliver(&client, &target, &alert).await;
                self.note_delivery(&target, &alert, &result);
                result
            }
        }
    }

    pub fn beats(&self, id: &str, from: i64, to: i64) -> Result<Vec<Beat>, String> {
        if to <= from || to - from > 3 * DAY + HOUR {
            return Err("Ask for three days of checks or fewer".into());
        }
        if !self.lock().monitors.iter().any(|monitor| monitor.id == id) {
            return Err("That monitor isn't there any more".into());
        }
        Ok(self.files().map(|files| files.beats(id, from, to)).unwrap_or_default())
    }

    pub fn hours(&self, id: &str, from: i64, to: i64) -> Result<Vec<Bucket>, String> {
        let now = now_ms();
        let memory: BTreeMap<i64, Bucket> = {
            let inner = self.lock();
            let live = inner.live.get(id).ok_or_else(|| "That monitor isn't there any more".to_string())?;
            live.hours.range(hour_of(from)..to).map(|(hour, bucket)| (*hour, bucket.clone())).collect()
        };
        let mut hours = if from < now - MEMORY_HOURS + DAY {
            self.files().map(|files| files.hours(id, hour_of(from), to)).unwrap_or_default()
        } else {
            BTreeMap::new()
        };
        hours.extend(memory);
        Ok(hours.into_values().collect())
    }

    pub fn events(&self, id: Option<&str>, limit: usize) -> Vec<EventRow> {
        let ids: Vec<String> = self.lock().monitors.iter().filter(|monitor| id.map_or(true, |id| monitor.id == id)).map(|monitor| monitor.id.clone()).collect();
        let Some(files) = self.files() else { return Vec::new() };
        let mut rows: Vec<EventRow> = ids.iter().flat_map(|id| files.events(id, limit).into_iter().map(move |event| EventRow { id: id.clone(), event })).collect();
        rows.sort_by(|a, b| b.event.t.cmp(&a.event.t));
        rows.truncate(limit);
        rows
    }

    /// The app is quitting: each monitor's last check counts up to now, the
    /// hours are written, and the scheduler stops.
    pub fn shutdown(&self) {
        // Waits for a check being written now, and keeps any other from being
        // written after (`record` sees `stopping`).
        let _disk = self.disk();
        let now = now_ms();
        let mut writes: Vec<(String, Saved, Vec<Bucket>)> = Vec::new();
        {
            let mut guard = self.lock();
            let inner = &mut *guard;
            inner.stopping = true;
            for monitor in &inner.monitors {
                let Some(live) = inner.live.get_mut(&monitor.id) else { continue };
                if !monitor.paused {
                    live.close_last(now, skew(), monitor, None);
                    live.last = None;
                }
                let buckets: Vec<Bucket> = std::mem::take(&mut live.dirty).into_iter().filter_map(|hour| live.hours.get(&hour).cloned()).collect();
                writes.push((monitor.id.clone(), live.saved(monitor), buckets));
            }
            self.wake.notify_all();
        }
        if let Some(files) = self.files() {
            for (id, saved, buckets) in writes {
                let _ = files.append_hours(&id, &buckets);
                let _ = files.save_live(&id, &saved);
            }
        }
    }
}

/// Starts Uptime: loads what was saved and starts the schedule. From `setup`.
pub fn register(app: &AppHandle) {
    let engine = app.state::<UptimeState>().0.clone();
    let root = match app.path().app_data_dir() {
        Ok(dir) => dir.join("uptime"),
        Err(error) => {
            eprintln!("uptime: no data folder: {error}");
            return;
        }
    };
    let _ = engine.app.set(app.clone());
    let _ = engine.files.set(Files::new(root));
    let worker = engine.clone();
    if let Err(error) = std::thread::Builder::new().name("uptime".into()).spawn(move || worker.run()) {
        eprintln!("uptime: the schedule couldn't start: {error}");
    }
}

pub fn shutdown(app: &AppHandle) {
    app.state::<UptimeState>().0.shutdown();
}

// ---- commands ---------------------------------------------------------------

/// The editor's own page only: a panel asks the editor, the Growth browser
/// is a webview inside the editor window, and the assistant windows host
/// other people's sites.
fn guard(window: &tauri::Window, webview: &tauri::Webview) -> Result<(), String> {
    if crate::settings::is_editor_window(window.label()) && webview.label() == window.label() {
        Ok(())
    } else {
        Err("Only the editor window can use Uptime".into())
    }
}

fn known_id(id: &str) -> Result<(), String> {
    if history::valid_id(id) {
        Ok(())
    } else {
        Err("That monitor isn't there any more".into())
    }
}

#[tauri::command]
pub async fn abs_uptime_state(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>) -> Result<View, String> {
    guard(&window, &webview)?;
    Ok(state.0.view())
}

#[tauri::command]
pub async fn abs_uptime_save(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, monitor: Monitor) -> Result<Monitor, String> {
    guard(&window, &webview)?;
    if !monitor.id.is_empty() {
        known_id(&monitor.id)?;
    }
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.save(monitor)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_delete(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String) -> Result<(), String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.delete(&id)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_pause(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String, until: Option<i64>) -> Result<(), String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.pause(&id, until)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_resume(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String) -> Result<(), String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.resume(&id)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_check(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: Option<String>) -> Result<(), String> {
    guard(&window, &webview)?;
    if let Some(id) = &id {
        known_id(id)?;
    }
    state.0.check_now(id.as_deref())
}

#[tauri::command]
pub async fn abs_uptime_test(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, monitor: Monitor) -> Result<TestResult, String> {
    guard(&window, &webview)?;
    let mut monitor = monitor;
    // A test from the form may come before the monitor has a name.
    if monitor.name.trim().is_empty() {
        monitor.name = "Test".into();
    }
    let monitor = monitor.normalize()?;
    let engine = state.0.clone();
    let outcome = if checks::is_async(monitor.kind) {
        checks::run_async(&monitor, &engine.clients).await
    } else {
        tauri::async_runtime::spawn_blocking(move || checks::blocking(&monitor)).await.map_err(|error| error.to_string())?
    };
    Ok(TestResult { ok: outcome.ok, ms: outcome.ms, code: outcome.code, why: outcome.why, msg: outcome.msg, detail: outcome.detail, inconclusive: outcome.inconclusive })
}

#[tauri::command]
pub async fn abs_uptime_clear(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String) -> Result<(), String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.clear(&id)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_reorder(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, ids: Vec<String>) -> Result<(), String> {
    guard(&window, &webview)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.reorder(&ids)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_settings(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, settings: Settings) -> Result<Settings, String> {
    guard(&window, &webview)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.save_settings(settings)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_alert_test(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, target: Option<Target>) -> Result<String, String> {
    guard(&window, &webview)?;
    let engine = state.0.clone();
    engine.test_alert(target).await
}

#[tauri::command]
pub async fn abs_uptime_beats(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String, from: i64, to: i64) -> Result<Vec<Beat>, String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.beats(&id, from, to)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_hours(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: String, from: i64, to: i64) -> Result<Vec<Bucket>, String> {
    guard(&window, &webview)?;
    known_id(&id)?;
    let engine = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || engine.hours(&id, from, to)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn abs_uptime_events(window: tauri::Window, webview: tauri::Webview, state: tauri::State<'_, UptimeState>, id: Option<String>, limit: Option<u32>) -> Result<Vec<EventRow>, String> {
    guard(&window, &webview)?;
    if let Some(id) = &id {
        known_id(id)?;
    }
    let engine = state.0.clone();
    let limit = limit.unwrap_or(50).clamp(1, 500) as usize;
    tauri::async_runtime::spawn_blocking(move || engine.events(id.as_deref(), limit)).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beat(t: i64, s: BeatStatus) -> Beat {
        Beat { t, s, ms: Some(100), code: None, why: String::new(), msg: String::new(), slow: false }
    }

    /// A monitor whose every check stands for `cover` ms at most.
    fn covering(cover: i64) -> Monitor {
        let seconds = (cover / 1000 - 15) as u32;
        Monitor { interval: seconds, retry_interval: seconds, timeout: 0, ..Monitor::default() }
    }

    /// Feeds beats through the same steps `record` takes for the hours.
    fn feed(live: &mut Live, beats: &[Beat], gap: i64) {
        let monitor = covering(gap);
        for beat in beats {
            let skew_then = live.last_skew;
            live.close_last(beat.t, skew_then, &monitor, Some(beat.s));
            live.count(beat);
            live.last = Some(beat.clone());
            // The state as record() leaves it, as far as close_last reads it.
            match beat.s {
                BeatStatus::Up => {
                    live.state = State::Up;
                    live.first_fail = None;
                }
                BeatStatus::Pending => {
                    live.first_fail.get_or_insert(beat.t);
                }
                BeatStatus::Down => {
                    live.first_fail.get_or_insert(beat.t);
                    live.state = State::Down;
                }
                BeatStatus::Offline | BeatStatus::Unclear => {}
            }
        }
    }

    const T0: i64 = 1_800_000_000_000 - 1_800_000_000_000 % HOUR;

    #[test]
    fn each_check_stands_for_the_time_until_the_next() {
        let mut live = Live::fresh(Instant::now());
        let gap = 10 * MINUTE;
        feed(&mut live, &[beat(T0, BeatStatus::Up), beat(T0 + MINUTE, BeatStatus::Up), beat(T0 + 2 * MINUTE, BeatStatus::Down), beat(T0 + 3 * MINUTE, BeatStatus::Up)], gap);
        let bucket = &live.hours[&T0];
        assert_eq!(bucket.up, 2 * MINUTE);
        assert_eq!(bucket.down, MINUTE);
        assert_eq!(bucket.n, 4);
        assert_eq!(bucket.fails, 1);
        assert_eq!(bucket.cnt, 3);
        let uptime = live.uptime_since(T0).unwrap();
        assert!((uptime - 66.666).abs() < 0.01, "{uptime}");
    }

    #[test]
    fn a_long_gap_counts_as_neither() {
        let mut live = Live::fresh(Instant::now());
        let gap = 2 * MINUTE;
        // The app was closed for an hour between these.
        feed(&mut live, &[beat(T0, BeatStatus::Down), beat(T0 + HOUR, BeatStatus::Up)], gap);
        assert_eq!(live.hours[&T0].down, 2 * MINUTE);
        assert_eq!(live.hours[&T0].up, 0);
    }

    #[test]
    fn checking_again_counts_as_down_once_confirmed_and_up_if_it_passes() {
        let gap = 10 * MINUTE;
        let mut confirmed = Live::fresh(Instant::now());
        feed(&mut confirmed, &[beat(T0, BeatStatus::Up), beat(T0 + MINUTE, BeatStatus::Pending), beat(T0 + MINUTE + 20_000, BeatStatus::Down), beat(T0 + 3 * MINUTE, BeatStatus::Up)], gap);
        assert_eq!(confirmed.hours[&T0].down, 2 * MINUTE);
        assert_eq!(confirmed.down_seen, 2 * MINUTE);
        let mut blip = Live::fresh(Instant::now());
        feed(&mut blip, &[beat(T0, BeatStatus::Up), beat(T0 + MINUTE, BeatStatus::Pending), beat(T0 + MINUTE + 20_000, BeatStatus::Up), beat(T0 + 3 * MINUTE, BeatStatus::Up)], gap);
        assert_eq!(blip.hours[&T0].down, 0);
        assert_eq!(blip.hours[&T0].up, 3 * MINUTE);
    }

    #[test]
    fn offline_checks_count_for_nothing() {
        let gap = 10 * MINUTE;
        let mut live = Live::fresh(Instant::now());
        feed(&mut live, &[beat(T0, BeatStatus::Up), beat(T0 + MINUTE, BeatStatus::Offline), beat(T0 + 2 * MINUTE, BeatStatus::Up), beat(T0 + 3 * MINUTE, BeatStatus::Up)], gap);
        assert_eq!(live.hours[&T0].up, 2 * MINUTE);
        assert_eq!(live.hours[&T0].down, 0);
        assert_eq!(live.hours[&T0].n, 3);
    }

    #[test]
    fn time_is_split_at_the_hour() {
        let gap = 10 * MINUTE;
        let mut live = Live::fresh(Instant::now());
        feed(&mut live, &[beat(T0 + HOUR - MINUTE, BeatStatus::Up), beat(T0 + HOUR + MINUTE, BeatStatus::Up)], gap);
        assert_eq!(live.hours[&T0].up, MINUTE);
        assert_eq!(live.hours[&(T0 + HOUR)].up, MINUTE);
    }

    #[test]
    fn stopping_counts_the_last_check_up_to_now() {
        let mut live = Live::fresh(Instant::now());
        feed(&mut live, &[beat(T0, BeatStatus::Up)], 10 * MINUTE);
        live.stop(T0 + 30_000, &covering(10 * MINUTE));
        assert_eq!(live.hours[&T0].up, 30_000);
        assert!(live.last.is_none());
        // Stopping again adds nothing.
        live.stop(T0 + 60_000, &covering(10 * MINUTE));
        assert_eq!(live.hours[&T0].up, 30_000);
    }

    #[test]
    fn response_times_are_summed_for_checks_that_passed() {
        let mut live = Live::fresh(Instant::now());
        let mut fast = beat(T0, BeatStatus::Up);
        fast.ms = Some(50);
        let mut slow = beat(T0 + MINUTE, BeatStatus::Up);
        slow.ms = Some(150);
        let mut failed = beat(T0 + 2 * MINUTE, BeatStatus::Down);
        failed.ms = Some(9000);
        feed(&mut live, &[fast, slow, failed], 10 * MINUTE);
        assert_eq!(live.average_since(T0), Some(100));
        assert_eq!(live.hours[&T0].min, 50);
        assert_eq!(live.hours[&T0].max, 150);
    }

    #[test]
    fn certificate_warnings_step_down() {
        assert_eq!(cert_threshold(14, 30), None);
        assert_eq!(cert_threshold(14, 14), Some(14));
        assert_eq!(cert_threshold(14, 10), Some(14));
        assert_eq!(cert_threshold(14, 7), Some(7));
        assert_eq!(cert_threshold(14, 5), Some(7));
        assert_eq!(cert_threshold(14, 2), Some(3));
        assert_eq!(cert_threshold(14, 0), Some(1));
        assert_eq!(cert_threshold(14, -3), Some(1));
        assert_eq!(cert_threshold(5, 6), None);
        assert_eq!(cert_threshold(5, 4), Some(5));
        assert_eq!(cert_threshold(0, 1), None);
    }

    #[test]
    fn durations_read_as_words() {
        assert_eq!(duration_words(20_000), "less than a minute");
        assert_eq!(duration_words(MINUTE), "1 minute");
        assert_eq!(duration_words(4 * MINUTE + 10_000), "4 minutes");
        assert_eq!(duration_words(HOUR), "1 hour");
        assert_eq!(duration_words(HOUR + 5 * MINUTE), "1 hour 5 minutes");
        assert_eq!(duration_words(3 * DAY + 2 * HOUR), "3 days 2 hours");
        assert_eq!(duration_words(DAY), "1 day");
    }

    #[test]
    fn a_saved_state_comes_back() {
        let mut live = Live::fresh(Instant::now());
        feed(&mut live, &[beat(T0, BeatStatus::Up), beat(T0 + MINUTE, BeatStatus::Up)], 10 * MINUTE);
        live.state = State::Up;
        live.since = Some(T0);
        let saved = live.saved(&covering(10 * MINUTE));
        let mut back = Live::fresh(Instant::now());
        back.restore(serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap());
        assert_eq!(back.state, State::Up);
        assert_eq!(back.since, Some(T0));
        assert_eq!(back.hours[&T0].up, MINUTE);
        assert!(back.dirty.contains(&T0));
    }

    // ---- the state machine in record(), without the app or the disk ----

    use super::checks::Outcome;
    use super::model::{Cert, Kind, Monitor};

    fn engine_with(monitor: Monitor) -> Arc<Engine> {
        let engine = Arc::new(Engine::default());
        {
            let mut inner = engine.lock();
            inner.loaded = true;
            inner.settings = Settings { desktop: false, ..Settings::default() };
            inner.live.insert(monitor.id.clone(), Live::fresh(Instant::now()));
            inner.monitors.push(monitor);
        }
        engine
    }

    /// What launch() does before a check, then the check's answer. Each
    /// check starts ten seconds after the one before, so their times differ.
    fn check(engine: &Arc<Engine>, id: &str, outcome: Outcome) -> u64 {
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            let started = now_ms() + token as i64 * 10_000;
            inner.live.get_mut(id).unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started, started_skew: skew() });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.record(id, token, outcome);
        token
    }

    fn up() -> Outcome {
        Outcome { ok: true, ms: Some(40), code: Some(200), ..Outcome::default() }
    }

    fn failed(why: &str) -> Outcome {
        Outcome { ok: false, why: why.into(), msg: "The page answered 503 Service Unavailable".into(), code: Some(503), ..Outcome::default() }
    }

    fn site(retries: u32) -> Monitor {
        Monitor { id: "mtestsite".into(), name: "Shop".into(), url: "https://shop.example".into(), retries, ..Monitor::default() }
    }

    fn state_of(engine: &Arc<Engine>) -> (State, u32, Option<i64>) {
        let inner = engine.lock();
        let live = &inner.live["mtestsite"];
        (live.state, live.fails, live.down_since)
    }

    fn kinds(engine: &Arc<Engine>) -> Vec<String> {
        engine.lock().sent.iter().map(|alert| alert.kind.clone()).collect()
    }

    #[test]
    fn a_failure_is_checked_again_before_it_counts_as_down() {
        let engine = engine_with(site(1));
        check(&engine, "mtestsite", up());
        assert_eq!(state_of(&engine).0, State::Up);
        check(&engine, "mtestsite", failed("status"));
        let (state, fails, down_since) = state_of(&engine);
        assert_eq!((state, fails, down_since), (State::Pending, 1, None));
        assert!(kinds(&engine).is_empty());
        let first_fail = engine.lock().live["mtestsite"].first_fail;
        check(&engine, "mtestsite", failed("status"));
        let (state, _, down_since) = state_of(&engine);
        assert_eq!(state, State::Down);
        // Down from the first failed check, not the one that confirmed it.
        assert_eq!(down_since, first_fail);
        assert_eq!(kinds(&engine), vec!["down"]);
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(kinds(&engine), vec!["down"], "one alert per outage");
        check(&engine, "mtestsite", up());
        assert_eq!(state_of(&engine).0, State::Up);
        assert_eq!(kinds(&engine), vec!["down", "up"]);
        let sent = engine.lock().sent.clone();
        assert_eq!(sent[0].title, "Shop is down");
        assert_eq!(sent[0].body, "The page answered 503 Service Unavailable.");
        assert_eq!(sent[1].title, "Shop is back up");
        assert!(sent[1].down_for.is_some());
    }

    #[test]
    fn with_no_retries_the_first_failure_is_down() {
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(state_of(&engine).0, State::Down);
        assert_eq!(kinds(&engine), vec!["down"]);
    }

    #[test]
    fn a_blip_that_passes_on_the_second_check_never_alerts_and_keeps_since() {
        let engine = engine_with(site(1));
        check(&engine, "mtestsite", up());
        let since = engine.lock().live["mtestsite"].since;
        check(&engine, "mtestsite", failed("timeout"));
        check(&engine, "mtestsite", up());
        assert_eq!(state_of(&engine).0, State::Up);
        assert_eq!(engine.lock().live["mtestsite"].since, since);
        assert!(kinds(&engine).is_empty());
    }

    #[test]
    fn an_answer_to_an_old_check_is_dropped() {
        let engine = engine_with(site(0));
        let old = check(&engine, "mtestsite", up());
        // A second check starts; the first one's answer arrives late.
        {
            let mut inner = engine.lock();
            inner.live.get_mut("mtestsite").unwrap().running = Some(Running { token: old + 1, deadline: Instant::now() + Duration::from_secs(60), started: now_ms(), started_skew: skew() });
        }
        engine.record("mtestsite", old, failed("timeout"));
        assert_eq!(state_of(&engine).0, State::Up);
        assert!(engine.lock().live["mtestsite"].running.is_some());
        assert!(kinds(&engine).is_empty());
    }

    #[test]
    fn a_failure_with_no_network_counts_for_nothing() {
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", up());
        engine.lock().no_route = true;
        check(&engine, "mtestsite", failed("timeout"));
        let (state, fails, _) = state_of(&engine);
        assert_eq!((state, fails), (State::Up, 0));
        assert!(kinds(&engine).is_empty());
        assert!(engine.lock().offline_since.is_some());
        assert_eq!(engine.lock().live["mtestsite"].recent.back().map(|beat| beat.s), Some(BeatStatus::Offline));
        // A refusal proves the network works, so it counts even then.
        check(&engine, "mtestsite", failed("refused"));
        assert_eq!(state_of(&engine).0, State::Down);
        engine.lock().no_route = false;
        check(&engine, "mtestsite", up());
        assert!(engine.lock().offline_since.is_none());
    }

    #[test]
    fn a_paused_monitor_records_nothing() {
        let engine = engine_with(site(0));
        engine.lock().monitors[0].paused = true;
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(state_of(&engine).0, State::Unknown);
        assert!(engine.lock().live["mtestsite"].recent.is_empty());
    }

    #[test]
    fn a_reminder_comes_while_it_stays_down() {
        let engine = engine_with(site(0));
        engine.lock().settings.remind = 30;
        check(&engine, "mtestsite", failed("status"));
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(kinds(&engine), vec!["down"]);
        engine.lock().live.get_mut("mtestsite").unwrap().last_alert = now_ms() - 31 * MINUTE;
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(kinds(&engine), vec!["down", "reminder"]);
        assert!(engine.lock().sent[1].title.ends_with("is still down"));
    }

    #[test]
    fn certificate_warnings_come_once_per_step() {
        let engine = engine_with(site(0));
        let with_cert = |days: i64| Outcome { detail: Detail { cert: Some(Cert { expires: now_ms() + days * DAY + HOUR, ..Cert::default() }), ..Detail::default() }, ..up() };
        check(&engine, "mtestsite", with_cert(40));
        assert!(kinds(&engine).is_empty());
        check(&engine, "mtestsite", with_cert(10));
        check(&engine, "mtestsite", with_cert(9));
        assert_eq!(kinds(&engine), vec!["cert"]);
        assert_eq!(engine.lock().sent[0].title, "The certificate for shop.example runs out in 10 days");
        check(&engine, "mtestsite", with_cert(6));
        assert_eq!(kinds(&engine), vec!["cert", "cert"]);
        // Renewed: the steps start over.
        check(&engine, "mtestsite", with_cert(90));
        check(&engine, "mtestsite", with_cert(12));
        assert_eq!(kinds(&engine), vec!["cert", "cert", "cert"]);
    }

    #[test]
    fn a_new_store_version_is_news() {
        let monitor = Monitor { id: "mtestsite".into(), name: "App".into(), kind: Kind::Store, app_id: "1234".into(), ..Monitor::default() };
        let engine = engine_with(monitor);
        let version = |text: &str| Outcome { detail: Detail { version: Some(text.into()), app_name: Some("Ludo".into()), ..Detail::default() }, ..up() };
        check(&engine, "mtestsite", version("1.0"));
        check(&engine, "mtestsite", version("1.0"));
        assert!(kinds(&engine).is_empty());
        check(&engine, "mtestsite", version("1.1"));
        assert_eq!(kinds(&engine), vec!["news"]);
        assert_eq!(engine.lock().sent[0].title, "Ludo 1.1 is live");
    }

    // ---- the audit of 2026-11-26: written to fail on the code it audited ----

    /// A check that started at `started`, then its answer.
    fn check_at(engine: &Arc<Engine>, id: &str, outcome: Outcome, started: i64) {
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            inner.live.get_mut(id).unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started, started_skew: skew() });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.record(id, token, outcome);
    }

    fn total(engine: &Arc<Engine>, id: &str) -> (i64, i64) {
        engine.lock().live[id].hours.values().fold((0, 0), |(up, down), bucket| (up + bucket.up, down + bucket.down))
    }

    #[test]
    fn a_check_stands_for_its_interval_and_timeout_at_most() {
        // Defaults: a check every 60 s that may take 10 s.
        let engine = engine_with(site(0));
        let t0 = hour_of(now_ms()) - 3 * HOUR;
        check_at(&engine, "mtestsite", up(), t0);
        check_at(&engine, "mtestsite", up(), t0 + 10 * MINUTE);
        assert_eq!(total(&engine, "mtestsite"), (85_000, 0));
    }

    #[test]
    fn the_time_a_crashed_app_was_gone_counts_for_nothing() {
        let root = std::env::temp_dir().join(format!("osg-uptime-crash-{}", history::new_id('x')));
        let files = Files::new(root.clone());
        let monitor = Monitor { id: "mcrashtest".into(), name: "Shop".into(), url: "https://shop.example".into(), retries: 0, ..Monitor::default() };
        files.save_config(&Config { version: 1, monitors: vec![monitor.clone()], settings: Settings::default() }).unwrap();
        let now = now_ms();
        // The app was killed 40.5 s after a check that found the site down,
        // so live.json still has that check open.
        let down = Beat { t: now - 40_500, s: BeatStatus::Down, ms: None, code: Some(503), why: "status".into(), msg: "The page answered 503 Service Unavailable".into(), slow: false };
        files.save_live(&monitor.id, &Saved { state: State::Down, since: Some(now - 90_000), fails: 2, last: Some(down), down_since: Some(now - 90_000), ..Saved::default() }).unwrap();
        let engine = Arc::new(Engine::default());
        let _ = engine.files.set(Files::new(root.clone()));
        engine.load();
        engine.lock().settings.desktop = false;
        check_at(&engine, "mcrashtest", failed("status"), now);
        assert_eq!(total(&engine, "mcrashtest"), (0, 0), "no time between the last check before the crash and the first one after it");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uptime_over_the_last_day_leaves_out_the_hour_before_it() {
        // 30 minutes down at the start of an hour, then 24 hours up: the last
        // 24 hours hold none of the outage.
        let engine = engine_with(site(0));
        let t0 = hour_of(now_ms()) - 26 * HOUR;
        let mut t = t0;
        while t < t0 + 30 * MINUTE {
            check_at(&engine, "mtestsite", failed("status"), t);
            t += MINUTE;
        }
        let end = t0 + 30 * MINUTE + DAY;
        while t <= end {
            check_at(&engine, "mtestsite", up(), t);
            t += MINUTE;
        }
        let share = engine.lock().live["mtestsite"].uptime_since(end - DAY).unwrap();
        assert_eq!(share, 100.0, "{share}");
    }

    #[test]
    fn a_sleep_closes_every_open_check_where_it_began() {
        let engine = engine_with(site(0));
        let t0 = hour_of(now_ms()) - 3 * HOUR;
        check_at(&engine, "mtestsite", up(), t0);
        {
            let mut guard = engine.lock();
            engine.slept(&mut guard, t0 + 5_000, Instant::now());
        }
        check_at(&engine, "mtestsite", up(), t0 + 30 * MINUTE);
        assert_eq!(total(&engine, "mtestsite"), (5_000, 0));
    }

    #[test]
    fn a_check_that_slept_through_is_dropped() {
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", up());
        // A check that started before a ten minute sleep, and timed out after it.
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            inner.live.get_mut("mtestsite").unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started: now_ms() - 10 * MINUTE, started_skew: skew() - 10 * MINUTE });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.record("mtestsite", token, failed("timeout"));
        let inner = engine.lock();
        let live = &inner.live["mtestsite"];
        assert_eq!((live.state, live.fails, live.recent.len()), (State::Up, 0, 1));
        assert!(live.running.is_none());
        assert!(inner.sent.is_empty());
    }

    #[test]
    fn clearing_a_paused_monitor_moves_its_history_revision_on() {
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", failed("status"));
        check(&engine, "mtestsite", up());
        engine.pause("mtestsite", None).unwrap();
        let before = engine.lock().live["mtestsite"].revision;
        engine.clear("mtestsite").unwrap();
        let inner = engine.lock();
        assert!(inner.live["mtestsite"].revision > before);
        assert!(inner.live["mtestsite"].hours.is_empty());
    }

    #[test]
    fn the_average_covers_exactly_the_last_day() {
        let engine = engine_with(site(0));
        let now = now_ms();
        let mut slow = up();
        slow.ms = Some(900);
        // A slow check 25 hours ago, in the hour the window starts in.
        check_at(&engine, "mtestsite", slow, now - DAY - 10 * MINUTE);
        check_at(&engine, "mtestsite", up(), now - HOUR);
        let inner = engine.lock();
        assert_eq!(inner.live["mtestsite"].average_since(now - DAY), Some(40));
    }

    // ---- the re-audit of 2026-11-26: written to fail on the code it audited ----

    #[test]
    fn an_unreadable_store_page_never_calls_the_app_down() {
        let monitor = Monitor { id: "mtestsite".into(), name: "Listing".into(), kind: Kind::Store, store: "google".into(), app_id: "com.example.app".into(), retries: 1, ..Monitor::default() };
        let engine = engine_with(monitor);
        check(&engine, "mtestsite", up());
        // What the store check answers for a Google Play page it can't read,
        // and for Google Play answering 503.
        let listing = engine.lock().monitors[0].clone();
        let unreadable = || checks::store_answer(&listing, 200, "play.google.com", b"<html><body>Changed</body></html>", Duration::from_millis(300));
        let busy = || checks::store_answer(&listing, 503, "play.google.com", b"", Duration::from_millis(300));
        check(&engine, "mtestsite", unreadable());
        check(&engine, "mtestsite", unreadable());
        check(&engine, "mtestsite", busy());
        assert_eq!(state_of(&engine).0, State::Up);
        assert!(kinds(&engine).is_empty(), "{:?}", kinds(&engine));
        let inner = engine.lock();
        let live = &inner.live["mtestsite"];
        assert_eq!(live.recent.back().map(|beat| beat.s), Some(BeatStatus::Unclear));
        assert_eq!(live.fails, 0);
        // A definite answer still counts: the app gone from the store.
        drop(inner);
        check(&engine, "mtestsite", checks::store_answer(&listing, 404, "play.google.com", b"", Duration::from_millis(300)));
        check(&engine, "mtestsite", checks::store_answer(&listing, 404, "play.google.com", b"", Duration::from_millis(300)));
        assert_eq!(state_of(&engine).0, State::Down);
    }

    #[test]
    fn a_new_app_number_is_not_a_new_version() {
        let pages = Monitor { id: "mtestsite".into(), name: "App".into(), kind: Kind::Store, store: "apple".into(), app_id: "361309726".into(), ..Monitor::default() };
        let engine = engine_with(pages.clone());
        let version = |name: &str, text: &str| Outcome { detail: Detail { version: Some(text.into()), app_name: Some(name.into()), ..Detail::default() }, ..up() };
        check(&engine, "mtestsite", version("Pages: Create Documents", "16.0"));
        engine.save(Monitor { app_id: "324684580".into(), ..pages }).unwrap();
        check(&engine, "mtestsite", version("Spotify: Music and Podcasts", "9.2.2"));
        assert!(kinds(&engine).is_empty(), "{:?}", kinds(&engine));
        // A later release of the new app is news again.
        check(&engine, "mtestsite", version("Spotify: Music and Podcasts", "9.2.3"));
        assert_eq!(kinds(&engine), vec!["news"]);
        assert_eq!(engine.lock().sent[0].title, "Spotify: Music and Podcasts 9.2.3 is live");
    }

    #[test]
    fn a_monitor_pointed_elsewhere_starts_over() {
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(state_of(&engine).0, State::Down);
        let moved = Monitor { url: "https://shop.example/health".into(), ..engine.lock().monitors[0].clone() };
        engine.save(moved).unwrap();
        let inner = engine.lock();
        let live = &inner.live["mtestsite"];
        assert_eq!((live.state, live.down_since, live.fails), (State::Unknown, None, 0));
        drop(inner);
        // No "back up" for the old address when the new one answers.
        check(&engine, "mtestsite", up());
        assert_eq!(kinds(&engine), vec!["down"]);
    }

    #[test]
    fn every_change_stamps_the_summary_newer() {
        let engine = engine_with(site(0));
        let stamp = |engine: &Arc<Engine>| engine.lock().live["mtestsite"].stamp;
        let start = stamp(&engine);
        check(&engine, "mtestsite", failed("status"));
        let after_check = stamp(&engine);
        assert!(after_check > start);
        engine.clear("mtestsite").unwrap();
        assert!(stamp(&engine) > after_check);
    }

    /// A check that started at `started` with the wall clock `slept` ms
    /// further ahead of the monotonic one than at `base`, then its answer.
    /// One reading of `skew()` for all the checks of a test, since two
    /// readings can be a millisecond apart.
    fn check_slept(engine: &Arc<Engine>, id: &str, outcome: Outcome, started: i64, base: i64, slept: i64) {
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            inner.live.get_mut(id).unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started, started_skew: base + slept });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.record(id, token, outcome);
    }

    /// An engine reading and writing files in a folder of its own, as after
    /// a start of the app.
    fn engine_on_disk(root: &std::path::Path) -> Arc<Engine> {
        let engine = Arc::new(Engine::default());
        let _ = engine.files.set(Files::new(root.to_path_buf()));
        engine.load();
        engine.lock().settings.desktop = false;
        engine
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("osg-uptime-{name}-{}", history::new_id('x')))
    }

    fn released(name: &str, version: &str) -> Outcome {
        Outcome { detail: Detail { version: Some(version.into()), app_name: Some(name.into()), ..Detail::default() }, ..up() }
    }

    #[test]
    fn an_hour_an_earlier_build_wrote_counts_for_nothing() {
        // The eighth audit: the 24 hour tile read 49.95% for an earlier
        // build's hour and 50.95% for the same checks measured to the ms.
        let root = scratch("earlier");
        let monitor = Monitor { id: "mearlier".into(), name: "Earlier".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let t = hour_of(now_ms()) - 3 * HOUR;
        let [seconds, rewritten] = history::earlier_hour_lines(t);
        std::fs::create_dir_all(root.join("mearlier")).unwrap();
        std::fs::write(root.join("mearlier").join("hours.jsonl"), format!("{seconds}\n")).unwrap();
        // An open hour left in live.json by an earlier build, too.
        std::fs::write(root.join("mearlier").join("live.json"), format!(r#"{{"open":[{}]}}"#, rewritten.replace(&format!("\"t\":{t}"), &format!("\"t\":{}", t + HOUR)))).unwrap();
        let engine = engine_on_disk(&root);
        let inner = engine.lock();
        let live = &inner.live["mearlier"];
        assert!(live.hours.is_empty(), "read: {:?}", live.hours.keys().collect::<Vec<_>>());
        assert_eq!(live.uptime_since(now_ms() - DAY), None);
        drop(inner);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_new_target_saved_while_paused_survives_a_force_quit() {
        // The third audit: Spotify paused, pointed at Pages, and the app
        // killed before Pages was checked. Pages' version isn't news.
        let root = scratch("forcequit");
        let spotify = Monitor { id: "mforcequit".into(), name: "App".into(), kind: Kind::Store, store: "apple".into(), app_id: "324684580".into(), ..Monitor::default() };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![spotify.clone()], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        check(&engine, "mforcequit", released("Spotify: Music and Podcasts", "9.2.2"));
        engine.pause("mforcequit", None).unwrap();
        let pages = Monitor { app_id: "361309726".into(), ..engine.lock().monitors[0].clone() };
        engine.save(pages).unwrap();
        assert_eq!(Files::new(root.clone()).load_live("mforcequit").map(|saved| saved.version), Some(None), "the edit wrote the state it reset");
        // Killed: no shutdown. The next start reads what is on disk.
        let restarted = engine_on_disk(&root);
        assert_eq!(restarted.lock().live["mforcequit"].version, None);
        restarted.resume("mforcequit").unwrap();
        check(&restarted, "mforcequit", released("Pages: Create Documents", "16.0"));
        assert!(kinds(&restarted).is_empty(), "{:?}", kinds(&restarted));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_state_saved_for_another_target_is_not_restored() {
        // However it got there: monitors.json says Pages, live.json is Spotify's.
        let root = scratch("othertarget");
        let spotify = Monitor { id: "mothertarget".into(), name: "App".into(), kind: Kind::Store, store: "apple".into(), app_id: "324684580".into(), ..Monitor::default() };
        let pages = Monitor { app_id: "361309726".into(), ..spotify.clone() };
        let files = Files::new(root.clone());
        files.save_config(&Config { version: 1, monitors: vec![pages], settings: Settings::default() }).unwrap();
        files.save_live("mothertarget", &Saved { state: State::Up, version: Some("9.2.2".into()), target: spotify.target_key(), ..Saved::default() }).unwrap();
        let engine = engine_on_disk(&root);
        let inner = engine.lock();
        let live = &inner.live["mothertarget"];
        assert_eq!((live.version.clone(), live.state), (None, State::Unknown));
        drop(inner);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A clear asked for on another thread, the way the page asks, while
    /// a check is being recorded here. `begin` starts it and gives it a
    /// moment; `finish` waits for it and says how many alerts had been sent
    /// when it was done.
    #[derive(Clone)]
    struct ClearFromElsewhere {
        engine: Arc<Engine>,
        id: String,
        thread: Arc<Mutex<Option<std::thread::JoinHandle<usize>>>>,
    }

    impl ClearFromElsewhere {
        fn begin(&self) {
            let engine = self.engine.clone();
            let id = self.id.clone();
            let thread = std::thread::spawn(move || {
                engine.clear(&id).unwrap();
                engine.lock().sent.len()
            });
            std::thread::sleep(Duration::from_millis(150));
            *self.thread.lock().unwrap() = Some(thread);
        }

        fn finish(&self) -> usize {
            let thread = self.thread.lock().unwrap().take().expect("the clear began");
            thread.join().unwrap()
        }
    }

    fn clear_from_elsewhere(engine: &Arc<Engine>, id: &str) -> ClearFromElsewhere {
        ClearFromElsewhere { engine: engine.clone(), id: id.into(), thread: Arc::new(Mutex::new(None)) }
    }

    #[test]
    fn no_alert_comes_after_a_clear() {
        // The fourth audit: Clear run after the check was written and before
        // its alerts went out. Clear returned, then the Down alert came.
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", up());
        let clear = clear_from_elsewhere(&engine, "mtestsite");
        let start = clear.clone();
        engine.lock().before_alerts = Some(Box::new(move || start.begin()));
        check(&engine, "mtestsite", failed("status"));
        let sent_when_cleared = clear.finish();
        assert_eq!(engine.lock().sent.len(), sent_when_cleared, "an alert came after the clear");
        assert_eq!(engine.lock().live["mtestsite"].state, State::Unknown);
    }

    #[test]
    fn a_check_counted_first_is_written_first() {
        // The fourth audit: a failed check held back before its write while
        // a later passing check finished. The later one must stand.
        let root = scratch("order");
        let monitor = Monitor { id: "morder".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        check(&engine, "morder", up());
        let other = engine.clone();
        let later: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
        let later_in_hook = later.clone();
        engine.lock().between = Some(Box::new(move || {
            let thread = std::thread::spawn(move || {
                check(&other, "morder", up());
            });
            std::thread::sleep(Duration::from_millis(150));
            *later_in_hook.lock().unwrap() = Some(thread);
        }));
        check(&engine, "morder", failed("status"));
        later.lock().unwrap().take().unwrap().join().unwrap();
        assert_eq!(engine.lock().live["morder"].state, State::Up);
        assert_eq!(Files::new(root.clone()).load_live("morder").map(|saved| saved.state), Some(State::Up));
        assert_eq!(kinds(&engine), vec!["down", "up"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shutdown_writes_the_newest_hours_last() {
        // The fifth audit: the periodic write held 20 s down, shutdown wrote
        // the final figure, and the older write landed last.
        let root = scratch("flushorder");
        let monitor = Monitor { id: "mflushorder".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        let t0 = hour_of(now_ms()) - 3 * HOUR + 60_000;
        check_at(&engine, "mflushorder", failed("status"), t0);
        check_at(&engine, "mflushorder", failed("status"), t0 + 20_000);
        let quitting = engine.clone();
        let quit: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
        let quit_in_hook = quit.clone();
        engine.lock().between_flush = Some(Box::new(move || {
            let thread = std::thread::spawn(move || {
                check_at(&quitting, "mflushorder", failed("status"), t0 + 40_000);
                quitting.shutdown();
            });
            std::thread::sleep(Duration::from_millis(150));
            *quit_in_hook.lock().unwrap() = Some(thread);
        }));
        engine.flush_hours(now_ms());
        quit.lock().unwrap().take().unwrap().join().unwrap();
        let restarted = engine_on_disk(&root);
        let down = restarted.lock().live["mflushorder"].hours.get(&hour_of(t0)).map(|bucket| bucket.down);
        assert!(down.is_some_and(|down| down >= 40_000), "after the restart: {down:?}");
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A webhook receiver on 127.0.0.1 that answers 200 and keeps the event
    /// of each alert in the order the requests arrived, with when.
    fn receiver() -> (String, Arc<Mutex<Vec<(String, Instant)>>>) {
        let (url, got) = receiver_by_monitor();
        let events: Arc<Mutex<Vec<(String, Instant)>>> = Arc::new(Mutex::new(Vec::new()));
        let copy = events.clone();
        std::thread::spawn(move || loop {
            let seen: Vec<(String, Instant)> = got.lock().unwrap().iter().map(|(event, _, at)| (event.clone(), *at)).collect();
            *copy.lock().unwrap() = seen;
            std::thread::sleep(Duration::from_millis(5));
        });
        (url, events)
    }

    /// As `receiver`, with the monitor each alert was about.
    fn receiver_by_monitor() -> (String, Arc<Mutex<Vec<(String, String, Instant)>>>) {
        receiver_holding(Duration::ZERO)
    }

    /// As `receiver_by_monitor`, holding its answer to the first request.
    fn receiver_holding(first: Duration) -> (String, Arc<Mutex<Vec<(String, String, Instant)>>>) {
        use std::io::{Read, Write};
        let answered = Arc::new(AtomicUsize::new(0));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/hook", listener.local_addr().unwrap());
        let got: Arc<Mutex<Vec<(String, String, Instant)>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = got.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let seen = seen.clone();
                let answered = answered.clone();
                std::thread::spawn(move || {
                    let mut data = Vec::new();
                    let mut chunk = [0u8; 4096];
                    loop {
                        let Ok(read) = stream.read(&mut chunk) else { return };
                        if read == 0 {
                            return;
                        }
                        data.extend_from_slice(&chunk[..read]);
                        let Some(split) = data.windows(4).position(|window| window == b"\r\n\r\n") else { continue };
                        let head = String::from_utf8_lossy(&data[..split]).to_ascii_lowercase();
                        let length = head.lines().find_map(|line| line.strip_prefix("content-length:").and_then(|value| value.trim().parse::<usize>().ok())).unwrap_or(0);
                        if data.len() < split + 4 + length {
                            continue;
                        }
                        let body: serde_json::Value = serde_json::from_slice(&data[split + 4..split + 4 + length]).unwrap_or_default();
                        let event = body.get("event").and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
                        let monitor = body.pointer("/monitor/id").and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
                        seen.lock().unwrap().push((event, monitor, Instant::now()));
                        if answered.fetch_add(1, Ordering::SeqCst) == 0 {
                            std::thread::sleep(first);
                        }
                        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
                        return;
                    }
                });
            }
        });
        (url, got)
    }

    /// Whether, within 2 s, the place's sender took everything off its
    /// queue and is still busy with it.
    fn taken_off_queue(engine: &Arc<Engine>, place: &str) -> bool {
        let until = Instant::now() + Duration::from_secs(2);
        loop {
            {
                let outbox = engine.outbox();
                if outbox.sending.contains(place) && outbox.queues.get(place).is_some_and(VecDeque::is_empty) {
                    return true;
                }
            }
            if Instant::now() >= until {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn hook_to(url: &str) -> Target {
        Target { id: "atesthook".into(), kind: "webhook".into(), name: "Test".into(), url: url.into(), enabled: true, down: true, up: true, cert: true, news: true, ..Target::default() }
    }

    /// The events received, once there are `count` of them or 5 s passed.
    fn received(got: &Arc<Mutex<Vec<(String, Instant)>>>, count: usize) -> Vec<String> {
        let until = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().len() < count && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        got.lock().unwrap().iter().map(|(event, _)| event.clone()).collect()
    }

    #[test]
    fn webhooks_arrive_in_the_order_the_alerts_were_sent() {
        // The fifth audit: the engine sent Down then Up, the receiver got Up, Down.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        // The first delivery, the Down, is slow to set off.
        engine.lock().delivery_delay = Some(Duration::from_millis(400));
        check(&engine, "mtestsite", failed("status"));
        check(&engine, "mtestsite", up());
        assert_eq!(received(&got, 2), vec!["down", "up"]);
    }

    #[test]
    fn no_webhook_arrives_after_a_clear() {
        // The fifth audit: a queued Down reached the receiver after Clear returned.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        engine.lock().delivery_delay = Some(Duration::from_millis(400));
        check(&engine, "mtestsite", failed("status"));
        // Cleared once the Down is off its queue, on its way to its request.
        assert!(taken_off_queue(&engine, "atesthook"), "the Down never left its queue");
        engine.clear("mtestsite").unwrap();
        let cleared = Instant::now();
        std::thread::sleep(Duration::from_millis(1200));
        let late: Vec<String> = got.lock().unwrap().iter().filter(|(_, at)| *at > cleared).map(|(event, _)| event.clone()).collect();
        assert!(late.is_empty(), "arrived after the clear: {late:?}");
    }

    #[test]
    fn every_change_to_the_list_makes_the_view_newer() {
        // The page keeps the newer of two views by this stamp, so a view
        // from before a delete can't bring the monitor back.
        let engine = engine_with(site(0));
        let other = Monitor { id: "mothersite".into(), name: "Other".into(), ..site(0) };
        engine.lock().monitors.push(other);
        engine.lock().live.insert("mothersite".into(), Live::fresh(Instant::now()));
        let mut last = engine.view().stamp;
        engine.reorder(&["mothersite".to_string(), "mtestsite".to_string()]).unwrap();
        assert!(engine.view().stamp > last, "reorder");
        last = engine.view().stamp;
        let settings = Settings { remind: 30, ..engine.lock().settings.clone() };
        engine.save_settings(settings).unwrap();
        assert!(engine.view().stamp > last, "settings");
        last = engine.view().stamp;
        engine.delete("mothersite").unwrap();
        assert!(engine.view().stamp > last, "delete");
    }

    #[test]
    fn a_destination_removed_hears_nothing_more() {
        // The sixth audit: the receiver held its answer to Down, Up waited
        // behind it, and the destination was removed. Up went out anyway.
        let (url, got) = receiver_holding(Duration::from_millis(800));
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        check(&engine, "mtestsite", failed("status"));
        let until = Instant::now() + Duration::from_secs(3);
        while got.lock().unwrap().is_empty() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        check(&engine, "mtestsite", up());
        let settings = Settings { targets: Vec::new(), ..engine.lock().settings.clone() };
        engine.save_settings(settings).unwrap();
        std::thread::sleep(Duration::from_millis(2000));
        let events: Vec<String> = got.lock().unwrap().iter().map(|(event, _, _)| event.clone()).collect();
        assert_eq!(events, vec!["down"]);
    }

    #[test]
    fn a_clear_stops_a_delivery_that_hasnt_set_off() {
        // The sixth audit: held before its request started, longer than a
        // clear waits, a Down still went out after Clear returned. One whose
        // request hasn't started when the monitor is cleared isn't sent.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        engine.lock().delivery_delay = Some(Duration::from_millis(600));
        check(&engine, "mtestsite", failed("status"));
        assert!(taken_off_queue(&engine, "atesthook"), "the Down never left its queue");
        engine.clear("mtestsite").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let events: Vec<String> = got.lock().unwrap().iter().map(|(event, _)| event.clone()).collect();
        assert!(events.is_empty(), "sent: {events:?}");
    }

    /// Runs `act` on another thread while a delivery is held where `hook`
    /// is, gives it 300 ms, and says when it returned.
    fn while_held(engine: &Arc<Engine>, place: fn(&mut Inner) -> &mut Option<Box<dyn FnOnce() + Send>>, act: impl FnOnce() + Send + 'static) -> Arc<Mutex<Option<(std::thread::JoinHandle<()>, Arc<Mutex<Option<Instant>>>)>>> {
        let slot: Arc<Mutex<Option<(std::thread::JoinHandle<()>, Arc<Mutex<Option<Instant>>>)>>> = Arc::new(Mutex::new(None));
        let slot_in_hook = slot.clone();
        *place(&mut engine.lock()) = Some(Box::new(move || {
            let done: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
            let done_in_thread = done.clone();
            let thread = std::thread::spawn(move || {
                act();
                *done_in_thread.lock().unwrap() = Some(Instant::now());
            });
            std::thread::sleep(Duration::from_millis(300));
            *slot_in_hook.lock().unwrap() = Some((thread, done));
        }));
        slot
    }

    /// When the act of `while_held` returned, once the hook has run.
    fn returned_at(slot: &Arc<Mutex<Option<(std::thread::JoinHandle<()>, Arc<Mutex<Option<Instant>>>)>>>) -> Instant {
        let until = Instant::now() + Duration::from_secs(5);
        while slot.lock().unwrap().is_none() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        let (thread, done) = slot.lock().unwrap().take().expect("the delivery reached the hook");
        thread.join().unwrap();
        let at = done.lock().unwrap().expect("returned");
        at
    }

    fn no_places(engine: &Arc<Engine>) -> impl FnOnce() + Send + 'static {
        let engine = engine.clone();
        move || {
            let settings = Settings { targets: Vec::new(), ..engine.lock().settings.clone() };
            engine.save_settings(settings).unwrap();
        }
    }

    #[test]
    fn a_place_removed_before_the_request_starts_gets_nothing() {
        // The seventh audit: the place was checked, the HTTP client held, the
        // place removed; then Down went to the old address.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        let held = while_held(&engine, |inner| &mut inner.at_client, no_places(&engine));
        check(&engine, "mtestsite", failed("status"));
        returned_at(&held);
        std::thread::sleep(Duration::from_millis(800));
        let sent: Vec<String> = got.lock().unwrap().iter().map(|(event, _)| event.clone()).collect();
        assert!(sent.is_empty(), "sent: {sent:?}");
    }

    #[test]
    fn a_clear_before_the_request_starts_sends_nothing() {
        // The seventh audit: the same hold, then Clear; Down went out after.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        let clearing = engine.clone();
        let held = while_held(&engine, |inner| &mut inner.at_client, move || clearing.clear("mtestsite").unwrap());
        check(&engine, "mtestsite", failed("status"));
        returned_at(&held);
        std::thread::sleep(Duration::from_millis(800));
        let sent: Vec<String> = got.lock().unwrap().iter().map(|(event, _)| event.clone()).collect();
        assert!(sent.is_empty(), "sent: {sent:?}");
    }

    #[test]
    fn a_removal_waits_for_a_request_already_started() {
        // Once a request has started it can't be called back: removing its
        // place waits for it, so nothing arrives after the removal returns.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        let held = while_held(&engine, |inner| &mut inner.before_request, no_places(&engine));
        check(&engine, "mtestsite", failed("status"));
        let removed = returned_at(&held);
        std::thread::sleep(Duration::from_millis(800));
        let late: Vec<String> = got.lock().unwrap().iter().filter(|(_, at)| *at > removed).map(|(event, _)| event.clone()).collect();
        assert!(late.is_empty(), "arrived after the removal returned: {late:?}");
    }

    #[test]
    fn a_clear_waits_for_a_request_already_started() {
        // Clear can't call back a request that has started: it waits for it.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        let clearing = engine.clone();
        let held = while_held(&engine, |inner| &mut inner.before_request, move || clearing.clear("mtestsite").unwrap());
        check(&engine, "mtestsite", failed("status"));
        let cleared = returned_at(&held);
        std::thread::sleep(Duration::from_millis(800));
        let all: Vec<(String, Instant)> = got.lock().unwrap().clone();
        assert_eq!(all.iter().map(|(event, _)| event.as_str()).collect::<Vec<_>>(), vec!["down"], "the started Down goes out");
        assert!(all.iter().all(|(_, at)| *at <= cleared), "arrived after the clear returned");
    }

    #[test]
    fn the_page_hears_of_a_removal_before_it_waits() {
        // The eighth audit: the page still showed a removed place while the
        // removal waited for a request under way, and a switch saved that
        // copy. The page hears of the change before the wait.
        let (url, _got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        let held = while_held(&engine, |inner| &mut inner.before_request, no_places(&engine));
        check(&engine, "mtestsite", failed("status"));
        let removed = returned_at(&held);
        let emits = engine.lock().emits.clone();
        assert!(emits.iter().any(|at| *at + Duration::from_millis(200) < removed), "the page heard only when the removal returned");
    }

    #[test]
    fn a_change_made_from_older_settings_is_refused() {
        // The ninth audit: two editor windows. One removed a place; the other,
        // still holding the settings from before, switched the Dock badge off
        // and saved that copy, and the removed place came back.
        let engine = engine_with(site(0));
        let first = Target { id: "afirstplace".into(), ..hook_to("http://127.0.0.1:9/first") };
        let second = Target { id: "asecondplace".into(), ..hook_to("http://127.0.0.1:9/second") };
        engine.lock().settings.targets = vec![first, second.clone()];
        let older = engine.lock().settings.clone();
        engine.save_settings(Settings { targets: vec![second.clone()], ..older.clone() }).unwrap();
        let late = engine.save_settings(Settings { badge: !older.badge, ..older.clone() });
        assert!(late.is_err(), "a change made from the older settings was saved");
        assert_eq!(engine.lock().settings.targets.iter().map(|target| target.id.as_str()).collect::<Vec<_>>(), vec!["asecondplace"]);
    }

    #[test]
    fn a_delivery_reaches_the_page_as_it_is_recorded() {
        // The ninth audit: the receiver got Down and it was recorded as sent,
        // but "Sent lately" stayed empty until something else sent a view.
        let (url, got) = receiver();
        let engine = engine_with(site(0));
        engine.lock().settings.targets = vec![hook_to(&url)];
        check(&engine, "mtestsite", up());
        check(&engine, "mtestsite", failed("status"));
        assert_eq!(received(&got, 1), vec!["down"]);
        let until = Instant::now() + Duration::from_secs(3);
        while engine.lock().deliveries.is_empty() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        let recorded = Instant::now();
        std::thread::sleep(Duration::from_millis(300));
        let emits = engine.lock().emits.clone();
        assert!(emits.iter().any(|at| *at + Duration::from_millis(50) >= recorded), "no view went to the page after the delivery was recorded");
    }

    #[test]
    fn a_clear_drops_the_webhooks_still_waiting() {
        // One place, two monitors: the first one's Down is on its way and
        // slow, the second one's waits behind it, then that monitor is cleared.
        let (url, got) = receiver_by_monitor();
        let engine = engine_with(site(0));
        {
            let mut inner = engine.lock();
            inner.settings.targets = vec![hook_to(&url)];
            inner.monitors.push(Monitor { id: "mother".into(), name: "Other".into(), ..site(0) });
            inner.live.insert("mother".into(), Live::fresh(Instant::now()));
        }
        check(&engine, "mtestsite", up());
        check(&engine, "mother", up());
        engine.lock().delivery_delay = Some(Duration::from_millis(400));
        check(&engine, "mtestsite", failed("status"));
        check(&engine, "mother", failed("status"));
        engine.clear("mother").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        let seen: Vec<(String, String)> = got.lock().unwrap().iter().map(|(event, monitor, _)| (event.clone(), monitor.clone())).collect();
        assert_eq!(seen, vec![("down".to_string(), "mtestsite".to_string())]);
    }

    #[test]
    fn the_last_dock_badge_set_is_the_newest() {
        // A count worked out before a recovery, set after the recovery's.
        let engine = engine_with(site(0));
        engine.lock().settings.badge = true;
        check(&engine, "mtestsite", up());
        let other = engine.clone();
        let later: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
        let later_in_hook = later.clone();
        engine.lock().before_badge_set = Some(Box::new(move || {
            let thread = std::thread::spawn(move || {
                check(&other, "mtestsite", up());
            });
            std::thread::sleep(Duration::from_millis(150));
            *later_in_hook.lock().unwrap() = Some(thread);
        }));
        check(&engine, "mtestsite", failed("status"));
        later.lock().unwrap().take().unwrap().join().unwrap();
        // Read once: a second lock in the message would wait on the first.
        let sets = engine.lock().badge_sets.clone();
        assert_eq!(sets.last().copied().flatten(), None, "{sets:?}");
    }

    #[test]
    fn the_dock_badge_follows_the_newest_state() {
        // The fifth audit: an older badge update that came after the recovery
        // left the Dock asking for 1, and a good check left it there.
        let engine = engine_with(site(0));
        engine.lock().settings.badge = true;
        check(&engine, "mtestsite", up());
        let other = engine.clone();
        let later: Arc<Mutex<Option<std::thread::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
        let later_in_hook = later.clone();
        engine.lock().before_badge = Some(Box::new(move || {
            let thread = std::thread::spawn(move || {
                check(&other, "mtestsite", up());
            });
            std::thread::sleep(Duration::from_millis(150));
            *later_in_hook.lock().unwrap() = Some(thread);
        }));
        check(&engine, "mtestsite", failed("status"));
        later.lock().unwrap().take().unwrap().join().unwrap();
        assert_eq!(engine.lock().live["mtestsite"].state, State::Up);
        assert_eq!(engine.lock().badge, None, "the Dock still shows a count");
        check(&engine, "mtestsite", up());
        assert_eq!(engine.lock().badge, None);
    }

    #[test]
    fn a_shutdown_waits_for_the_check_being_written() {
        // Shutdown on the main thread while a check is between being counted
        // and being written: it waits, and nothing is announced after it.
        let root = scratch("shutdownwait");
        let monitor = Monitor { id: "mshutwait".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        check(&engine, "mshutwait", up());
        let quitting = engine.clone();
        let quit: Arc<Mutex<Option<std::thread::JoinHandle<usize>>>> = Arc::new(Mutex::new(None));
        let quit_in_hook = quit.clone();
        engine.lock().between = Some(Box::new(move || {
            let thread = std::thread::spawn(move || {
                quitting.shutdown();
                quitting.lock().sent.len()
            });
            std::thread::sleep(Duration::from_millis(150));
            *quit_in_hook.lock().unwrap() = Some(thread);
        }));
        check(&engine, "mshutwait", failed("status"));
        let sent_at_quit = quit.lock().unwrap().take().unwrap().join().unwrap();
        assert_eq!(engine.lock().sent.len(), sent_at_quit, "an alert came after shutdown");
        assert_eq!(Files::new(root.clone()).load_live("mshutwait").map(|saved| saved.state), Some(State::Down));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_check_that_ends_after_shutdown_is_dropped() {
        // The fourth audit: a check still under way when the app quit, whose
        // answer came after shutdown wrote everything.
        let root = scratch("aftershutdown");
        let monitor = Monitor { id: "mshutdown".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        check(&engine, "mshutdown", up());
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            inner.live.get_mut("mshutdown").unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started: now_ms(), started_skew: skew() });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.shutdown();
        engine.record("mshutdown", token, failed("status"));
        assert_eq!(Files::new(root.clone()).load_live("mshutdown").map(|saved| saved.state), Some(State::Up));
        assert!(kinds(&engine).is_empty(), "{:?}", kinds(&engine));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_clear_wins_over_a_check_counted_just_before_it() {
        // The third audit: a check counted, then the history cleared before
        // the check was written. Nothing of that check may come back.
        let root = scratch("clearrace");
        let monitor = Monitor { id: "mclearrace".into(), ..site(0) };
        Files::new(root.clone()).save_config(&Config { version: 1, monitors: vec![monitor], settings: Settings::default() }).unwrap();
        let engine = engine_on_disk(&root);
        check(&engine, "mclearrace", up());
        let clear = clear_from_elsewhere(&engine, "mclearrace");
        let start = clear.clone();
        engine.lock().between = Some(Box::new(move || start.begin()));
        check(&engine, "mclearrace", failed("status"));
        let sent_when_cleared = clear.finish();
        let files = Files::new(root.clone());
        assert!(files.load_live("mclearrace").is_none(), "live.json came back: {:?}", files.load_live("mclearrace").map(|saved| saved.state));
        assert!(files.events("mclearrace", 10).is_empty(), "{:?}", files.events("mclearrace", 10).iter().map(|event| event.kind.clone()).collect::<Vec<_>>());
        assert!(files.beats("mclearrace", now_ms() - DAY, now_ms() + DAY).is_empty());
        assert_eq!(engine.lock().sent.len(), sent_when_cleared, "an alert came after the clear");
        assert_eq!(engine.lock().live["mclearrace"].state, State::Unknown);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_short_sleep_during_a_check_drops_it() {
        // The third audit: 20 s asleep while a check waited, and its timeout
        // with no retries. That says nothing about the site.
        let engine = engine_with(site(0));
        check(&engine, "mtestsite", up());
        let token = {
            let mut inner = engine.lock();
            inner.next_token += 1;
            let token = inner.next_token;
            inner.live.get_mut("mtestsite").unwrap().running = Some(Running { token, deadline: Instant::now() + Duration::from_secs(60), started: now_ms() - 30_000, started_skew: skew() - 20_000 });
            token
        };
        engine.running.fetch_add(1, Ordering::SeqCst);
        engine.record("mtestsite", token, failed("timeout"));
        let inner = engine.lock();
        let live = &inner.live["mtestsite"];
        assert_eq!((live.state, live.fails, live.recent.len()), (State::Up, 0, 1));
        assert!(inner.sent.is_empty());
    }

    #[test]
    fn an_app_store_answer_without_results_never_calls_the_app_down() {
        // The third audit: two answers of {"error":"maintenance"} with a 200.
        let monitor = Monitor { id: "mtestsite".into(), name: "Pages".into(), kind: Kind::Store, store: "apple".into(), app_id: "361309726".into(), retries: 1, ..Monitor::default() };
        let engine = engine_with(monitor);
        check(&engine, "mtestsite", up());
        let listing = engine.lock().monitors[0].clone();
        for _ in 0..2 {
            check(&engine, "mtestsite", checks::store_answer(&listing, 200, "itunes.apple.com", br#"{"error":"maintenance"}"#, Duration::from_millis(300)));
        }
        assert_eq!(state_of(&engine).0, State::Up);
        assert!(kinds(&engine).is_empty(), "{:?}", kinds(&engine));
    }

    #[test]
    fn checks_that_couldnt_tell_during_an_outage_were_still_watched() {
        // The third audit: eight checks that couldn't tell between two
        // failures, the app open all along. The "back up" alert mustn't say
        // the app was closed.
        let engine = engine_with(site(0));
        let unclear = || Outcome { ok: false, inconclusive: true, why: "error".into(), msg: "Google Play's page couldn't be read".into(), ..Outcome::default() };
        check(&engine, "mtestsite", up());
        check(&engine, "mtestsite", failed("status"));
        for _ in 0..8 {
            check(&engine, "mtestsite", unclear());
        }
        check(&engine, "mtestsite", failed("status"));
        check(&engine, "mtestsite", up());
        let inner = engine.lock();
        let back = inner.sent.iter().find(|alert| alert.kind == "up").expect("a back up alert");
        // Ten checks ten seconds apart, give or take the clock moving on
        // between them.
        assert!(back.down_for.is_some_and(|ms| (100_000..101_000).contains(&ms)), "{:?}", back.down_for);
        assert!(!back.body.contains("closed"), "{}", back.body);
    }

    #[test]
    fn a_listing_named_by_uptime_takes_the_store_name() {
        // The fourth audit: a generated name kept after the new app's check.
        let listing = Monitor { id: "mtestsite".into(), name: "324684580 on the App Store".into(), kind: Kind::Store, store: "apple".into(), app_id: "324684580".into(), auto_name: Some(true), ..Monitor::default() };
        let engine = engine_with(listing.clone());
        check(&engine, "mtestsite", released("Spotify: Music and Podcasts", "9.2.2"));
        assert_eq!(engine.lock().monitors[0].name, "Spotify: Music and Podcasts on the App Store");
        // A name the user gave stays.
        let named = engine_with(Monitor { name: "Music".into(), auto_name: Some(false), ..listing.clone() });
        check(&named, "mtestsite", released("Spotify: Music and Podcasts", "9.2.2"));
        assert_eq!(named.lock().monitors[0].name, "Music");
        // Saved before names were marked: the engine leaves it, the form decides.
        let older = engine_with(Monitor { name: "Pages: Create Documents on the App Store".into(), auto_name: None, ..listing });
        check(&older, "mtestsite", released("Spotify: Music and Podcasts", "9.2.2"));
        assert_eq!(older.lock().monitors[0].name, "Pages: Create Documents on the App Store");
    }

    #[test]
    fn a_short_sleep_between_checks_counts_for_nothing() {
        // Awake 60 s after a failed check, then asleep 20 s: too short to
        // read as a sleep on its own, and still not time anyone watched.
        let engine = engine_with(site(0));
        let t0 = hour_of(now_ms()) - 3 * HOUR;
        let base = engine.lock().live["mtestsite"].last_skew;
        check_slept(&engine, "mtestsite", failed("status"), t0, base, 0);
        check_slept(&engine, "mtestsite", failed("status"), t0 + 80_000, base, 20_000);
        assert_eq!(total(&engine, "mtestsite"), (0, 60_000));
    }
}
