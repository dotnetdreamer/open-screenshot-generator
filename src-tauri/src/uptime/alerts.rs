//! Alerts: this computer's own notification, a line for the page's toast,
//! and the places the user added (Slack, Discord, Telegram, ntfy or an
//! address of their own). Each place gets a plain JSON post; nothing here
//! needs an account with us.
//!
//! macOS notifications go through UNUserNotificationCenter, called by name
//! through the Objective-C runtime the app already links, so no library is
//! added for them. macOS only shows notifications for an app that runs from
//! its .app bundle, so the development build, a bare program, has none; the
//! page's toast still shows. A small delegate (`Presenter`) has macOS show
//! them while the app is in front too. Windows and Linux notifications come from the
//! page (src/lib/uptime/alerts.ts), whose web view has its own.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri_plugin_http::reqwest::Client;

use super::clock::iso;
use super::model::Target;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// The monitor's id, "" for a test.
    pub id: String,
    pub name: String,
    /// down, up, cert, news, reminder or test.
    pub kind: String,
    pub title: String,
    pub body: String,
    pub target: String,
    pub at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub down_for: Option<i64>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub why: String,
}

impl Alert {
    pub fn wanted_by(&self, target: &Target) -> bool {
        target.enabled
            && match self.kind.as_str() {
                "down" | "reminder" => target.down,
                "up" => target.up,
                "cert" => target.cert,
                "news" => target.news,
                "test" => true,
                _ => false,
            }
    }
}

/// One attempt to send an alert somewhere, for the Alerts screen.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub at: i64,
    pub target: String,
    pub name: String,
    pub ok: bool,
    pub note: String,
    pub title: String,
}

fn body_for(target: &Target, alert: &Alert) -> (String, Value) {
    match target.kind.as_str() {
        "slack" => (target.url.clone(), json!({ "text": format!("*{}*\n{}", alert.title, alert.body) })),
        "discord" => (target.url.clone(), json!({ "content": format!("**{}**\n{}", alert.title, alert.body), "username": "Uptime" })),
        "telegram" => (
            format!("https://api.telegram.org/bot{}/sendMessage", target.token),
            json!({ "chat_id": target.chat, "text": format!("{}\n{}", alert.title, alert.body), "disable_web_page_preview": true }),
        ),
        "ntfy" => {
            let (tag, priority) = match alert.kind.as_str() {
                "down" | "reminder" => ("rotating_light", 5),
                "up" => ("white_check_mark", 3),
                "cert" => ("warning", 4),
                _ => ("information_source", 3),
            };
            (
                target.url.trim_end_matches('/').to_string(),
                json!({ "topic": target.topic, "title": alert.title, "message": alert.body, "tags": [tag], "priority": priority }),
            )
        }
        _ => (
            target.url.clone(),
            json!({
                "event": alert.kind,
                "title": alert.title,
                "message": alert.body,
                "monitor": { "id": alert.id, "name": alert.name, "target": alert.target },
                "time": iso(alert.at),
                "downForSeconds": alert.down_for.map(|ms| ms / 1000),
                "reason": alert.why,
            }),
        ),
    }
}

/// Sends one alert to one place. The answer is a line for the Alerts
/// screen. A failed send never names the address, which for Telegram holds
/// the bot's token.
pub async fn deliver(client: &Client, target: &Target, alert: &Alert) -> Result<String, String> {
    let (url, body) = body_for(target, alert);
    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(serde_json::to_vec(&body).unwrap_or_default())
        .timeout(Duration::from_secs(15));
    if target.kind == "ntfy" && !target.token.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", target.token));
    }
    let response = request.send().await.map_err(|error| {
        let error = error.without_url();
        if error.is_timeout() {
            "No answer within 15 seconds".to_string()
        } else if error.is_connect() {
            "Couldn't connect".to_string()
        } else {
            "Couldn't send".to_string()
        }
    })?;
    let status = response.status();
    if status.is_success() {
        Ok("Sent".into())
    } else {
        Err(format!("Answered {}", status.as_u16()))
    }
}

#[cfg(target_os = "macos")]
pub mod native {
    use std::ffi::CStr;
    use std::panic::AssertUnwindSafe;
    use std::sync::{Once, OnceLock};

    use block2::{Block, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject};
    use objc2::{define_class, msg_send, ClassType};
    use objc2_foundation::NSString;

    #[link(name = "UserNotifications", kind = "framework")]
    extern "C" {}

    /// What macOS may do with a notification while the app is in front: the
    /// sound, the banner and a place in Notification Center's list. Banner and
    /// list (1 << 4, 1 << 3) are macOS 11's names for the older alert option
    /// (1 << 2), which macOS 10.15 reads.
    const IN_FRONT: usize = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and Presenter
        // doesn't implement Drop.
        #[unsafe(super(NSObject))]
        #[name = "OSGUptimeNotificationPresenter"]
        struct Presenter;

        impl Presenter {
            // SAFETY: the types match UNUserNotificationCenterDelegate's
            // method: the center, the notification, and a block that takes
            // the options as an NSUInteger.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(&self, _center: &AnyObject, _notification: &AnyObject, handler: &Block<dyn Fn(usize)>) {
                handler.call((IN_FRONT,));
            }
        }
    );

    /// Without a delegate, macOS keeps a notification out of sight while its
    /// app is in front, so the test pressed on the Alerts page, in the app,
    /// never showed (found live, 2026-11-28), and neither did alerts while
    /// someone worked in the editor. The center holds its delegate weakly, so
    /// the one Presenter is kept for the app's life.
    fn present_in_front(center: &AnyObject) {
        static SET: Once = Once::new();
        SET.call_once(|| {
            // SAFETY: +new on an NSObject subclass returns a retained object,
            // and setDelegate: takes an object.
            unsafe {
                let presenter: Retained<Presenter> = msg_send![Presenter::class(), new];
                let _: () = msg_send![center, setDelegate: &*presenter];
                std::mem::forget(presenter);
            }
        });
    }

    /// The options Presenter hands macOS, read by calling its method the way
    /// the center does.
    #[cfg(test)]
    pub(crate) fn options_in_front() -> (bool, Option<usize>) {
        use objc2::sel;
        use std::cell::Cell;
        use std::rc::Rc;
        let seen = Rc::new(Cell::new(None));
        let record = Rc::clone(&seen);
        let handler = RcBlock::new(move |options: usize| record.set(Some(options)));
        // SAFETY: +new returns retained objects, respondsToSelector: takes a
        // selector, and the delegate method takes two objects and a block.
        let answers = unsafe {
            let presenter: Retained<Presenter> = msg_send![Presenter::class(), new];
            let center = NSObject::new();
            let notification = NSObject::new();
            let answers: Bool = msg_send![&*presenter, respondsToSelector: sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:)];
            let _: () = msg_send![&*presenter, userNotificationCenter: &*center, willPresentNotification: &*notification, withCompletionHandler: &*handler];
            answers
        };
        (answers.as_bool(), seen.get())
    }

    fn class(name: &CStr) -> Option<&'static AnyClass> {
        AnyClass::get(name)
    }

    /// Whether this copy of the app runs from a bundle with an identifier,
    /// which UNUserNotificationCenter needs. Asking without one throws.
    pub fn available() -> bool {
        static AVAILABLE: OnceLock<bool> = OnceLock::new();
        *AVAILABLE.get_or_init(|| {
            objc2::exception::catch(AssertUnwindSafe(|| -> bool {
                let Some(bundle_class) = class(c"NSBundle") else { return false };
                // SAFETY: +[NSBundle mainBundle] takes nothing and returns an object.
                let bundle: Option<Retained<AnyObject>> = unsafe { msg_send![bundle_class, mainBundle] };
                let Some(bundle) = bundle else { return false };
                // SAFETY: both are NSString properties of NSBundle.
                let identifier: Option<Retained<NSString>> = unsafe { msg_send![&*bundle, bundleIdentifier] };
                let path: Option<Retained<NSString>> = unsafe { msg_send![&*bundle, bundlePath] };
                identifier.is_some() && path.is_some_and(|path| path.to_string().ends_with(".app")) && class(c"UNUserNotificationCenter").is_some()
            }))
            .unwrap_or(false)
        })
    }

    fn center() -> Option<Retained<AnyObject>> {
        let center_class = class(c"UNUserNotificationCenter")?;
        // SAFETY: +currentNotificationCenter takes nothing; `available` made
        // sure the app has the bundle it needs.
        unsafe { msg_send![center_class, currentNotificationCenter] }
    }

    /// Asks once for permission to show alerts with a sound. macOS shows its
    /// question the first time only.
    pub fn ask() {
        if !available() {
            return;
        }
        let _ = objc2::exception::catch(AssertUnwindSafe(|| {
            let Some(center) = center() else { return };
            present_in_front(&center);
            let block = RcBlock::new(|_granted: Bool, _error: *mut AnyObject| {});
            // UNAuthorizationOptionSound | UNAuthorizationOptionAlert.
            let options: usize = (1 << 1) | (1 << 2);
            // SAFETY: the options are an NSUInteger and the block matches
            // void (^)(BOOL, NSError *); the center copies the block.
            unsafe {
                let _: () = msg_send![&*center, requestAuthorizationWithOptions: options, completionHandler: &*block];
            }
        }));
    }

    pub fn show(title: &str, body: &str, sound: bool, id: &str) -> bool {
        if !available() {
            return false;
        }
        objc2::exception::catch(AssertUnwindSafe(|| -> bool {
            let Some(center) = center() else { return false };
            present_in_front(&center);
            let (Some(content_class), Some(request_class)) = (class(c"UNMutableNotificationContent"), class(c"UNNotificationRequest")) else {
                return false;
            };
            // SAFETY: each message below is one UserNotifications documents,
            // with an object or nil for each object argument.
            unsafe {
                let content: Retained<AnyObject> = msg_send![content_class, new];
                let _: () = msg_send![&*content, setTitle: &*NSString::from_str(title)];
                let _: () = msg_send![&*content, setBody: &*NSString::from_str(body)];
                if sound {
                    if let Some(sound_class) = class(c"UNNotificationSound") {
                        let chime: Option<Retained<AnyObject>> = msg_send![sound_class, defaultSound];
                        if let Some(chime) = chime {
                            let _: () = msg_send![&*content, setSound: &*chime];
                        }
                    }
                }
                let request: Option<Retained<AnyObject>> = msg_send![
                    request_class,
                    requestWithIdentifier: &*NSString::from_str(id),
                    content: &*content,
                    trigger: std::ptr::null::<AnyObject>()
                ];
                let Some(request) = request else { return false };
                let _: () = msg_send![&*center, addNotificationRequest: &*request, withCompletionHandler: std::ptr::null::<block2::Block<dyn Fn(*mut AnyObject)>>()];
            }
            true
        }))
        .unwrap_or(false)
    }
}

#[cfg(not(target_os = "macos"))]
pub mod native {
    pub fn available() -> bool {
        false
    }

    pub fn ask() {}

    pub fn show(_title: &str, _body: &str, _sound: bool, _id: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alert(kind: &str) -> Alert {
        Alert {
            id: "m1".into(),
            name: "Shop".into(),
            kind: kind.into(),
            title: "Shop is down".into(),
            body: "No answer within 10 seconds".into(),
            target: "https://shop.example".into(),
            at: 0,
            down_for: Some(90_000),
            why: "timeout".into(),
        }
    }

    #[test]
    fn each_place_gets_its_own_body() {
        let slack = Target { kind: "slack".into(), url: "https://hooks.slack.com/x".into(), ..Target::default() };
        assert_eq!(body_for(&slack, &alert("down")).1, json!({ "text": "*Shop is down*\nNo answer within 10 seconds" }));
        let telegram = Target { kind: "telegram".into(), token: "1:abc".into(), chat: "-100".into(), ..Target::default() };
        let (url, body) = body_for(&telegram, &alert("down"));
        assert_eq!(url, "https://api.telegram.org/bot1:abc/sendMessage");
        assert_eq!(body["chat_id"], "-100");
        let ntfy = Target { kind: "ntfy".into(), url: "https://ntfy.sh/".into(), topic: "t".into(), ..Target::default() };
        let (url, body) = body_for(&ntfy, &alert("down"));
        assert_eq!(url, "https://ntfy.sh");
        assert_eq!(body["priority"], 5);
        let hook = Target { kind: "webhook".into(), url: "https://example.com/hook".into(), ..Target::default() };
        let (_, body) = body_for(&hook, &alert("down"));
        assert_eq!(body["downForSeconds"], 90);
        assert_eq!(body["time"], "1970-01-01T00:00:00Z");
        assert_eq!(body["monitor"]["name"], "Shop");
    }

    #[test]
    fn places_pick_the_alerts_they_want() {
        let mut target = Target::default();
        assert!(alert("down").wanted_by(&target));
        target.down = false;
        assert!(!alert("down").wanted_by(&target));
        assert!(!alert("reminder").wanted_by(&target));
        assert!(alert("up").wanted_by(&target));
        target.enabled = false;
        assert!(!alert("up").wanted_by(&target));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn notifications_show_while_the_app_is_in_front() {
        // Found live on 2026-11-28: the test pressed in the app, which is in
        // front then, never showed, since macOS hides a notification from the
        // app in front unless its delegate asks for a banner.
        let (answers, options) = native::options_in_front();
        assert!(answers, "macOS only asks a delegate that answers the method");
        let options = options.expect("the delegate hands macOS its options");
        for (bit, what) in [(1 << 4, "banner"), (1 << 3, "list"), (1 << 2, "alert, for macOS 10.15"), (1 << 1, "sound")] {
            assert!(options & bit != 0, "{what} missing from {options:#b}");
        }
    }
}
