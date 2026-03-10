//! Custom stream protocol support for mpv (v5 API).
//!
//! Uses `libmpv2::protocol::Protocol` to register custom URI schemes
//! (e.g. `torrent://`) so mpv can read from arbitrary sources without
//! temporary files.
//!
//! # Architecture
//!
//! The v5 `Protocol` API expects five callbacks:
//! - `open(user_data, uri) -> StreamState` — called when mpv opens a URI
//! - `read(state, buf) -> bytes_read` — called to fill buffers
//! - `seek(state, offset) -> new_offset` — optional seeking support
//! - `size(state) -> total_bytes` — optional total size reporting
//! - `close(state)` — called when the stream is released
//!
//! # Example (future torrent integration)
//!
//! ```ignore
//! use kuriume_mpv::protocol::register_torrent_protocol;
//!
//! let mut player = MpvPlayer::new(None)?;
//! // register_torrent_protocol(&player, torrent_engine);
//! // player.play("torrent://magnet:?xt=...");
//! ```

use libmpv2::protocol::{Protocol, StreamClose, StreamOpen, StreamRead, StreamSeek, StreamSize};
use libmpv2::Mpv;
use std::panic::RefUnwindSafe;

use crate::error::Result;

/// A registered custom protocol. Holds the `Protocol` handle which
/// must outlive all streams opened through it.
pub struct RegisteredProtocol<'a, T: RefUnwindSafe, U: RefUnwindSafe> {
    _protocol: Protocol<'a, T, U>,
}

/// Register a custom stream protocol on the given mpv instance.
///
/// - `name`: protocol prefix (e.g. `"torrent"` → `torrent://...`)
/// - `user_data`: shared context passed to `open_fn`
/// - `open_fn`: creates per-stream state from URI
/// - `close_fn`: destroys per-stream state
/// - `read_fn`: reads bytes into buffer, returns count or 0 (EOF) or -1 (error)
/// - `seek_fn`: optional seek support
/// - `size_fn`: optional total size reporting
///
/// # Safety
///
/// The callbacks must not call any libmpv functions.
/// All panics inside callbacks are caught and converted to error returns.
#[allow(clippy::too_many_arguments)]
pub fn register_protocol<'a, T, U>(
    mpv: &'a Mpv,
    name: &str,
    user_data: U,
    open_fn: StreamOpen<T, U>,
    close_fn: StreamClose<T>,
    read_fn: StreamRead<T>,
    seek_fn: Option<StreamSeek<T>>,
    size_fn: Option<StreamSize<T>>,
) -> Result<RegisteredProtocol<'a, T, U>>
where
    T: RefUnwindSafe,
    U: RefUnwindSafe,
{
    let protocol = unsafe {
        Protocol::new(
            mpv,
            name.to_string(),
            user_data,
            open_fn,
            close_fn,
            read_fn,
            seek_fn,
            size_fn,
        )
    };

    protocol.register()?;

    Ok(RegisteredProtocol {
        _protocol: protocol,
    })
}

// TODO: Implement `register_torrent_protocol` when `kuriume-torrent` crate is ready.
// It will create a `TorrentStreamState` per URI and wire read/seek/size to the
// torrent piece cache.
