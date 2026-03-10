use serde::{Deserialize, Serialize};

/// Events emitted by the mpv player, forwarded to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum PlayerEvent {
    /// Playback position changed (seconds).
    TimePos(f64),
    /// Total duration updated (seconds).
    Duration(f64),
    /// Pause state changed.
    Paused(bool),
    /// Playback speed changed.
    Speed(f64),
    /// Volume changed (0–100).
    Volume(f64),
    /// Demuxer cache duration (seconds buffered ahead).
    CacheDuration(f64),
    /// A new file started loading.
    FileStarted,
    /// The file has been fully loaded and is ready to play.
    FileLoaded,
    /// Playback of the current file ended.
    FileEnded,
    /// Seek operation started.
    Seeking,
    /// Playback resumed after a seek.
    PlaybackRestart,
    /// Video output configuration changed (resolution, format, etc.).
    VideoReconfig,
    /// Audio output configuration changed (sample rate, channels, etc.).
    AudioReconfig,
    /// The event queue overflowed — some events were lost.
    QueueOverflow,
    /// The player is shutting down.
    Shutdown,
}
