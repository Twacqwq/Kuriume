use libmpv2::events::{Event, PropertyData};
use libmpv2::{Format, Mpv};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use tokio::sync::mpsc;

use crate::error::{MpvError, Result};
use crate::event::PlayerEvent;

/// Property observe IDs.
const OBS_TIME_POS: u64 = 1;
const OBS_DURATION: u64 = 2;
const OBS_PAUSE: u64 = 3;
const OBS_SPEED: u64 = 4;
const OBS_CACHE_DURATION: u64 = 5;
const OBS_VOLUME: u64 = 6;

/// All observe IDs for cleanup via `unobserve_property`.
const ALL_OBS_IDS: &[u64] = &[
    OBS_TIME_POS,
    OBS_DURATION,
    OBS_PAUSE,
    OBS_SPEED,
    OBS_CACHE_DURATION,
    OBS_VOLUME,
];

pub struct MpvPlayer {
    /// Boxed so that moving `MpvPlayer` (e.g. into a Mutex) does not
    /// invalidate the raw pointer held by the event-loop thread.
    mpv: Box<Mpv>,
    running: Arc<AtomicBool>,
    /// Condvar used by `set_wakeup_callback` to notify the event loop
    /// when new events are available, replacing the old 0.5s polling.
    wakeup: Arc<(Mutex<bool>, Condvar)>,
    /// Handle to the event-loop thread so we can join it on drop,
    /// ensuring the raw Mpv pointer is no longer in use before freeing.
    event_thread: Option<std::thread::JoinHandle<()>>,
}

impl MpvPlayer {
    /// Create a player configured for the render API (`vo=libmpv`).
    pub fn new_for_render() -> Result<Self> {
        let mpv = Mpv::with_initializer(|init| {
            init.set_option("config", false)?;
            init.set_option("idle", true)?;
            init.set_option("input-default-bindings", false)?;
            init.set_option("osc", false)?;
            init.set_option("ytdl", false)?;
            init.set_option("hwdec", "auto")?;
            // vo=libmpv tells mpv to use the render API for output
            init.set_option("vo", "libmpv")?;

            // ── Network / streaming cache ────────────────────────
            init.set_option("cache", true)?;
            init.set_option("cache-secs", 2)?;
            init.set_option("network-timeout", 0)?;

            // Mobile: smaller buffers to conserve RAM, force GLES
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                init.set_option("demuxer-max-bytes", "50MiB")?;
                init.set_option("demuxer-max-back-bytes", "20MiB")?;
                init.set_option("opengl-es", "yes")?;
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                init.set_option("demuxer-max-bytes", "150MiB")?;
                init.set_option("demuxer-max-back-bytes", "50MiB")?;
            }

            Ok(())
        })?;

        Ok(Self {
            mpv: Box::new(mpv),
            running: Arc::new(AtomicBool::new(false)),
            wakeup: Arc::new((Mutex::new(false), Condvar::new())),
            event_thread: None,
        })
    }

    /// Return the raw `mpv_handle *` for creating a `GpuRenderer`.
    pub fn raw_handle(&self) -> *mut std::ffi::c_void {
        self.mpv.ctx.as_ptr() as *mut std::ffi::c_void
    }

    /// Set hardware decoding mode at runtime.
    pub fn set_hwdec(&self, mode: &str) -> Result<()> {
        self.mpv.set_property("hwdec", mode)?;
        Ok(())
    }

    /// Get current hardware decoding mode.
    pub fn hwdec(&self) -> String {
        self.mpv
            .get_property::<String>("hwdec-current")
            .unwrap_or_else(|_| "no".into())
    }

    /// Set the demuxer forward buffer size at runtime (in bytes).
    pub fn set_demuxer_max_bytes(&self, bytes: i64) -> Result<()> {
        self.mpv.set_property("demuxer-max-bytes", bytes)?;
        Ok(())
    }

    // ── Playback control ─────────────────────────────────────────

    /// Load and play a media URL or file path.
    pub fn play(&self, url: &str) -> Result<()> {
        self.mpv.command("loadfile", &[url])?;
        Ok(())
    }

    /// Toggle pause state.
    pub fn set_paused(&self, paused: bool) -> Result<()> {
        self.mpv.set_property("pause", paused)?;
        Ok(())
    }

    /// Seek to an absolute position in seconds.
    pub fn seek(&self, seconds: f64) -> Result<()> {
        self.mpv
            .command("seek", &[&seconds.to_string(), "absolute"])?;
        Ok(())
    }

    /// Stop playback and clear the playlist.
    pub fn stop(&self) -> Result<()> {
        self.mpv.command("stop", &[])?;
        Ok(())
    }

    // ── Property accessors ───────────────────────────────────────

    /// Current playback position in seconds.
    pub fn position(&self) -> f64 {
        self.mpv.get_property("time-pos").unwrap_or(0.0)
    }

    /// Total duration in seconds.
    pub fn duration(&self) -> f64 {
        self.mpv.get_property("duration").unwrap_or(0.0)
    }

    /// Whether the player is paused.
    pub fn is_paused(&self) -> bool {
        self.mpv.get_property("pause").unwrap_or(true)
    }

    /// Set playback volume (0-100).
    pub fn set_volume(&self, volume: i64) -> Result<()> {
        self.mpv.set_property("volume", volume)?;
        Ok(())
    }

    /// Get playback volume.
    pub fn volume(&self) -> i64 {
        self.mpv.get_property("volume").unwrap_or(100)
    }

    /// Set playback speed (1.0 = normal).
    pub fn set_speed(&self, speed: f64) -> Result<()> {
        self.mpv.set_property("speed", speed)?;
        Ok(())
    }

    /// Get playback speed.
    pub fn speed(&self) -> f64 {
        self.mpv.get_property("speed").unwrap_or(1.0)
    }

    /// Get mpv internal monotonic time in microseconds.
    pub fn time_us(&self) -> i64 {
        self.mpv.get_time_us()
    }

    // ── Track selection ──────────────────────────────────────────

    /// Set audio track ID. Use 0 to disable.
    pub fn set_audio_track(&self, id: i64) -> Result<()> {
        self.mpv.set_property("aid", id)?;
        Ok(())
    }

    /// Set subtitle track ID. Use 0 to disable.
    pub fn set_subtitle_track(&self, id: i64) -> Result<()> {
        self.mpv.set_property("sid", id)?;
        Ok(())
    }

    // ── GLSL shaders (Anime4K) ──────────────────────────────────

    /// Set the GLSL post-processing shader list.
    ///
    /// `paths` should be a colon-separated string of absolute file paths
    /// (e.g. `/path/to/Clamp.glsl:/path/to/Restore.glsl`).
    pub fn set_glsl_shaders(&self, paths: &str) -> Result<()> {
        self.mpv.set_property("glsl-shaders", paths)?;
        Ok(())
    }

    /// Clear all GLSL post-processing shaders.
    pub fn clear_glsl_shaders(&self) -> Result<()> {
        self.mpv.set_property("glsl-shaders", "")?;
        Ok(())
    }

    // ── Event loop ───────────────────────────────────────────────

    /// Start the event loop. Returns a receiver channel for `PlayerEvent`s.
    pub fn start_event_loop(&mut self) -> Result<mpsc::UnboundedReceiver<PlayerEvent>> {
        let (tx, rx) = mpsc::unbounded_channel();

        // v5: disable deprecated events first
        self.mpv.disable_deprecated_events()?;

        // v5: selectively enable only the events we care about
        self.mpv.enable_event(libmpv2::events::mpv_event_id::StartFile)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::FileLoaded)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::EndFile)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::Seek)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::PlaybackRestart)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::Shutdown)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::VideoReconfig)?;
        self.mpv.enable_event(libmpv2::events::mpv_event_id::AudioReconfig)?;

        // Observe properties
        self.mpv
            .observe_property("time-pos", Format::Double, OBS_TIME_POS)?;
        self.mpv
            .observe_property("duration", Format::Double, OBS_DURATION)?;
        self.mpv
            .observe_property("pause", Format::Flag, OBS_PAUSE)?;
        self.mpv
            .observe_property("speed", Format::Double, OBS_SPEED)?;
        self.mpv.observe_property(
            "demuxer-cache-duration",
            Format::Double,
            OBS_CACHE_DURATION,
        )?;
        self.mpv
            .observe_property("volume", Format::Double, OBS_VOLUME)?;

        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();

        let wakeup = self.wakeup.clone();
        self.mpv.set_wakeup_callback(move || {
            let (lock, cvar) = &*wakeup;
            if let Ok(mut pending) = lock.lock() {
                *pending = true;
                cvar.notify_one();
            }
        });

        // SAFETY: Mpv is Send+Sync. Box<Mpv> gives stable heap address.
        // Drop calls stop_event_loop first, so the thread exits before Mpv drops.
        let mpv_addr = &mut *self.mpv as *mut Mpv as usize;
        let wakeup_for_thread = self.wakeup.clone();

        let handle = std::thread::Builder::new()
            .name("mpv-event-loop".into())
            .spawn(move || {
                let mpv = unsafe { &mut *(mpv_addr as *mut Mpv) };

                while running.load(Ordering::SeqCst) {
                    // Wait for wakeup signal (or timeout as safety net)
                    {
                        let (lock, cvar) = &*wakeup_for_thread;
                        let mut pending = lock.lock().unwrap();
                        if !*pending {
                            let result = cvar
                                .wait_timeout(pending, std::time::Duration::from_secs(1))
                                .unwrap();
                            pending = result.0;
                        }
                        *pending = false;
                    }

                    // Drain all pending events
                    loop {
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }

                        let Some(ev) = mpv.wait_event(0.0) else {
                            break;
                        };

                        let event = match ev {
                            Ok(Event::PropertyChange {
                                name: _,
                                change,
                                reply_userdata,
                                ..
                            }) => match (reply_userdata, change) {
                                (OBS_TIME_POS, PropertyData::Double(v)) => {
                                    Some(PlayerEvent::TimePos(v))
                                }
                                (OBS_DURATION, PropertyData::Double(v)) => {
                                    Some(PlayerEvent::Duration(v))
                                }
                                (OBS_PAUSE, PropertyData::Flag(v)) => {
                                    Some(PlayerEvent::Paused(v))
                                }
                                (OBS_SPEED, PropertyData::Double(v)) => {
                                    Some(PlayerEvent::Speed(v))
                                }
                                (OBS_CACHE_DURATION, PropertyData::Double(v)) => {
                                    Some(PlayerEvent::CacheDuration(v))
                                }
                                (OBS_VOLUME, PropertyData::Double(v)) => {
                                    Some(PlayerEvent::Volume(v))
                                }
                                _ => None,
                            },
                            Ok(Event::StartFile) => Some(PlayerEvent::FileStarted),
                            Ok(Event::FileLoaded) => Some(PlayerEvent::FileLoaded),
                            Ok(Event::EndFile(_)) => Some(PlayerEvent::FileEnded),
                            Ok(Event::Seek) => Some(PlayerEvent::Seeking),
                            Ok(Event::PlaybackRestart) => Some(PlayerEvent::PlaybackRestart),
                            Ok(Event::VideoReconfig) => Some(PlayerEvent::VideoReconfig),
                            Ok(Event::AudioReconfig) => Some(PlayerEvent::AudioReconfig),
                            Ok(Event::QueueOverflow) => Some(PlayerEvent::QueueOverflow),
                            Ok(Event::Shutdown) => {
                                let _ = tx.send(PlayerEvent::Shutdown);
                                running.store(false, Ordering::SeqCst);
                                return;
                            }
                            _ => None,
                        };

                        if let Some(e) = event {
                            if tx.send(e).is_err() {
                                return;
                            }
                        }
                    }
                }
            })
            .map_err(|e| MpvError::Mpv(format!("Failed to spawn event thread: {e}")))?;

        self.event_thread = Some(handle);
        Ok(rx)
    }

    /// Signal the event loop to stop.
    pub fn stop_event_loop(&self) {
        self.running.store(false, Ordering::SeqCst);
        // Wake the event thread so it exits immediately
        let (lock, cvar) = &*self.wakeup;
        if let Ok(mut pending) = lock.lock() {
            *pending = true;
            cvar.notify_one();
        }
    }

    /// Unobserve all tracked properties and clean up.
    /// Called automatically on drop.
    fn cleanup_observers(&self) {
        for &id in ALL_OBS_IDS {
            let _ = self.mpv.unobserve_property(id);
        }
    }
}

impl Drop for MpvPlayer {
    fn drop(&mut self) {
        self.stop_event_loop();
        // Wait for event thread to exit before freeing Box<Mpv>,
        // otherwise the thread's raw pointer would be dangling.
        if let Some(handle) = self.event_thread.take() {
            let _ = handle.join();
        }
        self.cleanup_observers();
    }
}
