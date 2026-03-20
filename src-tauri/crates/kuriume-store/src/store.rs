use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde::Serialize;
use tracing::info;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

type Result<T> = std::result::Result<T, StoreError>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// User-configurable settings (persisted in SQLite `settings` table).
#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    /// Root directory for cached media files.
    /// Defaults to `{download_dir}/Kuriume` on each platform.
    pub cache_dir: String,
    /// Whether caching is enabled at all.
    pub cache_enabled: bool,
}

/// Watchlist status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum WatchStatus {
    /// 未看
    Unwatched,
    /// 正在看
    Watching,
    /// 已看完
    Completed,
}

impl WatchStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unwatched => "unwatched",
            Self::Watching => "watching",
            Self::Completed => "completed",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "unwatched" => Self::Unwatched,
            "completed" => Self::Completed,
            _ => Self::Watching,
        }
    }
}

/// An entry in the user's watchlist.
#[derive(Debug, Clone, Serialize)]
pub struct WatchlistEntry {
    pub id: i64,
    /// Bangumi subject ID.
    pub bgm_id: String,
    /// Anime title (for display without re-fetching).
    pub anime_title: String,
    /// Cover image URL.
    pub cover: Option<String>,
    /// Total episodes.
    pub total_episodes: i32,
    /// Watch status.
    pub status: String,
    /// ISO-8601 timestamp when added.
    pub added_at: String,
    /// ISO-8601 timestamp of last status update.
    pub updated_at: String,
}

/// A watch history entry — records playback progress for resume.
#[derive(Debug, Clone, Serialize)]
pub struct WatchHistoryEntry {
    pub id: i64,
    /// Bangumi subject ID.
    pub bgm_id: String,
    /// Episode number.
    pub episode: i32,
    /// Anime title (for display).
    pub anime_title: String,
    /// Episode title (for display).
    pub episode_title: String,
    /// Cover image URL.
    pub cover: Option<String>,
    /// Playback position in seconds.
    pub position: f64,
    /// Total duration in seconds.
    pub duration: f64,
    /// Subtitle group ID (for resume with same source).
    pub group_id: Option<String>,
    /// Resolution preference (for resume).
    pub resolution: Option<String>,
    /// Subtitle preference (for resume).
    pub subtitle: Option<String>,
    /// ISO-8601 timestamp of last watch.
    pub watched_at: String,
}

/// A cached media file entry.
#[derive(Debug, Clone, Serialize)]
pub struct MediaEntry {
    pub id: i64,
    /// Bangumi subject ID (bgm.tv).
    pub bgm_id: String,
    /// Episode number.
    pub episode: i32,
    /// Anime title used for folder naming.
    pub anime_title: String,
    /// Subtitle group name (for organised folders).
    pub group_name: String,
    /// Video resolution label (e.g. "1080p", "720p", "4K").
    pub resolution: String,
    /// Absolute path to the cached file on disk.
    pub file_path: String,
    /// File size in bytes.
    pub file_size: i64,
    /// Original torrent source (magnet / .torrent URL) for re-seeding.
    pub torrent_source: String,
    /// ISO-8601 timestamp of when this was cached.
    pub cached_at: String,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/// SQLite-backed store for settings and media cache metadata.
///
/// The database lives at `{app_data}/kuriume.db`.
/// Thread-safety: `Store` is `Send + Sync` — `rusqlite::Connection` is used
/// behind a `std::sync::Mutex` internally; callers should wrap in `Arc` and
/// use `tokio::task::spawn_blocking` for async contexts.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (or create) the store at the given path.
    ///
    /// Runs migrations on first open.
    pub fn open(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        let store = Self { conn };
        store.migrate()?;
        info!(?db_path, "store opened");
        Ok(store)
    }

    // ── Migrations ───────────────────────────────────────────────

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS media_cache (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                bgm_id         TEXT    NOT NULL,
                episode        INTEGER NOT NULL,
                anime_title    TEXT    NOT NULL,
                group_name     TEXT    NOT NULL DEFAULT '',
                resolution     TEXT    NOT NULL DEFAULT '',
                file_path      TEXT    NOT NULL,
                file_size      INTEGER NOT NULL DEFAULT 0,
                torrent_source TEXT    NOT NULL DEFAULT '',
                cached_at      TEXT    NOT NULL DEFAULT (datetime('now')),

                UNIQUE(bgm_id, episode, group_name, resolution)
            );

            CREATE INDEX IF NOT EXISTS idx_media_bgm_ep
                ON media_cache(bgm_id, episode);

            CREATE TABLE IF NOT EXISTS watchlist (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                bgm_id          TEXT    NOT NULL UNIQUE,
                anime_title     TEXT    NOT NULL,
                cover           TEXT,
                total_episodes  INTEGER NOT NULL DEFAULT 0,
                status          TEXT    NOT NULL DEFAULT 'watching',
                added_at        TEXT    NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS watch_history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                bgm_id          TEXT    NOT NULL,
                episode         INTEGER NOT NULL,
                anime_title     TEXT    NOT NULL,
                episode_title   TEXT    NOT NULL DEFAULT '',
                cover           TEXT,
                position        REAL    NOT NULL DEFAULT 0,
                duration        REAL    NOT NULL DEFAULT 0,
                group_id        TEXT,
                resolution      TEXT,
                subtitle        TEXT,
                watched_at      TEXT    NOT NULL DEFAULT (datetime('now')),

                UNIQUE(bgm_id, episode)
            );

            CREATE INDEX IF NOT EXISTS idx_history_watched
                ON watch_history(watched_at DESC);
            ",
        )?;

        // Migration: add resolution column if missing (existing DBs)
        let has_resolution: bool = self
            .conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('media_cache') WHERE name='resolution'")
            .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
            .map(|n| n > 0)
            .unwrap_or(false);

        if !has_resolution {
            self.conn.execute_batch(
                "
                ALTER TABLE media_cache ADD COLUMN resolution TEXT NOT NULL DEFAULT '';

                -- Recreate unique index to include resolution
                CREATE UNIQUE INDEX IF NOT EXISTS idx_media_unique_v2
                    ON media_cache(bgm_id, episode, group_name, resolution);
                ",
            )?;
        }

        Ok(())
    }

    // ── Settings ─────────────────────────────────────────────────

    fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
        let result = stmt
            .query_row(params![key], |row| row.get::<_, String>(0))
            .ok();
        Ok(result)
    }

    fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Load all settings, filling in defaults for missing keys.
    pub fn get_settings(&self, default_cache_dir: &str) -> Result<Settings> {
        let cache_dir = self
            .get_setting("cache_dir")?
            .unwrap_or_else(|| default_cache_dir.to_string());
        let cache_enabled = self
            .get_setting("cache_enabled")?
            .map(|v| v == "true")
            .unwrap_or(true);

        Ok(Settings {
            cache_dir,
            cache_enabled,
        })
    }

    pub fn set_cache_dir(&self, dir: &str) -> Result<()> {
        self.set_setting("cache_dir", dir)
    }

    pub fn set_cache_enabled(&self, enabled: bool) -> Result<()> {
        self.set_setting("cache_enabled", if enabled { "true" } else { "false" })
    }

    // ── Media cache ──────────────────────────────────────────────

    /// Look up a cached file for a specific anime episode.
    ///
    /// If `group_name` is provided, matches that group specifically.
    /// Otherwise returns the first available cached entry for the episode.
    pub fn lookup(
        &self,
        bgm_id: &str,
        episode: i32,
        group_name: Option<&str>,
        resolution: Option<&str>,
    ) -> Result<Option<MediaEntry>> {
        let entry = match (group_name, resolution) {
            (Some(group), Some(res)) => {
                let mut stmt = self.conn.prepare_cached(
                    "SELECT id, bgm_id, episode, anime_title, group_name, resolution,
                            file_path, file_size, torrent_source, cached_at
                     FROM media_cache
                     WHERE bgm_id = ?1 AND episode = ?2 AND group_name = ?3 AND resolution = ?4
                     LIMIT 1",
                )?;
                stmt.query_row(params![bgm_id, episode, group, res], Self::row_to_entry)
                    .ok()
            }
            (Some(group), None) => {
                let mut stmt = self.conn.prepare_cached(
                    "SELECT id, bgm_id, episode, anime_title, group_name, resolution,
                            file_path, file_size, torrent_source, cached_at
                     FROM media_cache
                     WHERE bgm_id = ?1 AND episode = ?2 AND group_name = ?3
                     LIMIT 1",
                )?;
                stmt.query_row(params![bgm_id, episode, group], Self::row_to_entry)
                    .ok()
            }
            _ => {
                let mut stmt = self.conn.prepare_cached(
                    "SELECT id, bgm_id, episode, anime_title, group_name, resolution,
                            file_path, file_size, torrent_source, cached_at
                     FROM media_cache
                     WHERE bgm_id = ?1 AND episode = ?2
                     ORDER BY cached_at DESC
                     LIMIT 1",
                )?;
                stmt.query_row(params![bgm_id, episode], Self::row_to_entry)
                    .ok()
            }
        };
        Ok(entry)
    }

    /// Insert or update a cache entry. Returns the row ID.
    pub fn upsert_entry(
        &self,
        bgm_id: &str,
        episode: i32,
        anime_title: &str,
        group_name: &str,
        resolution: &str,
        file_path: &str,
        file_size: i64,
        torrent_source: &str,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO media_cache(bgm_id, episode, anime_title, group_name, resolution,
                                     file_path, file_size, torrent_source)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(bgm_id, episode, group_name, resolution)
             DO UPDATE SET
                anime_title    = excluded.anime_title,
                file_path      = excluded.file_path,
                file_size      = excluded.file_size,
                torrent_source = excluded.torrent_source,
                cached_at      = datetime('now')",
            params![bgm_id, episode, anime_title, group_name, resolution, file_path, file_size, torrent_source],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Remove a cache entry and return the file path (so caller can delete file).
    pub fn remove_entry(&self, id: i64) -> Result<Option<String>> {
        let path: Option<String> = self
            .conn
            .prepare_cached("SELECT file_path FROM media_cache WHERE id = ?1")?
            .query_row(params![id], |row| row.get(0))
            .ok();
        self.conn
            .execute("DELETE FROM media_cache WHERE id = ?1", params![id])?;
        Ok(path)
    }

    /// List all cached entries for an anime.
    pub fn list_anime_entries(&self, bgm_id: &str) -> Result<Vec<MediaEntry>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, bgm_id, episode, anime_title, group_name, resolution,
                    file_path, file_size, torrent_source, cached_at
             FROM media_cache
             WHERE bgm_id = ?1
             ORDER BY episode ASC",
        )?;
        let entries = stmt
            .query_map(params![bgm_id], Self::row_to_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// List ALL cached entries across all anime.
    pub fn list_all_entries(&self) -> Result<Vec<MediaEntry>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, bgm_id, episode, anime_title, group_name, resolution,
                    file_path, file_size, torrent_source, cached_at
             FROM media_cache
             ORDER BY anime_title ASC, episode ASC",
        )?;
        let entries = stmt
            .query_map([], Self::row_to_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// Update the file_path for a specific cache entry.
    pub fn update_file_path(&self, id: i64, new_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE media_cache SET file_path = ?1 WHERE id = ?2",
            params![new_path, id],
        )?;
        Ok(())
    }

    /// Total cache size in bytes.
    pub fn total_cache_size(&self) -> Result<i64> {
        let size: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(file_size), 0) FROM media_cache",
            [],
            |row| row.get(0),
        )?;
        Ok(size)
    }

    /// Remove all cache entries. Returns file paths for deletion.
    pub fn clear_all(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT file_path FROM media_cache")?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        self.conn.execute("DELETE FROM media_cache", [])?;
        Ok(paths)
    }

    // ── Watchlist ─────────────────────────────────────────────────

    /// Add an anime to the watchlist (default status: watching).
    /// If already exists, returns the existing entry.
    pub fn watchlist_add(
        &self,
        bgm_id: &str,
        anime_title: &str,
        cover: Option<&str>,
        total_episodes: i32,
    ) -> Result<WatchlistEntry> {
        self.conn.execute(
            "INSERT INTO watchlist(bgm_id, anime_title, cover, total_episodes)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(bgm_id) DO UPDATE SET
                anime_title    = excluded.anime_title,
                cover          = excluded.cover,
                total_episodes = excluded.total_episodes,
                updated_at     = datetime('now')",
            params![bgm_id, anime_title, cover, total_episodes],
        )?;
        self.watchlist_get(bgm_id)?
            .ok_or_else(|| StoreError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Remove an anime from the watchlist.
    pub fn watchlist_remove(&self, bgm_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM watchlist WHERE bgm_id = ?1",
            params![bgm_id],
        )?;
        Ok(())
    }

    /// Get a single watchlist entry by bgm_id.
    pub fn watchlist_get(&self, bgm_id: &str) -> Result<Option<WatchlistEntry>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, bgm_id, anime_title, cover, total_episodes, status, added_at, updated_at
             FROM watchlist WHERE bgm_id = ?1",
        )?;
        let entry = stmt
            .query_row(params![bgm_id], Self::row_to_watchlist)
            .ok();
        Ok(entry)
    }

    /// Update the watch status of an anime.
    pub fn watchlist_set_status(&self, bgm_id: &str, status: WatchStatus) -> Result<()> {
        self.conn.execute(
            "UPDATE watchlist SET status = ?1, updated_at = datetime('now') WHERE bgm_id = ?2",
            params![status.as_str(), bgm_id],
        )?;
        Ok(())
    }

    /// List all watchlist entries, optionally filtered by status.
    pub fn watchlist_list(&self, status: Option<&str>) -> Result<Vec<WatchlistEntry>> {
        if let Some(s) = status {
            let mut stmt = self.conn.prepare_cached(
                "SELECT id, bgm_id, anime_title, cover, total_episodes, status, added_at, updated_at
                 FROM watchlist WHERE status = ?1 ORDER BY updated_at DESC",
            )?;
            let entries = stmt
                .query_map(params![s], Self::row_to_watchlist)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(entries)
        } else {
            let mut stmt = self.conn.prepare_cached(
                "SELECT id, bgm_id, anime_title, cover, total_episodes, status, added_at, updated_at
                 FROM watchlist ORDER BY updated_at DESC",
            )?;
            let entries = stmt
                .query_map([], Self::row_to_watchlist)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(entries)
        }
    }

    fn row_to_watchlist(row: &rusqlite::Row) -> rusqlite::Result<WatchlistEntry> {
        Ok(WatchlistEntry {
            id: row.get(0)?,
            bgm_id: row.get(1)?,
            anime_title: row.get(2)?,
            cover: row.get(3)?,
            total_episodes: row.get(4)?,
            status: row.get(5)?,
            added_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }

    // ── Watch History ─────────────────────────────────────────────

    /// Upsert a watch history entry (insert or update progress).
    pub fn history_upsert(
        &self,
        bgm_id: &str,
        episode: i32,
        anime_title: &str,
        episode_title: &str,
        cover: Option<&str>,
        position: f64,
        duration: f64,
        group_id: Option<&str>,
        resolution: Option<&str>,
        subtitle: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO watch_history(bgm_id, episode, anime_title, episode_title, cover,
                                       position, duration, group_id, resolution, subtitle)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(bgm_id, episode) DO UPDATE SET
                anime_title   = excluded.anime_title,
                episode_title = excluded.episode_title,
                cover         = excluded.cover,
                position      = excluded.position,
                duration      = excluded.duration,
                group_id      = excluded.group_id,
                resolution    = excluded.resolution,
                subtitle      = excluded.subtitle,
                watched_at    = datetime('now')",
            params![bgm_id, episode, anime_title, episode_title, cover,
                    position, duration, group_id, resolution, subtitle],
        )?;
        Ok(())
    }

    /// List watch history entries, most recent first.
    pub fn history_list(&self, limit: i32, offset: i32) -> Result<Vec<WatchHistoryEntry>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, bgm_id, episode, anime_title, episode_title, cover,
                    position, duration, group_id, resolution, subtitle, watched_at
             FROM watch_history
             ORDER BY watched_at DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let entries = stmt
            .query_map(params![limit, offset], Self::row_to_history)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// Remove a single history entry.
    pub fn history_remove(&self, bgm_id: &str, episode: i32) -> Result<()> {
        self.conn.execute(
            "DELETE FROM watch_history WHERE bgm_id = ?1 AND episode = ?2",
            params![bgm_id, episode],
        )?;
        Ok(())
    }

    /// Clear all history.
    pub fn history_clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM watch_history", [])?;
        Ok(())
    }

    fn row_to_history(row: &rusqlite::Row) -> rusqlite::Result<WatchHistoryEntry> {
        Ok(WatchHistoryEntry {
            id: row.get(0)?,
            bgm_id: row.get(1)?,
            episode: row.get(2)?,
            anime_title: row.get(3)?,
            episode_title: row.get(4)?,
            cover: row.get(5)?,
            position: row.get(6)?,
            duration: row.get(7)?,
            group_id: row.get(8)?,
            resolution: row.get(9)?,
            subtitle: row.get(10)?,
            watched_at: row.get(11)?,
        })
    }

    // ── Helpers ──────────────────────────────────────────────────

    fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<MediaEntry> {
        Ok(MediaEntry {
            id: row.get(0)?,
            bgm_id: row.get(1)?,
            episode: row.get(2)?,
            anime_title: row.get(3)?,
            group_name: row.get(4)?,
            resolution: row.get(5)?,
            file_path: row.get(6)?,
            file_size: row.get(7)?,
            torrent_source: row.get(8)?,
            cached_at: row.get(9)?,
        })
    }
}

// ---------------------------------------------------------------------------
// Path helpers — Jellyfin-style naming
// ---------------------------------------------------------------------------

/// Sanitize a string for filesystem use (remove illegal chars).
fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Build the Jellyfin-style directory for an anime:
/// `{cache_dir}/{anime_title}/`
pub fn anime_dir(cache_dir: &Path, anime_title: &str) -> PathBuf {
    cache_dir.join(sanitize_filename(anime_title))
}

/// Build the Jellyfin-style filename for an episode:
/// `{anime_title} - S01E{ep:02} [{group}] [{resolution}].{ext}`
///
/// Groups and resolution are kept in the filename (not as subdirectories)
/// so the structure stays flat per anime — easier to browse in file managers
/// and compatible with media server scrapers that match by S01E pattern.
pub fn episode_filename(
    anime_title: &str,
    episode: i32,
    group_name: &str,
    resolution: &str,
    original_filename: &str,
) -> String {
    let ext = Path::new(original_filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mkv");

    let title = sanitize_filename(anime_title);
    let group = sanitize_filename(group_name);
    let res = sanitize_filename(resolution);

    let mut name = format!("{title} - S01E{episode:02}");
    if !group.is_empty() {
        name.push_str(&format!(" [{group}]"));
    }
    if !res.is_empty() {
        name.push_str(&format!(" [{res}]"));
    }
    format!("{name}.{ext}")
}

/// Full path for a cached episode file.
pub fn episode_path(
    cache_dir: &Path,
    anime_title: &str,
    episode: i32,
    group_name: &str,
    resolution: &str,
    original_filename: &str,
) -> PathBuf {
    anime_dir(cache_dir, anime_title)
        .join(episode_filename(anime_title, episode, group_name, resolution, original_filename))
}
