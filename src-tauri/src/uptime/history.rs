//! Where Uptime keeps things, all under the app's data folder in `uptime/`:
//!
//! - `monitors.json`: the monitors and the alert settings, written whole
//!   through a new temporary file and a rename, with the copy before it kept
//!   as `monitors.json.bak` in case the new one can't be read.
//! - `<monitor id>/beats-<UTC day>.jsonl`: one line per check, kept 30 days.
//! - `<monitor id>/hours.jsonl`: the hourly totals, appended as they change,
//!   the last line for an hour winning, kept 400 days.
//! - `<monitor id>/events.jsonl`: the changes (down, up, paused...), 400 days.
//! - `<monitor id>/live.json`: where the monitor stood at the last check, so
//!   the app opens where it left off.
//!
//! Lines are appended, so a crash can leave at most one broken line at the
//! end of a file, and every reader skips a line it can't parse.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::clock::{day_key, day_of, parse_day_key, DAY};
use super::model::{Beat, Bucket, Config, Detail, Event, State};

pub const KEEP_BEATS: i64 = 30 * DAY;
pub const KEEP_HOURS: i64 = 400 * DAY;
pub const KEEP_EVENTS: i64 = 400 * DAY;

/// Where a monitor stood, saved after every check.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    pub state: State,
    pub since: Option<i64>,
    pub fails: u32,
    pub first_fail: Option<i64>,
    pub last: Option<Beat>,
    pub detail: Detail,
    pub cert_warned: Option<u32>,
    pub version: Option<String>,
    pub last_alert: i64,
    pub down_since: Option<i64>,
    pub down_seen: i64,
    pub down_why: String,
    pub down_msg: String,
    /// Hours changed since they were last appended to hours.jsonl.
    pub open: Vec<Bucket>,
    /// `Monitor::target_key` of what was checked. 0 in a state saved before
    /// it was kept.
    pub target: u64,
}

/// A monitor id is made here (`new_id`) and only ever used as a folder name
/// after this check, so a page can't point a read or a delete elsewhere.
pub fn valid_id(id: &str) -> bool {
    (4..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

pub fn new_id(prefix: char) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    let mixed = nanos ^ (COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9E37_79B9_7F4A_7C15)) ^ ((std::process::id() as u64) << 40);
    format!("{prefix}{}", base36(mixed))
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
        if value == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

pub struct Files {
    root: PathBuf,
}

/// Writes a file whole: a new temporary file beside it (create_new, so a
/// link planted at that name is never followed), flushed to disk, then
/// renamed over the old one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| io::Error::other("no folder"))?;
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("file");
    let temporary = dir.join(format!(".{name}.{}.tmp", new_id('t')));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn append_line<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut line = serde_json::to_vec(value).map_err(io::Error::other)?;
    line.push(b'\n');
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(&line)
}

fn read_lines<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    let Ok(file) = File::open(path) else { return Vec::new() };
    BufReader::new(file).lines().map_while(Result::ok).filter_map(|line| serde_json::from_str(&line).ok()).collect()
}

impl Files {
    pub fn new(root: PathBuf) -> Files {
        Files { root }
    }

    fn dir(&self, id: &str) -> Option<PathBuf> {
        valid_id(id).then(|| self.root.join(id))
    }

    fn config_path(&self) -> PathBuf {
        self.root.join("monitors.json")
    }

    /// monitors.json, or its last good copy, or nothing yet.
    pub fn load_config(&self) -> Config {
        let path = self.config_path();
        for candidate in [path.clone(), path.with_extension("json.bak")] {
            if let Ok(text) = fs::read_to_string(&candidate) {
                match serde_json::from_str::<Config>(&text) {
                    Ok(config) => return config,
                    Err(error) => eprintln!("uptime: {} couldn't be read: {error}", candidate.display()),
                }
            }
        }
        Config::default()
    }

    pub fn save_config(&self, config: &Config) -> io::Result<()> {
        let path = self.config_path();
        let bytes = serde_json::to_vec_pretty(config).map_err(io::Error::other)?;
        if path.exists() {
            // The copy is a convenience; a failure to make it never stops a save.
            let _ = fs::copy(&path, path.with_extension("json.bak"));
        }
        write_atomic(&path, &bytes)
    }

    pub fn append_beat(&self, id: &str, beat: &Beat) -> io::Result<()> {
        let dir = self.dir(id).ok_or_else(|| io::Error::other("bad id"))?;
        append_line(&dir.join(format!("beats-{}.jsonl", day_key(beat.t))), beat)
    }

    /// The checks from `from` to `to`, oldest first.
    pub fn beats(&self, id: &str, from: i64, to: i64) -> Vec<Beat> {
        let Some(dir) = self.dir(id) else { return Vec::new() };
        let mut beats = Vec::new();
        let mut day = day_of(from);
        while day <= to {
            let lines: Vec<Beat> = read_lines(&dir.join(format!("beats-{}.jsonl", day_key(day))));
            beats.extend(lines.into_iter().filter(|beat| beat.t >= from && beat.t < to));
            day += DAY;
        }
        beats.sort_by_key(|beat| beat.t);
        beats
    }

    /// The last `count` checks, from the newest day's file back, however
    /// long ago that day was (the app may have been closed for a week).
    pub fn recent(&self, id: &str, count: usize, now: i64) -> Vec<Beat> {
        let Some(dir) = self.dir(id) else { return Vec::new() };
        let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
        let mut days: Vec<i64> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                parse_day_key(name.strip_prefix("beats-")?.strip_suffix(".jsonl")?)
            })
            .filter(|day| *day <= now)
            .collect();
        days.sort_unstable_by(|a, b| b.cmp(a));
        let mut found: Vec<Beat> = Vec::new();
        for day in days {
            if found.len() >= count {
                break;
            }
            let mut lines: Vec<Beat> = read_lines(&dir.join(format!("beats-{}.jsonl", day_key(day))));
            lines.sort_by_key(|beat| beat.t);
            lines.append(&mut found);
            found = lines;
        }
        let skip = found.len().saturating_sub(count);
        found.split_off(skip)
    }

    pub fn append_event(&self, id: &str, event: &Event) -> io::Result<()> {
        let dir = self.dir(id).ok_or_else(|| io::Error::other("bad id"))?;
        append_line(&dir.join("events.jsonl"), event)
    }

    /// The newest `limit` events, newest first.
    pub fn events(&self, id: &str, limit: usize) -> Vec<Event> {
        let Some(dir) = self.dir(id) else { return Vec::new() };
        let mut events: Vec<Event> = read_lines(&dir.join("events.jsonl"));
        events.sort_by_key(|event| event.t);
        events.into_iter().rev().take(limit).collect()
    }

    pub fn append_hours(&self, id: &str, buckets: &[Bucket]) -> io::Result<()> {
        let dir = self.dir(id).ok_or_else(|| io::Error::other("bad id"))?;
        let path = dir.join("hours.jsonl");
        fs::create_dir_all(&dir)?;
        let mut text = Vec::new();
        for bucket in buckets {
            text.extend(serde_json::to_vec(bucket).map_err(io::Error::other)?);
            text.push(b'\n');
        }
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        file.write_all(&text)
    }

    /// The hours from `from` to `to`, the last line for an hour winning.
    /// Hours an earlier test build wrote are left out (`Bucket::is_current`),
    /// and `prune` drops them from the file.
    pub fn hours(&self, id: &str, from: i64, to: i64) -> BTreeMap<i64, Bucket> {
        let Some(dir) = self.dir(id) else { return BTreeMap::new() };
        let mut hours = BTreeMap::new();
        for bucket in read_lines::<Bucket>(&dir.join("hours.jsonl")) {
            if bucket.is_current() && bucket.t >= from && bucket.t < to {
                hours.insert(bucket.t, bucket);
            }
        }
        hours
    }

    pub fn save_live(&self, id: &str, saved: &Saved) -> io::Result<()> {
        let dir = self.dir(id).ok_or_else(|| io::Error::other("bad id"))?;
        write_atomic(&dir.join("live.json"), &serde_json::to_vec(saved).map_err(io::Error::other)?)
    }

    pub fn load_live(&self, id: &str) -> Option<Saved> {
        let dir = self.dir(id)?;
        serde_json::from_str(&fs::read_to_string(dir.join("live.json")).ok()?).ok()
    }

    /// Drops what is older than it is kept for, and rewrites hours.jsonl with
    /// one line per hour.
    pub fn prune(&self, id: &str, now: i64) {
        let Some(dir) = self.dir(id) else { return };
        let Ok(entries) = fs::read_dir(&dir) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(key) = name.strip_prefix("beats-").and_then(|rest| rest.strip_suffix(".jsonl")) else { continue };
            if parse_day_key(key).is_some_and(|day| day < now - KEEP_BEATS) {
                let _ = fs::remove_file(entry.path());
            }
        }
        let hours = self.hours(id, now - KEEP_HOURS, i64::MAX);
        let mut text = Vec::new();
        for bucket in hours.values() {
            if let Ok(line) = serde_json::to_vec(bucket) {
                text.extend(line);
                text.push(b'\n');
            }
        }
        if dir.join("hours.jsonl").exists() {
            let _ = write_atomic(&dir.join("hours.jsonl"), &text);
        }
        let events: Vec<Event> = read_lines(&dir.join("events.jsonl"));
        if events.iter().any(|event| event.t < now - KEEP_EVENTS) {
            let mut text = Vec::new();
            for event in events.iter().filter(|event| event.t >= now - KEEP_EVENTS) {
                if let Ok(line) = serde_json::to_vec(event) {
                    text.extend(line);
                    text.push(b'\n');
                }
            }
            let _ = write_atomic(&dir.join("events.jsonl"), &text);
        }
    }

    /// Everything a monitor has, for "Delete" and "Clear the history".
    pub fn remove(&self, id: &str) {
        if let Some(dir) = self.dir(id) {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

/// The eighth audit's hour, as two earlier builds wrote it: 87 cycles of
/// 20.9 s up and 20.1 s down kept in whole seconds, and the same hour
/// rewritten with those seconds as ms and 10 s more up.
#[cfg(test)]
pub(crate) fn earlier_hour_lines(t: i64) -> [String; 2] {
    let segs: Vec<String> = (0..87).flat_map(|i| [format!("[{},{},0]", 41 * i, 41 * i + 20), format!("[{},{},1]", 41 * i + 20, 41 * i + 41)]).collect();
    let mut spans: Vec<String> = (0..87).flat_map(|i| [format!("[{},{},0]", 41_000 * i, 41_000 * i + 20_000), format!("[{},{},1]", 41_000 * i + 20_000, 41_000 * i + 41_000)]).collect();
    spans.push("[3570000,3580000,0]".into());
    [
        format!(r#"{{"t":{t},"up":1818300,"down":1748700,"n":174,"segs":[{}]}}"#, segs.join(",")),
        format!(r#"{{"t":{t},"up":1828300,"down":1748700,"n":174,"fails":0,"sum":0,"cnt":0,"min":0,"max":0,"spans":[{}],"until":3580000}}"#, spans.join(",")),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::uptime::model::BeatStatus;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osg-uptime-test-{}", new_id('x')));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn beat(t: i64, s: BeatStatus) -> Beat {
        Beat { t, s, ms: Some(10), code: None, why: String::new(), msg: String::new(), slow: false }
    }

    #[test]
    fn ids_are_safe_folder_names() {
        for _ in 0..100 {
            let id = new_id('m');
            assert!(valid_id(&id), "{id}");
        }
        assert!(!valid_id("../etc"));
        assert!(!valid_id("abc"));
        assert!(!valid_id("ABCDEF"));
        assert_ne!(new_id('m'), new_id('m'));
    }

    #[test]
    fn beats_are_kept_per_day_and_read_back_in_order() {
        let root = scratch();
        let files = Files::new(root.clone());
        let day = 20_000 * DAY;
        for t in [day - 1000, day + 5, day + 10, day + DAY + 1] {
            files.append_beat("mtest1", &beat(t, BeatStatus::Up)).unwrap();
        }
        assert_eq!(files.beats("mtest1", day, day + DAY).len(), 2);
        assert_eq!(files.beats("mtest1", day - DAY, day + 2 * DAY).len(), 4);
        let recent = files.recent("mtest1", 3, day + DAY + 100);
        assert_eq!(recent.iter().map(|b| b.t).collect::<Vec<_>>(), vec![day + 5, day + 10, day + DAY + 1]);
        // A broken last line is skipped.
        let path = root.join("mtest1").join(format!("beats-{}.jsonl", day_key(day)));
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"{\"t\":12,\"s\":").unwrap();
        assert_eq!(files.beats("mtest1", day, day + DAY).len(), 2);
        // A bad id reads and writes nothing.
        assert!(files.append_beat("../x", &beat(day, BeatStatus::Up)).is_err());
        assert!(files.beats("../x", 0, i64::MAX).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hours_an_earlier_build_wrote_are_left_out() {
        // The eighth audit: an earlier build's hour read 49.95% where the same
        // checks measured to the ms read 50.95%. Where its seconds fell can't
        // be known, so it counts for nothing rather than as a guess.
        let root = scratch();
        let files = Files::new(root.clone());
        let t = 20_500 * DAY;
        let mut measured = Bucket { t, ..Bucket::default() };
        measured.add_span(t + 100_000, t + 110_000, true);
        files.append_hours("mtest3", &[measured.clone()]).unwrap();
        // Written after it, so it would win as the last line for the hour.
        let mut file = OpenOptions::new().append(true).open(root.join("mtest3").join("hours.jsonl")).unwrap();
        for line in earlier_hour_lines(t).iter().chain(earlier_hour_lines(t + 3_600_000).iter()) {
            writeln!(file, "{line}").unwrap();
        }
        let hours = files.hours("mtest3", 0, i64::MAX);
        assert_eq!(hours.keys().copied().collect::<Vec<_>>(), vec![t], "an earlier build's hour was read");
        assert_eq!(hours[&t], measured);
        files.prune("mtest3", t + DAY);
        let text = fs::read_to_string(root.join("mtest3").join("hours.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hours_take_the_last_line_and_pruning_drops_old_files() {
        let root = scratch();
        let files = Files::new(root.clone());
        let now = 20_500 * DAY;
        files.append_hours("mtest2", &[Bucket { t: now - 3600_000, up: 1, ..Bucket::default() }]).unwrap();
        files.append_hours("mtest2", &[Bucket { t: now - 3600_000, up: 2, ..Bucket::default() }, Bucket { t: now - 500 * DAY, up: 9, ..Bucket::default() }]).unwrap();
        let hours = files.hours("mtest2", 0, i64::MAX);
        assert_eq!(hours.len(), 2);
        assert_eq!(hours[&(now - 3600_000)].up, 2);
        files.append_beat("mtest2", &beat(now - 40 * DAY, BeatStatus::Down)).unwrap();
        files.append_beat("mtest2", &beat(now - DAY, BeatStatus::Down)).unwrap();
        files.prune("mtest2", now);
        assert!(files.beats("mtest2", now - 41 * DAY, now - 39 * DAY).is_empty());
        assert_eq!(files.beats("mtest2", now - 2 * DAY, now).len(), 1);
        let hours = files.hours("mtest2", 0, i64::MAX);
        assert_eq!(hours.len(), 1);
        let text = fs::read_to_string(root.join("mtest2").join("hours.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_config_falls_back_to_its_last_good_copy() {
        let root = scratch();
        let files = Files::new(root.clone());
        let mut config = Config::default();
        config.monitors.push(crate::uptime::model::Monitor { id: "mfirst".into(), name: "First".into(), ..Default::default() });
        files.save_config(&config).unwrap();
        config.monitors.push(crate::uptime::model::Monitor { id: "msecond".into(), name: "Second".into(), ..Default::default() });
        files.save_config(&config).unwrap();
        assert_eq!(files.load_config().monitors.len(), 2);
        fs::write(root.join("monitors.json"), b"{ broken").unwrap();
        assert_eq!(files.load_config().monitors.len(), 1);
        // No temporary files are left behind.
        let leftovers: Vec<_> = fs::read_dir(&root).unwrap().flatten().filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn events_come_back_newest_first() {
        let root = scratch();
        let files = Files::new(root.clone());
        for (t, kind) in [(1, "down"), (2, "up"), (3, "paused")] {
            files.append_event("mtest3", &Event { t, kind: kind.into(), msg: String::new(), why: String::new(), dur: None, seen: None, code: None }).unwrap();
        }
        let events = files.events("mtest3", 2);
        assert_eq!(events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "up"]);
        files.remove("mtest3");
        assert!(files.events("mtest3", 10).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_last_checks_are_found_after_days_without_any() {
        // The app was closed for five days: the newest checks are that old.
        let root = scratch();
        let files = Files::new(root.clone());
        let now = 20_600 * DAY + 12 * 3_600_000;
        for index in 0..100 {
            files.append_beat("mtest4", &beat(now - 5 * DAY + index * 60_000, BeatStatus::Up)).unwrap();
        }
        assert_eq!(files.recent("mtest4", 100, now).len(), 100);
        fs::remove_dir_all(root).unwrap();
    }
}
