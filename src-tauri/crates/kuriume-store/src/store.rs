use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

const CURRENT_SCHEMA_VERSION: i64 = 3;
const DEFAULT_DISPLAY_LANGUAGE: &str = "en";

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid value: {0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub default_volume: f64,
    pub default_speed: f64,
    pub auto_next: bool,
    pub display_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogMediaInput {
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub banner: Option<String>,
    pub total_episodes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMedia {
    pub id: String,
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub banner: Option<String>,
    pub total_episodes: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryStatus {
    Following,
    Completed,
}

impl LibraryStatus {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "following" => Ok(Self::Following),
            "completed" => Ok(Self::Completed),
            _ => Err(StoreError::Invalid(format!(
                "unknown library status: {value}"
            ))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Following => "following",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub media_id: String,
    pub provider: String,
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub banner: Option<String>,
    pub total_episodes: i32,
    pub status: String,
    pub added_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryEntry {
    pub media_id: String,
    pub provider: String,
    pub external_id: String,
    pub episode: i32,
    pub media_title: String,
    pub episode_title: String,
    pub cover: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub source_id: Option<String>,
    pub watched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceBinding {
    pub media_id: String,
    pub source_id: String,
    pub remote_media_url: String,
    pub remote_title: String,
    pub road_index: i32,
    pub verified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalIdentity {
    pub media_id: String,
    pub provider: String,
    pub external_id: String,
    pub scope: String,
    pub confidence: f64,
    pub verified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRuleRecord {
    pub name: String,
    pub rule_json: String,
    pub installed_at: String,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if path.as_ref() != Path::new(":memory:") {
            if let Some(parent) = path.as_ref().parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| StoreError::Invalid(error.to_string()))?;
            }
        }
        let mut connection = Connection::open(path)?;
        connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              default_volume REAL NOT NULL DEFAULT 0.8,
              default_speed REAL NOT NULL DEFAULT 1.0,
              auto_next INTEGER NOT NULL DEFAULT 1,
              display_language TEXT NOT NULL DEFAULT 'en'
            );
            INSERT OR IGNORE INTO settings (id) VALUES (1);

            CREATE TABLE IF NOT EXISTS media (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              cover TEXT,
              banner TEXT,
              total_episodes INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS external_identity (
              media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
              provider TEXT NOT NULL,
              external_id TEXT NOT NULL,
              scope TEXT NOT NULL DEFAULT 'title',
              confidence REAL NOT NULL DEFAULT 1.0,
              verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (provider, external_id, scope)
            );
            CREATE INDEX IF NOT EXISTS idx_external_identity_media
              ON external_identity(media_id);

            CREATE TABLE IF NOT EXISTS library_entry (
              media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
              status TEXT NOT NULL CHECK (status IN ('following', 'completed')),
              added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS watch_history (
              media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
              episode INTEGER NOT NULL,
              episode_title TEXT NOT NULL,
              position REAL NOT NULL,
              duration REAL NOT NULL,
              source_id TEXT,
              watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (media_id, episode)
            );
            CREATE INDEX IF NOT EXISTS idx_watch_history_recent
              ON watch_history(watched_at DESC);

            CREATE TABLE IF NOT EXISTS source_binding (
              media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
              source_id TEXT NOT NULL,
              remote_media_url TEXT NOT NULL,
              remote_title TEXT NOT NULL,
              road_index INTEGER NOT NULL DEFAULT 0,
              verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (media_id, source_id)
            );

            CREATE TABLE IF NOT EXISTS source_rule (
              name TEXT PRIMARY KEY,
              rule_json TEXT NOT NULL,
              installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )?;
        migrate(&mut connection)?;
        Ok(Self { connection })
    }

    pub fn get_settings(&self) -> Result<Settings> {
        self.connection
            .query_row(
                r#"
                SELECT default_volume, default_speed, auto_next, display_language
                FROM settings WHERE id = 1
                "#,
                [],
                |row| {
                    Ok(Settings {
                        default_volume: row.get(0)?,
                        default_speed: row.get(1)?,
                        auto_next: row.get::<_, i64>(2)? != 0,
                        display_language: row.get(3)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn set_default_volume(&self, value: f64) -> Result<()> {
        if !(0.0..=1.0).contains(&value) {
            return Err(StoreError::Invalid("volume must be between 0 and 1".into()));
        }
        self.connection.execute(
            "UPDATE settings SET default_volume = ?1 WHERE id = 1",
            [value],
        )?;
        Ok(())
    }

    pub fn set_default_speed(&self, value: f64) -> Result<()> {
        if !(0.25..=4.0).contains(&value) {
            return Err(StoreError::Invalid(
                "playback speed must be between 0.25 and 4".into(),
            ));
        }
        self.connection.execute(
            "UPDATE settings SET default_speed = ?1 WHERE id = 1",
            [value],
        )?;
        Ok(())
    }

    pub fn set_auto_next(&self, value: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE settings SET auto_next = ?1 WHERE id = 1",
            [i64::from(value)],
        )?;
        Ok(())
    }

    pub fn set_display_language(&self, value: &str) -> Result<()> {
        if !matches!(value, "en" | "zh") {
            return Err(StoreError::Invalid(
                "display language must be 'en' or 'zh'".into(),
            ));
        }
        self.connection.execute(
            "UPDATE settings SET display_language = ?1 WHERE id = 1",
            [value],
        )?;
        Ok(())
    }

    pub fn ensure_media(&self, input: &CatalogMediaInput) -> Result<StoredMedia> {
        if input.provider.trim().is_empty() || input.external_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "provider and external ID are required".into(),
            ));
        }
        let existing = self
            .connection
            .query_row(
                r#"
                SELECT media_id FROM external_identity
                WHERE provider = ?1 AND external_id = ?2 AND scope = 'title'
                "#,
                params![input.provider, input.external_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let media_id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());

        self.connection.execute(
            r#"
            INSERT INTO media (id, title, cover, banner, total_episodes)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              cover = COALESCE(excluded.cover, media.cover),
              banner = COALESCE(excluded.banner, media.banner),
              total_episodes = excluded.total_episodes,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                media_id,
                input.title,
                input.cover,
                input.banner,
                input.total_episodes
            ],
        )?;
        self.connection.execute(
            r#"
            INSERT OR IGNORE INTO external_identity
              (media_id, provider, external_id, scope, confidence)
            VALUES (?1, ?2, ?3, 'title', 1.0)
            "#,
            params![media_id, input.provider, input.external_id],
        )?;
        self.get_media(&media_id)?
            .ok_or_else(|| StoreError::Invalid("failed to persist media".into()))
    }

    pub fn get_media(&self, media_id: &str) -> Result<Option<StoredMedia>> {
        self.connection
            .query_row(
                r#"
                SELECT m.id, e.provider, e.external_id, m.title, m.cover,
                       m.banner, m.total_episodes
                FROM media m
                JOIN external_identity e ON e.media_id = m.id AND e.scope = 'title'
                WHERE m.id = ?1
                ORDER BY CASE e.provider WHEN 'anilist' THEN 0 ELSE 1 END
                LIMIT 1
                "#,
                [media_id],
                map_stored_media,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn external_identity_list(&self, media_id: &str) -> Result<Vec<ExternalIdentity>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT media_id, provider, external_id, scope, confidence, verified_at
            FROM external_identity
            WHERE media_id = ?1
            ORDER BY verified_at DESC
            "#,
        )?;
        let rows = statement.query_map([media_id], |row| {
            Ok(ExternalIdentity {
                media_id: row.get(0)?,
                provider: row.get(1)?,
                external_id: row.get(2)?,
                scope: row.get(3)?,
                confidence: row.get(4)?,
                verified_at: row.get(5)?,
            })
        })?;
        let mut identities = Vec::new();
        for row in rows {
            identities.push(row?);
        }
        Ok(identities)
    }

    pub fn external_identity_upsert(
        &self,
        media_id: &str,
        provider: &str,
        external_id: &str,
        scope: &str,
        confidence: f64,
    ) -> Result<ExternalIdentity> {
        if provider.trim().is_empty() || external_id.trim().is_empty() || scope.trim().is_empty() {
            return Err(StoreError::Invalid(
                "provider, external ID, and scope are required".into(),
            ));
        }
        if !(0.0..=1.0).contains(&confidence) {
            return Err(StoreError::Invalid(
                "identity confidence must be between 0 and 1".into(),
            ));
        }
        self.connection.execute(
            r#"
            INSERT INTO external_identity
              (media_id, provider, external_id, scope, confidence)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(provider, external_id, scope) DO UPDATE SET
              media_id = excluded.media_id,
              confidence = excluded.confidence,
              verified_at = CURRENT_TIMESTAMP
            "#,
            params![media_id, provider, external_id, scope, confidence],
        )?;
        self.connection
            .query_row(
                r#"
                SELECT media_id, provider, external_id, scope, confidence, verified_at
                FROM external_identity
                WHERE media_id = ?1 AND provider = ?2 AND external_id = ?3 AND scope = ?4
                "#,
                params![media_id, provider, external_id, scope],
                |row| {
                    Ok(ExternalIdentity {
                        media_id: row.get(0)?,
                        provider: row.get(1)?,
                        external_id: row.get(2)?,
                        scope: row.get(3)?,
                        confidence: row.get(4)?,
                        verified_at: row.get(5)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn external_identity_remove(&self, media_id: &str, provider: &str) -> Result<()> {
        if provider == "anilist" {
            return Err(StoreError::Invalid(
                "the primary AniList identity cannot be removed".into(),
            ));
        }
        self.connection.execute(
            "DELETE FROM external_identity WHERE media_id = ?1 AND provider = ?2",
            params![media_id, provider],
        )?;
        Ok(())
    }

    pub fn library_add(&self, media_id: &str, status: LibraryStatus) -> Result<LibraryEntry> {
        self.connection.execute(
            r#"
            INSERT INTO library_entry (media_id, status)
            VALUES (?1, ?2)
            ON CONFLICT(media_id) DO UPDATE SET
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            "#,
            params![media_id, status.as_str()],
        )?;
        self.library_get(media_id)?
            .ok_or_else(|| StoreError::Invalid("failed to persist library entry".into()))
    }

    pub fn library_remove(&self, media_id: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM library_entry WHERE media_id = ?1", [media_id])?;
        Ok(())
    }

    pub fn library_get(&self, media_id: &str) -> Result<Option<LibraryEntry>> {
        self.connection
            .query_row(
                &library_select("WHERE l.media_id = ?1"),
                [media_id],
                map_library_entry,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn library_set_status(&self, media_id: &str, status: LibraryStatus) -> Result<()> {
        self.connection.execute(
            r#"
            UPDATE library_entry
            SET status = ?2, updated_at = CURRENT_TIMESTAMP
            WHERE media_id = ?1
            "#,
            params![media_id, status.as_str()],
        )?;
        Ok(())
    }

    pub fn library_list(&self, status: Option<&str>) -> Result<Vec<LibraryEntry>> {
        let mut entries = Vec::new();
        if let Some(status) = status {
            let status = LibraryStatus::parse(status)?.as_str();
            let mut statement = self.connection.prepare(&library_select(
                "WHERE l.status = ?1 ORDER BY l.updated_at DESC",
            ))?;
            let rows = statement.query_map([status], map_library_entry)?;
            for row in rows {
                entries.push(row?);
            }
        } else {
            let mut statement = self
                .connection
                .prepare(&library_select("ORDER BY l.updated_at DESC"))?;
            let rows = statement.query_map([], map_library_entry)?;
            for row in rows {
                entries.push(row?);
            }
        }
        Ok(entries)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn history_upsert(
        &self,
        media_id: &str,
        episode: i32,
        episode_title: &str,
        position: f64,
        duration: f64,
        source_id: Option<&str>,
    ) -> Result<()> {
        self.connection.execute(
            r#"
            INSERT INTO watch_history
              (media_id, episode, episode_title, position, duration, source_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(media_id, episode) DO UPDATE SET
              episode_title = excluded.episode_title,
              position = excluded.position,
              duration = excluded.duration,
              source_id = excluded.source_id,
              watched_at = CURRENT_TIMESTAMP
            "#,
            params![
                media_id,
                episode,
                episode_title,
                position,
                duration,
                source_id
            ],
        )?;
        Ok(())
    }

    pub fn history_list(&self, limit: i32, offset: i32) -> Result<Vec<WatchHistoryEntry>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT h.media_id, e.provider, e.external_id, h.episode, m.title,
                   h.episode_title, m.cover, h.position, h.duration, h.source_id,
                   h.watched_at
            FROM watch_history h
            JOIN media m ON m.id = h.media_id
            JOIN external_identity e
              ON e.media_id = h.media_id AND e.scope = 'title' AND e.provider = 'anilist'
            ORDER BY h.watched_at DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )?;
        let rows = statement.query_map(params![limit.max(1), offset.max(0)], |row| {
            Ok(WatchHistoryEntry {
                media_id: row.get(0)?,
                provider: row.get(1)?,
                external_id: row.get(2)?,
                episode: row.get(3)?,
                media_title: row.get(4)?,
                episode_title: row.get(5)?,
                cover: row.get(6)?,
                position: row.get(7)?,
                duration: row.get(8)?,
                source_id: row.get(9)?,
                watched_at: row.get(10)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub fn history_remove(&self, media_id: &str, episode: Option<i32>) -> Result<()> {
        if let Some(episode) = episode {
            self.connection.execute(
                "DELETE FROM watch_history WHERE media_id = ?1 AND episode = ?2",
                params![media_id, episode],
            )?;
        } else {
            self.connection
                .execute("DELETE FROM watch_history WHERE media_id = ?1", [media_id])?;
        }
        Ok(())
    }

    pub fn history_clear(&self) -> Result<()> {
        self.connection.execute("DELETE FROM watch_history", [])?;
        Ok(())
    }

    pub fn source_binding_get(
        &self,
        media_id: &str,
        source_id: &str,
    ) -> Result<Option<SourceBinding>> {
        self.connection
            .query_row(
                r#"
                SELECT media_id, source_id, remote_media_url, remote_title,
                       road_index, verified_at
                FROM source_binding
                WHERE media_id = ?1 AND source_id = ?2
                "#,
                params![media_id, source_id],
                map_source_binding,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn source_binding_list(&self, media_id: &str) -> Result<Vec<SourceBinding>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT media_id, source_id, remote_media_url, remote_title,
                   road_index, verified_at
            FROM source_binding
            WHERE media_id = ?1
            ORDER BY verified_at DESC
            "#,
        )?;
        let rows = statement.query_map([media_id], map_source_binding)?;
        let mut bindings = Vec::new();
        for row in rows {
            bindings.push(row?);
        }
        Ok(bindings)
    }

    pub fn source_binding_upsert(
        &self,
        media_id: &str,
        source_id: &str,
        remote_media_url: &str,
        remote_title: &str,
        road_index: i32,
    ) -> Result<SourceBinding> {
        self.connection.execute(
            r#"
            INSERT INTO source_binding
              (media_id, source_id, remote_media_url, remote_title, road_index)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(media_id, source_id) DO UPDATE SET
              remote_media_url = excluded.remote_media_url,
              remote_title = excluded.remote_title,
              road_index = excluded.road_index,
              verified_at = CURRENT_TIMESTAMP
            "#,
            params![
                media_id,
                source_id,
                remote_media_url,
                remote_title,
                road_index
            ],
        )?;
        self.source_binding_get(media_id, source_id)?
            .ok_or_else(|| StoreError::Invalid("failed to persist source binding".into()))
    }

    pub fn source_binding_remove(&self, media_id: &str, source_id: &str) -> Result<()> {
        self.connection.execute(
            "DELETE FROM source_binding WHERE media_id = ?1 AND source_id = ?2",
            params![media_id, source_id],
        )?;
        Ok(())
    }

    pub fn source_rule_upsert(&self, name: &str, rule_json: &str) -> Result<()> {
        self.connection.execute(
            r#"
            INSERT INTO source_rule (name, rule_json)
            VALUES (?1, ?2)
            ON CONFLICT(name) DO UPDATE SET
              rule_json = excluded.rule_json,
              installed_at = CURRENT_TIMESTAMP
            "#,
            params![name, rule_json],
        )?;
        Ok(())
    }

    pub fn source_rule_remove(&self, name: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM source_rule WHERE name = ?1", [name])?;
        Ok(())
    }

    pub fn source_rule_list(&self) -> Result<Vec<SourceRuleRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT name, rule_json, installed_at FROM source_rule ORDER BY installed_at",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(SourceRuleRecord {
                name: row.get(0)?,
                rule_json: row.get(1)?,
                installed_at: row.get(2)?,
            })
        })?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row?);
        }
        Ok(records)
    }
}

fn migrate(connection: &mut Connection) -> Result<()> {
    let transaction = connection.transaction()?;

    if !table_has_column(&transaction, "settings", "display_language")? {
        transaction.execute_batch(
            "ALTER TABLE settings ADD COLUMN display_language \
             TEXT NOT NULL DEFAULT 'en';",
        )?;
    }

    transaction.execute(
        r#"
        UPDATE settings
        SET display_language = ?1
        WHERE display_language NOT IN ('en', 'zh')
        "#,
        [DEFAULT_DISPLAY_LANGUAGE],
    )?;

    transaction.execute_batch(
        r#"
        INSERT OR IGNORE INTO source_binding
          (media_id, source_id, remote_media_url, remote_title, road_index, verified_at)
        SELECT media_id, 'builtin:age', remote_media_url, remote_title, road_index, verified_at
        FROM source_binding
        WHERE source_id = 'AGE动漫';

        DELETE FROM source_binding WHERE source_id = 'AGE动漫';

        UPDATE watch_history
        SET source_id = 'builtin:age'
        WHERE source_id = 'AGE动漫';
        "#,
    )?;

    let schema_version: i64 = transaction.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if schema_version < 3 {
        // Rebuild the CHECK constraint and merge legacy categories atomically.
        // Keep identities, timestamps and the independent watch history intact.
        transaction.execute_batch(
            r#"
            CREATE TABLE library_entry_v3 (
              media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
              status TEXT NOT NULL CHECK (status IN ('following', 'completed')),
              added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO library_entry_v3 (media_id, status, added_at, updated_at)
            SELECT media_id, CASE WHEN status = 'completed' THEN 'completed' ELSE 'following' END,
                   added_at, updated_at
            FROM library_entry;
            DROP TABLE library_entry;
            ALTER TABLE library_entry_v3 RENAME TO library_entry;
            "#,
        )?;
    }
    if schema_version < CURRENT_SCHEMA_VERSION {
        transaction.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    }

    transaction.commit()?;
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn map_stored_media(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredMedia> {
    Ok(StoredMedia {
        id: row.get(0)?,
        provider: row.get(1)?,
        external_id: row.get(2)?,
        title: row.get(3)?,
        cover: row.get(4)?,
        banner: row.get(5)?,
        total_episodes: row.get(6)?,
    })
}

fn library_select(suffix: &str) -> String {
    format!(
        r#"
        SELECT l.media_id, e.provider, e.external_id, m.title, m.cover,
               m.banner, m.total_episodes, l.status, l.added_at, l.updated_at
        FROM library_entry l
        JOIN media m ON m.id = l.media_id
        JOIN external_identity e
          ON e.media_id = l.media_id AND e.scope = 'title' AND e.provider = 'anilist'
        {suffix}
        "#
    )
}

fn map_library_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryEntry> {
    Ok(LibraryEntry {
        media_id: row.get(0)?,
        provider: row.get(1)?,
        external_id: row.get(2)?,
        title: row.get(3)?,
        cover: row.get(4)?,
        banner: row.get(5)?,
        total_episodes: row.get(6)?,
        status: row.get(7)?,
        added_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn map_source_binding(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceBinding> {
    Ok(SourceBinding {
        media_id: row.get(0)?,
        source_id: row.get(1)?,
        remote_media_url: row.get(2)?,
        remote_title: row.get(3)?,
        road_index: row.get(4)?,
        verified_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open(":memory:").expect("open in-memory V1 store")
    }

    fn media() -> CatalogMediaInput {
        CatalogMediaInput {
            provider: "anilist".into(),
            external_id: "21".into(),
            title: "One Piece".into(),
            cover: Some("https://example.com/cover.jpg".into()),
            banner: None,
            total_episodes: 1000,
        }
    }

    fn legacy_database_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("kuriume-store-migration-{}.db", Uuid::new_v4()))
    }

    #[test]
    fn new_database_uses_english_as_the_default_display_language() {
        let store = store();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.display_language, DEFAULT_DISPLAY_LANGUAGE);
        assert_eq!(
            store
                .connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn media_identity_keeps_a_stable_internal_uuid() {
        let store = store();
        let first = store.ensure_media(&media()).unwrap();
        let mut updated = media();
        updated.title = "ONE PIECE".into();
        let second = store.ensure_media(&updated).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.title, "ONE PIECE");
        assert_ne!(second.id, second.external_id);
    }

    #[test]
    fn library_history_binding_and_rules_round_trip() {
        let store = store();
        let media = store.ensure_media(&media()).unwrap();
        let entry = store
            .library_add(&media.id, LibraryStatus::Following)
            .unwrap();
        assert_eq!(entry.status, "following");

        store
            .history_upsert(&media.id, 3, "第 3 话", 120.0, 1440.0, Some("builtin:age"))
            .unwrap();
        let history = store.history_list(20, 0).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].episode, 3);

        store
            .source_binding_upsert(
                &media.id,
                "builtin:age",
                "https://www.agedm.io/detail/1",
                "One Piece",
                2,
            )
            .unwrap();
        assert_eq!(
            store
                .source_binding_get(&media.id, "builtin:age")
                .unwrap()
                .unwrap()
                .road_index,
            2
        );

        store
            .source_rule_upsert("test", "{\"name\":\"test\"}")
            .unwrap();
        assert_eq!(store.source_rule_list().unwrap().len(), 1);
        store.source_rule_remove("test").unwrap();
        assert!(store.source_rule_list().unwrap().is_empty());
    }

    #[test]
    fn tmdb_identity_requires_explicit_scope_and_preserves_anilist() {
        let store = store();
        let media = store.ensure_media(&media()).unwrap();
        let identity = store
            .external_identity_upsert(&media.id, "tmdb_tv", "37854", "s1", 1.0)
            .unwrap();
        assert_eq!(identity.scope, "s1");
        assert_eq!(store.external_identity_list(&media.id).unwrap().len(), 2);

        store
            .external_identity_remove(&media.id, "tmdb_tv")
            .unwrap();
        let identities = store.external_identity_list(&media.id).unwrap();
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].provider, "anilist");
        assert!(store
            .external_identity_remove(&media.id, "anilist")
            .is_err());
    }

    #[test]
    fn settings_reject_out_of_range_playback_values() {
        let store = store();
        assert!(store.set_default_volume(1.1).is_err());
        assert!(store.set_default_speed(0.1).is_err());
        store.set_default_volume(0.45).unwrap();
        store.set_default_speed(1.25).unwrap();
        store.set_display_language("zh").unwrap();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.default_volume, 0.45);
        assert_eq!(settings.default_speed, 1.25);
        assert_eq!(settings.display_language, "zh");
        assert!(store.set_display_language("zh-CN").is_err());
    }

    #[test]
    fn library_categories_merge_without_losing_history_or_identity() {
        let mut store = store();
        // Recreate the shipped v2 constraint, including every former category.
        store
            .connection
            .execute_batch(
                r#"
            DROP TABLE library_entry;
            CREATE TABLE library_entry (
              media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
              status TEXT NOT NULL CHECK (status IN ('watching', 'planned', 'completed', 'paused')),
              added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            PRAGMA user_version = 2;
            "#,
            )
            .unwrap();
        let mut ids = Vec::new();
        for (index, status) in ["watching", "planned", "paused", "completed"]
            .iter()
            .enumerate()
        {
            let mut input = media();
            input.external_id = index.to_string();
            let media = store.ensure_media(&input).unwrap();
            store.connection.execute(
                "INSERT INTO library_entry VALUES (?1, ?2, '2026-01-01 00:00:00', '2026-02-01 00:00:00')",
                params![media.id, status],
            ).unwrap();
            store
                .history_upsert(
                    &media.id,
                    3,
                    "Episode 3",
                    120.0,
                    1440.0,
                    Some("builtin:age"),
                )
                .unwrap();
            store
                .source_binding_upsert(
                    &media.id,
                    "builtin:age",
                    "https://age.example/1",
                    "One Piece",
                    2,
                )
                .unwrap();
            ids.push(media.id);
        }

        migrate(&mut store.connection).unwrap();
        migrate(&mut store.connection).unwrap(); // Opening again must be harmless.
        assert_eq!(store.library_list(Some("following")).unwrap().len(), 3);
        assert_eq!(store.library_list(Some("completed")).unwrap().len(), 1);
        assert_eq!(store.history_list(20, 0).unwrap().len(), 4);
        for (index, id) in ids.iter().enumerate() {
            let entry = store.library_get(id).unwrap().unwrap();
            assert_eq!(entry.media_id, *id);
            assert_eq!(entry.external_id, index.to_string());
            assert_eq!(
                entry.status,
                if index == 3 { "completed" } else { "following" }
            );
            assert_eq!(entry.added_at, "2026-01-01 00:00:00");
            assert_eq!(entry.updated_at, "2026-02-01 00:00:00");
            let history = store.history_list(20, 0).unwrap();
            let progress = history.iter().find(|entry| entry.media_id == *id).unwrap();
            assert_eq!((progress.episode, progress.position), (3, 120.0));
            assert_eq!(
                store
                    .source_binding_get(id, "builtin:age")
                    .unwrap()
                    .unwrap()
                    .road_index,
                2
            );
        }
        for retired in ["watching", "planned", "paused"] {
            assert!(LibraryStatus::parse(retired).is_err());
            assert!(store
                .connection
                .execute("UPDATE library_entry SET status = ?1", [retired])
                .is_err());
        }
        store
            .library_set_status(&ids[0], LibraryStatus::Completed)
            .unwrap();
        assert_eq!(store.library_list(Some("completed")).unwrap().len(), 2);
        store
            .library_set_status(&ids[0], LibraryStatus::Following)
            .unwrap();
        store.library_remove(&ids[0]).unwrap();
        assert!(store.library_get(&ids[0]).unwrap().is_none());
        assert_eq!(store.history_list(20, 0).unwrap().len(), 4);
    }

    #[test]
    fn old_schema_adds_language_setting_and_migrates_age_aliases() {
        let path = legacy_database_path();
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    r#"
                    CREATE TABLE settings (
                      id INTEGER PRIMARY KEY CHECK (id = 1),
                      default_volume REAL NOT NULL DEFAULT 0.8,
                      default_speed REAL NOT NULL DEFAULT 1.0,
                      auto_next INTEGER NOT NULL DEFAULT 1,
                      tmdb_api_token TEXT
                    );
                    INSERT INTO settings (id, tmdb_api_token)
                    VALUES (1, 'legacy-secret');

                    CREATE TABLE watch_history (
                      media_id TEXT NOT NULL,
                      episode INTEGER NOT NULL,
                      episode_title TEXT NOT NULL,
                      position REAL NOT NULL,
                      duration REAL NOT NULL,
                      source_id TEXT,
                      watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      PRIMARY KEY (media_id, episode)
                    );
                    INSERT INTO watch_history
                      (media_id, episode, episode_title, position, duration, source_id)
                    VALUES ('media-1', 1, '第 1 话', 0, 1200, 'AGE动漫');

                    CREATE TABLE source_binding (
                      media_id TEXT NOT NULL,
                      source_id TEXT NOT NULL,
                      remote_media_url TEXT NOT NULL,
                      remote_title TEXT NOT NULL,
                      road_index INTEGER NOT NULL DEFAULT 0,
                      verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      PRIMARY KEY (media_id, source_id)
                    );
                    INSERT INTO source_binding
                      (media_id, source_id, remote_media_url, remote_title, road_index)
                    VALUES
                      ('media-1', 'AGE动漫', 'https://age.example/legacy', 'Legacy', 1),
                      ('media-2', 'AGE动漫', 'https://age.example/duplicate', 'Old', 2),
                      ('media-2', 'builtin:age', 'https://age.example/canonical', 'Canonical', 3);

                    PRAGMA user_version = 0;
                    "#,
                )
                .unwrap();
        }

        let store = Store::open(&path).unwrap();
        assert_eq!(
            store.get_settings().unwrap().display_language,
            DEFAULT_DISPLAY_LANGUAGE
        );
        assert_eq!(
            store
                .source_binding_get("media-1", "builtin:age")
                .unwrap()
                .unwrap()
                .remote_media_url,
            "https://age.example/legacy"
        );
        assert_eq!(
            store
                .source_binding_get("media-2", "builtin:age")
                .unwrap()
                .unwrap()
                .remote_media_url,
            "https://age.example/canonical"
        );
        assert_eq!(
            store
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM source_binding WHERE source_id = 'AGE动漫'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .connection
                .query_row(
                    "SELECT source_id FROM watch_history WHERE media_id = 'media-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "builtin:age"
        );
        assert_eq!(
            store
                .connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );

        drop(store);
        std::fs::remove_file(path).unwrap();
    }
}
