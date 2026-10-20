//! Client-side pacing for AniList's documented limits: 90 requests/minute,
//! 30/minute while the API is degraded (the headers do not reflect that), an
//! undisclosed burst limiter on top, and a one-minute timeout after any 429.
//! See <https://docs.anilist.co/guide/rate-limiting>.
//!
//! Every AniList request in the app goes through one [`RateGate`], so pages
//! that fire several catalog lookups at once are spaced out instead of
//! tripping the burst limiter, and a 429 stops all traffic until the server's
//! timeout ends rather than extending it with more doomed requests.
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Stay under the degraded-state ceiling (30/min) with some headroom.
pub(super) const REQUESTS_PER_MINUTE: usize = 25;
/// Minimum gap between two requests, against the burst limiter.
pub(super) const MIN_SPACING: Duration = Duration::from_millis(400);
/// Waiting longer than this fails fast instead of freezing a page.
pub(super) const MAX_WAIT: Duration = Duration::from_secs(6);
const WINDOW: Duration = Duration::from_secs(60);
/// AniList's documented timeout after a 429 when no header says otherwise.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Default)]
struct GateState {
    sent: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

impl GateState {
    /// How long a request arriving at `now` must wait for a slot.
    fn wait_at(&mut self, now: Instant) -> Duration {
        while self
            .sent
            .front()
            .is_some_and(|sent| now.saturating_duration_since(*sent) >= WINDOW)
        {
            self.sent.pop_front();
        }
        let mut wait = Duration::ZERO;
        match self.blocked_until {
            Some(until) if until > now => wait = until - now,
            Some(_) => self.blocked_until = None,
            None => {}
        }
        if let Some(last) = self.sent.back() {
            wait = wait.max((*last + MIN_SPACING).saturating_duration_since(now));
        }
        if self.sent.len() >= REQUESTS_PER_MINUTE {
            let oldest = self.sent[self.sent.len() - REQUESTS_PER_MINUTE];
            wait = wait.max((oldest + WINDOW).saturating_duration_since(now));
        }
        wait
    }
}

pub(super) struct RateGate {
    state: Mutex<GateState>,
}

impl RateGate {
    pub(super) fn new() -> Self {
        Self {
            state: Mutex::new(GateState::default()),
        }
    }

    /// Wait for a send slot. The lock is held across the sleep, so waiting
    /// requests go out one at a time in arrival order. `Err` carries how long
    /// the caller would have had to wait when that exceeds [`MAX_WAIT`].
    pub(super) async fn admit(&self) -> Result<(), Duration> {
        let mut state = self.state.lock().await;
        let wait = state.wait_at(Instant::now());
        if wait > MAX_WAIT {
            return Err(wait);
        }
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        state.sent.push_back(Instant::now());
        Ok(())
    }

    /// Stop all requests until the server's timeout has passed.
    pub(super) async fn block_for(&self, duration: Duration) {
        let until = Instant::now() + duration;
        let mut state = self.state.lock().await;
        if state.blocked_until.is_none_or(|current| current < until) {
            state.blocked_until = Some(until);
        }
    }
}

/// How long to stay away after a 429 (or when the quota reads zero):
/// `Retry-After` seconds, else the `X-RateLimit-Reset` timestamp, else 60 s.
pub(super) fn timeout_from_headers(
    retry_after: Option<&str>,
    reset: Option<&str>,
    now_unix: u64,
) -> Duration {
    let parse = |value: Option<&str>| value.and_then(|value| value.trim().parse::<u64>().ok());
    if let Some(seconds) = parse(retry_after) {
        return Duration::from_secs(seconds.clamp(1, 300));
    }
    if let Some(reset) = parse(reset) {
        return Duration::from_secs(reset.saturating_sub(now_unix).clamp(1, 300));
    }
    DEFAULT_TIMEOUT
}

/// The error text the app shows: names the limit and when to retry.
pub(super) fn rate_limited_message(wait: Duration) -> String {
    format!(
        "AniList rate limit reached (HTTP 429); retry in {} s",
        wait.as_secs().max(1)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_spaced_and_capped_per_minute() {
        let start = Instant::now();
        let mut state = GateState::default();
        assert_eq!(state.wait_at(start), Duration::ZERO);
        state.sent.push_back(start);
        assert_eq!(state.wait_at(start), MIN_SPACING);
        assert_eq!(state.wait_at(start + MIN_SPACING), Duration::ZERO);

        let mut full = GateState::default();
        for index in 0..REQUESTS_PER_MINUTE {
            full.sent.push_back(start + MIN_SPACING * index as u32);
        }
        let now = start + MIN_SPACING * REQUESTS_PER_MINUTE as u32;
        assert_eq!(
            full.wait_at(now),
            start + WINDOW - now,
            "the oldest send must leave the window first"
        );
        assert_eq!(
            full.wait_at(start + WINDOW + MIN_SPACING * 30),
            Duration::ZERO,
            "old sends expire"
        );
        assert!(full.sent.len() < REQUESTS_PER_MINUTE);
    }

    #[test]
    fn a_timeout_blocks_everything_until_it_ends() {
        let start = Instant::now();
        let mut state = GateState {
            blocked_until: Some(start + Duration::from_secs(42)),
            ..GateState::default()
        };
        assert_eq!(state.wait_at(start), Duration::from_secs(42));
        assert_eq!(
            state.wait_at(start + Duration::from_secs(43)),
            Duration::ZERO
        );
        assert!(state.blocked_until.is_none());
    }

    #[test]
    fn timeouts_follow_the_server_headers() {
        assert_eq!(
            timeout_from_headers(Some("30"), Some("999"), 0),
            Duration::from_secs(30)
        );
        assert_eq!(
            timeout_from_headers(None, Some("1060"), 1000),
            Duration::from_secs(60)
        );
        assert_eq!(
            timeout_from_headers(None, Some("900"), 1000),
            Duration::from_secs(1)
        );
        assert_eq!(timeout_from_headers(Some("soon"), None, 0), DEFAULT_TIMEOUT);
        assert_eq!(timeout_from_headers(None, None, 0), DEFAULT_TIMEOUT);
    }

    #[tokio::test]
    async fn admission_fails_fast_during_a_long_timeout() {
        let gate = RateGate::new();
        assert!(gate.admit().await.is_ok());
        gate.block_for(Duration::from_secs(60)).await;
        let wait = gate.admit().await.unwrap_err();
        assert!(wait > MAX_WAIT && wait <= Duration::from_secs(60));
    }
}
