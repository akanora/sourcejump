//! How many heartbeats one address may send. Heartbeats need no key and each one writes to the database, so
//! without a limit one address could keep the database busy for free (backend audit 2026-11-05).
//!
//! Each address has a bucket that holds `BURST` heartbeats and refills `PER_MINUTE` a minute. One IP may run
//! up to 32 servers (`MAX_PORTS_PER_IP`), each beating every 10 minutes and on map start, so even all of them
//! restarting at once stay inside it. IPv6 addresses count per /64 (`ClientAddress::block`). Over the limit
//! the API answers 429, which the plugin treats as temporary: it sends that heartbeat again a minute later.
//!
//! Buckets live in memory: a restart forgets them, which only lets a sender start over with a full bucket.

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Instant,
};

use crate::client_address::ClientAddress;

const BURST: f64 = 120.0;
const PER_MINUTE: f64 = 30.0;
/// Past this many addresses, those whose bucket is full again are forgotten, so the map stays small.
const MAX_TRACKED: usize = 50_000;

#[derive(Clone, Default)]
pub struct HeartbeatLimit(Arc<Mutex<HashMap<IpAddr, Bucket>>>);

#[derive(Clone, Copy)]
struct Bucket {
    left: f64,
    at: Instant,
}

impl Bucket {
    fn refilled(self, now: Instant) -> f64 {
        let minutes = now.saturating_duration_since(self.at).as_secs_f64() / 60.0;
        (self.left + minutes * PER_MINUTE).min(BURST)
    }
}

impl HeartbeatLimit {
    /// Takes one heartbeat from `ip`'s bucket, or says it's empty.
    pub fn allow(&self, ip: IpAddr, now: Instant) -> bool {
        let mut buckets = self
            .0
            .lock()
            .expect("no code panics while holding the lock");
        if buckets.len() >= MAX_TRACKED {
            buckets.retain(|_, bucket| bucket.refilled(now) < BURST);
            if buckets.len() >= MAX_TRACKED {
                // Senders from this many addresses at once: start over rather than grow without bound.
                buckets.clear();
            }
        }
        let bucket = buckets.entry(ClientAddress(ip).block()).or_insert(Bucket {
            left: BURST,
            at: now,
        });
        let left = bucket.refilled(now);
        let allowed = left >= 1.0;
        *bucket = Bucket {
            left: if allowed { left - 1.0 } else { left },
            at: now,
        };
        allowed
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn allows_a_burst_then_refills_over_time() {
        let limit = HeartbeatLimit::default();
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        let start = Instant::now();
        for _ in 0..120 {
            assert!(limit.allow(ip, start));
        }
        assert!(!limit.allow(ip, start), "the 121st at once is refused");
        assert!(
            limit.allow("203.0.113.8".parse().unwrap(), start),
            "other addresses are apart"
        );
        // 30 a minute: one more every 2 seconds.
        assert!(limit.allow(ip, start + Duration::from_secs(2)));
        assert!(!limit.allow(ip, start + Duration::from_secs(2)));
    }

    #[test]
    fn counts_ipv6_per_64() {
        let limit = HeartbeatLimit::default();
        let now = Instant::now();
        for host in 0..120 {
            let ip: IpAddr = format!("2001:db8:1:2::{host:x}").parse().unwrap();
            assert!(limit.allow(ip, now));
        }
        assert!(!limit.allow("2001:db8:1:2:ffff::1".parse().unwrap(), now));
        assert!(limit.allow("2001:db8:1:3::1".parse().unwrap(), now));
    }
}
