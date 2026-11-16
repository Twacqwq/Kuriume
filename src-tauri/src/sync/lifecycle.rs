//! Exit-time push. Desktop defers the process exit for at most one budget so
//! the latest records reach the cloud; mobile pauses are wired through the
//! platform bridge in Phase D.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::store_commands::StoreState;
use crate::sync::engine::{self, SyncRequest, Trigger};
use crate::sync::{SyncGate, CLOSE_BUDGET};

static CLOSING: AtomicBool = AtomicBool::new(false);

/// Called from `RunEvent::ExitRequested`. Returns true when the caller must
/// call `prevent_exit` and let the bounded push finish before exiting.
pub fn defer_exit(app: &AppHandle) -> bool {
    if CLOSING.swap(true, Ordering::AcqRel) {
        return false;
    }
    let auto_sync = app
        .state::<StoreState>()
        .with_store(app, |store| {
            store
                .sync_config()
                .map(|config| config.auto_sync)
                .map_err(|error| error.to_string())
        })
        .unwrap_or(false);
    if !auto_sync {
        return false;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<StoreState>();
        let gate = handle.state::<SyncGate>();
        let _ = tokio::time::timeout(
            CLOSE_BUDGET + Duration::from_millis(500),
            engine::run(
                &handle,
                &state,
                &gate,
                SyncRequest::automatic(Trigger::Close),
            ),
        )
        .await;
        handle.exit(0);
    });
    true
}
