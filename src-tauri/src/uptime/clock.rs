//! Dates without a date library: milliseconds since 1970 to and from the
//! calendar, in UTC. The history's file names and hour boundaries are UTC, so
//! a change of time zone or summer time never moves a check to another file.
//! The page draws days in the user's own time zone from the hourly totals.

use std::time::{SystemTime, UNIX_EPOCH};

pub const SECOND: i64 = 1000;
pub const MINUTE: i64 = 60 * SECOND;
pub const HOUR: i64 = 60 * MINUTE;
pub const DAY: i64 = 24 * HOUR;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn hour_of(t: i64) -> i64 {
    t.div_euclid(HOUR) * HOUR
}

pub fn day_of(t: i64) -> i64 {
    t.div_euclid(DAY) * DAY
}

/// Days since 1970-01-01 for a date (Howard Hinnant's days_from_civil).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month = month as i64;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day as i64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The date of a day since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

/// 2026-11-26 for a time on that UTC day.
pub fn day_key(t: i64) -> String {
    let (year, month, day) = civil_from_days(t.div_euclid(DAY));
    format!("{year:04}-{month:02}-{day:02}")
}

/// The UTC day a key names, as ms since 1970.
pub fn parse_day_key(key: &str) -> Option<i64> {
    let mut parts = key.split('-');
    let year = parts.next()?.parse::<i64>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(days_from_civil(year, month, day) * DAY)
}

/// ISO 8601 in UTC, for webhook bodies.
pub fn iso(t: i64) -> String {
    let (year, month, day) = civil_from_days(t.div_euclid(DAY));
    let in_day = t.rem_euclid(DAY) / 1000;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", in_day / 3600, in_day / 60 % 60, in_day % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_round_trip() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_418), (2025, 11, 26));
        for days in (-800_000..800_000).step_by(997) {
            let (year, month, day) = civil_from_days(days);
            assert_eq!(days_from_civil(year, month, day), days);
        }
    }

    #[test]
    fn keys_and_iso_read_in_utc() {
        let t = days_from_civil(2026, 11, 26) * DAY + 13 * HOUR + 5 * MINUTE + 9 * SECOND + 250;
        assert_eq!(day_key(t), "2026-11-26");
        assert_eq!(parse_day_key("2026-11-26"), Some(days_from_civil(2026, 11, 26) * DAY));
        assert_eq!(parse_day_key("2026-13-01"), None);
        assert_eq!(iso(t), "2026-11-26T13:05:09Z");
        assert_eq!(hour_of(t), days_from_civil(2026, 11, 26) * DAY + 13 * HOUR);
        assert_eq!(day_of(t), days_from_civil(2026, 11, 26) * DAY);
    }
}
