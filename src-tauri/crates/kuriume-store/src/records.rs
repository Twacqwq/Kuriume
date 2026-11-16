//! The kuriume.records document: one JSON file that carries saved media,
//! identities, library entries, watch history, source bindings and settings so
//! a user can move them between devices.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::store::{Result, Settings, Store, StoreError, CURRENT_SCHEMA_VERSION};

pub const RECORDS_FORMAT: &str = "kuriume.records";
pub const RECORDS_FORMAT_VERSION: i64 = 1;
pub const MAX_IMPORT_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_ITEMS: usize = 5000;
pub const MAX_HISTORY_PER_ITEM: usize = 2000;
pub const MAX_TITLE_CHARS: usize = 512;
pub const MAX_URL_CHARS: usize = 2048;
pub const MAX_EPISODE: i32 = 100_000;
pub const MAX_SOURCE_ID_CHARS: usize = 512;

const CATALOG_PROVIDERS: [&str; 2] = ["anilist", "bangumi"];
const MEDIA_KINDS: [&str; 2] = ["anime", "manga"];
const BUILTIN_SOURCES: [&str; 4] = [
    "builtin:age",
    "builtin:anime1",
    "builtin:xifan",
    "builtin:hianime",
];

/// A full export/import document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordDocument {
    pub format: String,
    pub format_version: i64,
    pub schema_version: i64,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub sections: Vec<String>,
    #[serde(default)]
    pub counts: RecordCounts,
    #[serde(default)]
    pub settings: Option<Settings>,
    #[serde(default)]
    pub items: Vec<RecordItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecordCounts {
    #[serde(default)]
    pub items: usize,
    #[serde(default)]
    pub library: usize,
    #[serde(default)]
    pub history: usize,
    #[serde(default)]
    pub bindings: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordItem {
    pub media: DocumentMedia,
    #[serde(default)]
    pub identities: Vec<DocumentIdentity>,
    #[serde(default)]
    pub library: Option<DocumentLibrary>,
    #[serde(default)]
    pub history: Vec<DocumentHistory>,
    #[serde(default)]
    pub bindings: Vec<DocumentBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMedia {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub total_episodes: i32,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_kind() -> String {
    "anime".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentIdentity {
    pub provider: String,
    pub external_id: String,
    #[serde(default = "default_scope")]
    pub scope: String,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    #[serde(default)]
    pub verified_at: String,
}

fn default_scope() -> String {
    "title".into()
}

fn default_confidence() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentLibrary {
    pub status: String,
    pub added_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentHistory {
    pub episode: i32,
    #[serde(default)]
    pub episode_title: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub source_id: Option<String>,
    pub watched_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentBinding {
    pub source_id: String,
    #[serde(default)]
    pub remote_media_url: String,
    #[serde(default)]
    pub remote_title: String,
    #[serde(default)]
    pub road_index: i32,
    #[serde(default)]
    pub verified_at: String,
}

/// Outcome of an import, shown to the user.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportSummary {
    /// Items merged or written, including items that only refreshed history.
    pub written: usize,
    /// Items rejected by validation.
    pub skipped: usize,
    /// Items skipped because they would end up without a catalog identity.
    pub skipped_no_identity: usize,
    /// Timestamps that pointed further than five minutes into the future.
    pub fixed_timestamps: usize,
    /// Items folded into a media row that was already saved under another id.
    pub merged_items: usize,
    /// Distinct source ids in the file that this install has no source for.
    pub unknown_sources: usize,
    pub library: usize,
    pub history: usize,
    pub bindings: usize,
}

/// What the user is shown before confirming an import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub format_version: i64,
    pub schema_version: i64,
    pub app_version: String,
    pub exported_at: String,
    pub device_id: String,
    pub records_included: bool,
    pub settings_included: bool,
    pub items: usize,
    pub library: usize,
    pub history: usize,
    pub bindings: usize,
    pub file_counts: RecordCounts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    Merge,
    Overwrite,
}

impl ImportMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "merge" => Some(Self::Merge),
            "overwrite" => Some(Self::Overwrite),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Timestamp {
    year: i64,
    month: i64,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    epoch: i64,
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_position = (month + 9) % 12;
    let day_of_year = (153 * month_position + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Strict parse of the YYYY-MM-DD HH:MM:SS UTC format the database stores.
fn parse_timestamp(value: &str) -> Option<Timestamp> {
    let bytes = value.as_bytes();
    if bytes.len() != 19 {
        return None;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b' '
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let part = value.get(range)?;
        if !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let year = number(0..4)?;
    let month = number(5..7)?;
    let day = number(8..10)?;
    let hour = number(11..13)?;
    let minute = number(14..16)?;
    let second = number(17..19)?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let epoch = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(Timestamp {
        year,
        month,
        day,
        hour,
        minute,
        second,
        epoch,
    })
}

fn format_timestamp(timestamp: Timestamp) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        timestamp.year,
        timestamp.month,
        timestamp.day,
        timestamp.hour,
        timestamp.minute,
        timestamp.second
    )
}

/// Returns the text to store plus whether it was pushed back from the future.
fn normalize_timestamp(value: &str, now: Timestamp) -> Option<(String, bool)> {
    let parsed = parse_timestamp(value)?;
    if parsed.epoch > now.epoch + 300 {
        Some((format_timestamp(now), true))
    } else {
        Some((value.to_string(), false))
    }
}

fn validate_title(title: &str) -> bool {
    !title.trim().is_empty() && title.chars().count() <= MAX_TITLE_CHARS
}

fn validate_url(url: &str) -> bool {
    !url.is_empty() && url.chars().count() <= MAX_URL_CHARS
}

fn validate_document(document: &RecordDocument) -> Result<()> {
    if document.format != RECORDS_FORMAT {
        return Err(StoreError::Invalid(format!(
            "unsupported document format: {}",
            document.format
        )));
    }
    if document.format_version != RECORDS_FORMAT_VERSION {
        return Err(StoreError::Invalid(format!(
            "unsupported format version: {}",
            document.format_version
        )));
    }
    if document.schema_version < 1 || document.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(StoreError::Invalid(format!(
            "unsupported schema version: {}",
            document.schema_version
        )));
    }
    if document.items.len() > MAX_ITEMS {
        return Err(StoreError::Invalid(format!(
            "too many items: {}",
            document.items.len()
        )));
    }
    let has_records = has_records_section(document);
    let has_settings = has_settings_section(document);
    if !has_records && !has_settings {
        return Err(StoreError::Invalid("document has no known section".into()));
    }
    if !document.items.is_empty() && !has_records {
        return Err(StoreError::Invalid(
            "document carries items without the records section".into(),
        ));
    }
    if let Some(settings) = &document.settings {
        settings.validate()?;
    }
    Ok(())
}

fn has_records_section(document: &RecordDocument) -> bool {
    document.sections.iter().any(|section| section == "records")
}

fn has_settings_section(document: &RecordDocument) -> bool {
    document
        .sections
        .iter()
        .any(|section| section == "settings")
}

/// Inspect a document without touching the database.
pub fn preview_import(document: &RecordDocument) -> Result<ImportPreview> {
    validate_document(document)?;
    let mut library = 0;
    let mut history = 0;
    let mut bindings = 0;
    for item in &document.items {
        if item.library.is_some() {
            library += 1;
        }
        history += item.history.len();
        bindings += item.bindings.len();
    }
    Ok(ImportPreview {
        format_version: document.format_version,
        schema_version: document.schema_version,
        app_version: document.app_version.clone(),
        exported_at: document.exported_at.clone(),
        device_id: document.device_id.clone(),
        records_included: has_records_section(document),
        settings_included: has_settings_section(document) && document.settings.is_some(),
        items: document.items.len(),
        library,
        history,
        bindings,
        file_counts: document.counts.clone(),
    })
}

impl Store {
    fn now_utc(&self) -> Result<String> {
        let now: String = self.connection().query_row(
            "SELECT strftime('%Y-%m-%d %H:%M:%S', 'now')",
            [],
            |row| row.get(0),
        )?;
        Ok(now)
    }

    fn known_source_ids(&self) -> Result<HashSet<String>> {
        let mut sources: HashSet<String> =
            BUILTIN_SOURCES.iter().map(|id| id.to_string()).collect();
        let mut statement = self
            .connection()
            .prepare("SELECT rule_json FROM source_rule")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows {
            let rules: Vec<serde_json::Value> = match serde_json::from_str(&row?) {
                Ok(value) => value,
                Err(_) => continue,
            };
            for rule in rules {
                if let Some(id) = rule.get("id").and_then(|value| value.as_str()) {
                    sources.insert(id.to_string());
                }
            }
        }
        Ok(sources)
    }

    /// Build a document from the local database.
    pub fn export_records(
        &self,
        app_version: &str,
        device_id: &str,
        include_records: bool,
        include_settings: bool,
    ) -> Result<RecordDocument> {
        if !include_records && !include_settings {
            return Err(StoreError::Invalid("nothing selected for export".into()));
        }
        let exported_at = self.now_utc()?;
        let mut sections = Vec::new();
        if include_records {
            sections.push("records".to_string());
        }
        if include_settings {
            sections.push("settings".to_string());
        }

        let mut items = Vec::new();
        let mut counts = RecordCounts::default();
        if include_records {
            let mut statement = self.connection().prepare(
                r#"
                SELECT DISTINCT m.id, m.title, m.cover, m.banner, m.total_episodes, m.kind,
                                m.created_at, m.updated_at
                FROM media m
                JOIN external_identity e ON e.media_id = m.id AND e.scope = 'title'
                WHERE e.provider IN ('anilist', 'bangumi')
                ORDER BY m.title COLLATE NOCASE, m.id
                "#,
            )?;
            let media_rows = statement
                .query_map([], |row| {
                    Ok(DocumentMedia {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        cover: row.get(2)?,
                        banner: row.get(3)?,
                        total_episodes: row.get(4)?,
                        kind: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);

            for media in media_rows {
                let identities = self.export_identities(&media.id)?;
                let library = self.export_library(&media.id)?;
                let history = self.export_history(&media.id)?;
                let bindings = self.export_bindings(&media.id)?;
                if library.is_some() {
                    counts.library += 1;
                }
                counts.history += history.len();
                counts.bindings += bindings.len();
                items.push(RecordItem {
                    media,
                    identities,
                    library,
                    history,
                    bindings,
                });
            }
            counts.items = items.len();
        }

        let settings = if include_settings {
            Some(self.get_settings()?)
        } else {
            None
        };

        Ok(RecordDocument {
            format: RECORDS_FORMAT.to_string(),
            format_version: RECORDS_FORMAT_VERSION,
            schema_version: CURRENT_SCHEMA_VERSION,
            app_version: app_version.to_string(),
            exported_at,
            device_id: device_id.to_string(),
            sections,
            counts,
            settings,
            items,
        })
    }

    fn export_identities(&self, media_id: &str) -> Result<Vec<DocumentIdentity>> {
        let mut statement = self.connection().prepare(
            r#"
            SELECT provider, external_id, scope, confidence, verified_at
            FROM external_identity
            WHERE media_id = ?1 AND scope = 'title' AND provider IN ('anilist', 'bangumi')
            ORDER BY provider, external_id
            "#,
        )?;
        let rows = statement.query_map([media_id], |row| {
            Ok(DocumentIdentity {
                provider: row.get(0)?,
                external_id: row.get(1)?,
                scope: row.get(2)?,
                confidence: row.get(3)?,
                verified_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn export_library(&self, media_id: &str) -> Result<Option<DocumentLibrary>> {
        let row = self
            .connection()
            .query_row(
                "SELECT status, added_at, updated_at, deleted_at FROM library_entry WHERE media_id = ?1",
                [media_id],
                |row| {
                    Ok(DocumentLibrary {
                        status: row.get(0)?,
                        added_at: row.get(1)?,
                        updated_at: row.get(2)?,
                        deleted_at: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    fn export_history(&self, media_id: &str) -> Result<Vec<DocumentHistory>> {
        let mut statement = self.connection().prepare(
            r#"
            SELECT episode, episode_title, position, duration, source_id, watched_at, deleted_at
            FROM watch_history
            WHERE media_id = ?1
            ORDER BY episode
            "#,
        )?;
        let rows = statement.query_map([media_id], |row| {
            Ok(DocumentHistory {
                episode: row.get(0)?,
                episode_title: row.get(1)?,
                position: row.get(2)?,
                duration: row.get(3)?,
                source_id: row.get(4)?,
                watched_at: row.get(5)?,
                deleted_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn export_bindings(&self, media_id: &str) -> Result<Vec<DocumentBinding>> {
        let mut statement = self.connection().prepare(
            r#"
            SELECT source_id, remote_media_url, remote_title, road_index, verified_at
            FROM source_binding
            WHERE media_id = ?1
            ORDER BY source_id
            "#,
        )?;
        let rows = statement.query_map([media_id], |row| {
            Ok(DocumentBinding {
                source_id: row.get(0)?,
                remote_media_url: row.get(1)?,
                remote_title: row.get(2)?,
                road_index: row.get(3)?,
                verified_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Merge a document into the database, or replace the records it carries.
    pub fn import_records(
        &mut self,
        document: &RecordDocument,
        mode: ImportMode,
    ) -> Result<ImportSummary> {
        validate_document(document)?;
        let now = parse_timestamp(&self.now_utc()?)
            .ok_or_else(|| StoreError::Invalid("current time is unreadable".into()))?;
        let known_sources = self.known_source_ids()?;
        let replace_records = mode == ImportMode::Overwrite && has_records_section(document);

        let connection = self.connection_mut();
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut summary = ImportSummary::default();

        if replace_records {
            transaction.execute("DELETE FROM library_entry", [])?;
            transaction.execute("DELETE FROM watch_history", [])?;
            transaction.execute("DELETE FROM source_binding", [])?;
            transaction.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS kuriume_import_media (id TEXT PRIMARY KEY); \
                 DELETE FROM kuriume_import_media;",
            )?;
        }

        let mut identity_owner: HashMap<(String, String), String> = HashMap::new();
        {
            let mut statement = transaction.prepare(
                r#"
                SELECT provider, external_id, media_id
                FROM external_identity
                WHERE scope = 'title' AND provider IN ('anilist', 'bangumi')
                "#,
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                    row.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (key, media_id) = row?;
                identity_owner.insert(key, media_id);
            }
        }

        // Media without a catalog identity can still be matched by exact title.
        let mut title_index: HashMap<(String, String), Option<String>> = HashMap::new();
        {
            let mut statement = transaction.prepare(
                r#"
                SELECT m.id, m.kind, m.title
                FROM media m
                WHERE NOT EXISTS (
                  SELECT 1 FROM external_identity e
                  WHERE e.media_id = m.id AND e.scope = 'title'
                    AND e.provider IN ('anilist', 'bangumi')
                )
                "#,
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (id, kind, title) = row?;
                title_index
                    .entry((kind, title))
                    .and_modify(|slot| {
                        if slot.as_deref() != Some(id.as_str()) {
                            *slot = None;
                        }
                    })
                    .or_insert(Some(id));
            }
        }

        let mut unknown_sources: HashSet<String> = HashSet::new();

        for item in &document.items {
            let title = item.media.title.trim();
            if !validate_title(title) {
                summary.skipped += 1;
                continue;
            }
            if !MEDIA_KINDS.contains(&item.media.kind.as_str()) {
                summary.skipped += 1;
                continue;
            }
            if item.media.total_episodes < 0 {
                summary.skipped += 1;
                continue;
            }

            let created_at = match normalize_timestamp(&item.media.created_at, now) {
                Some((value, fixed)) => {
                    if fixed {
                        summary.fixed_timestamps += 1;
                    }
                    value
                }
                None => {
                    summary.skipped += 1;
                    continue;
                }
            };
            let updated_at = match normalize_timestamp(&item.media.updated_at, now) {
                Some((value, fixed)) => {
                    if fixed {
                        summary.fixed_timestamps += 1;
                    }
                    value
                }
                None => {
                    summary.skipped += 1;
                    continue;
                }
            };

            // Reject an oversized item before anything belonging to it is written.
            if item.history.len() > MAX_HISTORY_PER_ITEM {
                summary.skipped += 1;
                continue;
            }

            // Only catalog title identities are meaningful across devices.
            let mut identities: Vec<(String, String, f64, String)> = Vec::new();
            for identity in &item.identities {
                if identity.scope != "title"
                    || !CATALOG_PROVIDERS.contains(&identity.provider.as_str())
                {
                    continue;
                }
                if identity.external_id.trim().is_empty()
                    || identity.external_id.chars().count() > MAX_TITLE_CHARS
                {
                    continue;
                }
                if !(0.0..=1.0).contains(&identity.confidence) {
                    continue;
                }
                let verified_at = match normalize_timestamp(&identity.verified_at, now) {
                    Some((value, fixed)) => {
                        if fixed {
                            summary.fixed_timestamps += 1;
                        }
                        value
                    }
                    None => continue,
                };
                identities.push((
                    identity.provider.clone(),
                    identity.external_id.trim().to_string(),
                    identity.confidence,
                    verified_at,
                ));
            }

            let owners: HashSet<String> = identities
                .iter()
                .filter_map(|(provider, external_id, _, _)| {
                    identity_owner
                        .get(&(provider.clone(), external_id.clone()))
                        .cloned()
                })
                .collect();
            if owners.len() > 1 {
                summary.skipped += 1;
                continue;
            }

            let mut target = owners.into_iter().next();
            let mut merged = false;
            if target.is_none() {
                let key = (item.media.kind.clone(), title.to_string());
                match title_index.get(&key) {
                    Some(Some(id)) => target = Some(id.clone()),
                    Some(None) => {
                        // Two local media rows share this title; do not guess.
                        summary.skipped += 1;
                        continue;
                    }
                    None => {}
                }
            } else if target.as_deref() != Some(item.media.id.as_str()) {
                merged = true;
            }

            if target.is_none() && identities.is_empty() {
                summary.skipped_no_identity += 1;
                continue;
            }
            if let Some(existing) = &target {
                let has_identity: i64 = transaction.query_row(
                    r#"
                    SELECT COUNT(*) FROM external_identity
                    WHERE media_id = ?1 AND scope = 'title' AND provider IN ('anilist', 'bangumi')
                    "#,
                    [existing],
                    |row| row.get(0),
                )?;
                if has_identity == 0 && identities.is_empty() {
                    summary.skipped_no_identity += 1;
                    continue;
                }
            }

            let media_id = match target {
                Some(id) => id,
                None => {
                    let candidate = Uuid::parse_str(&item.media.id)
                        .ok()
                        .map(|value| value.to_string())
                        .unwrap_or_default();
                    let candidate_exists: bool = transaction
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM media WHERE id = ?1)",
                            [candidate.as_str()],
                            |row| row.get::<_, i64>(0),
                        )
                        .map(|value| value == 1)?;
                    let id = if !candidate.is_empty() && !candidate_exists {
                        candidate
                    } else {
                        Uuid::new_v4().to_string()
                    };
                    transaction.execute(
                        r#"
                        INSERT INTO media (id, title, cover, banner, total_episodes, kind, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                        "#,
                        params![
                            id,
                            title,
                            normalize_optional_url(&item.media.cover),
                            normalize_optional_url(&item.media.banner),
                            item.media.total_episodes,
                            item.media.kind,
                            created_at,
                            updated_at
                        ],
                    )?;
                    id
                }
            };

            if merged {
                summary.merged_items += 1;
            }

            if replace_records {
                transaction.execute(
                    "INSERT OR IGNORE INTO kuriume_import_media (id) VALUES (?1)",
                    [&media_id],
                )?;
            }

            // Fill gaps on an existing row; never overwrite local catalog data.
            let existing_media: Option<(Option<String>, Option<String>, i32)> = transaction
                .query_row(
                    "SELECT cover, banner, total_episodes FROM media WHERE id = ?1",
                    [&media_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if let Some((cover, banner, total_episodes)) = existing_media {
                let cover = cover.or_else(|| normalize_optional_url(&item.media.cover));
                let banner = banner.or_else(|| normalize_optional_url(&item.media.banner));
                let total_episodes = if total_episodes == 0 {
                    item.media.total_episodes.max(0)
                } else {
                    total_episodes
                };
                transaction.execute(
                    "UPDATE media SET cover = ?2, banner = ?3, total_episodes = ?4 WHERE id = ?1",
                    params![&media_id, cover, banner, total_episodes],
                )?;
            }

            for (provider, external_id, confidence, verified_at) in &identities {
                let inserted = transaction.execute(
                    r#"
                    INSERT INTO external_identity (media_id, provider, external_id, scope, confidence, verified_at)
                    VALUES (?1, ?2, ?3, 'title', ?4, ?5)
                    ON CONFLICT(provider, external_id, scope) DO NOTHING
                    "#,
                    params![&media_id, provider, external_id, confidence, verified_at],
                )?;
                if inserted == 1 {
                    identity_owner
                        .insert((provider.clone(), external_id.clone()), media_id.clone());
                }
            }

            if let Some(library) = &item.library {
                let status_ok = matches!(library.status.as_str(), "following" | "completed");
                let added_at = normalize_timestamp(&library.added_at, now);
                let updated = normalize_timestamp(&library.updated_at, now);
                let deleted_at =
                    match normalize_deleted_at(library.deleted_at.as_deref(), now, &mut summary) {
                        Ok(value) => value,
                        Err(()) => {
                            summary.skipped += 1;
                            continue;
                        }
                    };
                match (added_at, updated) {
                    (Some((added_at, added_fixed)), Some((updated_at, updated_fixed)))
                        if status_ok =>
                    {
                        if added_fixed {
                            summary.fixed_timestamps += 1;
                        }
                        if updated_fixed {
                            summary.fixed_timestamps += 1;
                        }
                        let local: Option<(String, String)> = transaction
                            .query_row(
                                "SELECT added_at, updated_at FROM library_entry WHERE media_id = ?1",
                                [&media_id],
                                |row| Ok((row.get(0)?, row.get(1)?)),
                            )
                            .optional()?;
                        match local {
                            None => {
                                transaction.execute(
                                    r#"
                                    INSERT INTO library_entry (media_id, status, added_at, updated_at, deleted_at)
                                    VALUES (?1, ?2, ?3, ?4, ?5)
                                    "#,
                                    params![&media_id, &library.status, added_at, updated_at, deleted_at],
                                )?;
                                summary.library += 1;
                            }
                            Some((local_added, local_updated)) => {
                                if local_updated.as_str() < updated_at.as_str() {
                                    let added = if local_added.as_str() < added_at.as_str() {
                                        local_added
                                    } else {
                                        added_at
                                    };
                                    transaction.execute(
                                        r#"
                                        UPDATE library_entry
                                        SET status = ?2, added_at = ?3, updated_at = ?4, deleted_at = ?5
                                        WHERE media_id = ?1
                                        "#,
                                        params![&media_id, &library.status, added, updated_at, deleted_at],
                                    )?;
                                    summary.library += 1;
                                }
                            }
                        }
                    }
                    _ => {
                        summary.skipped += 1;
                        continue;
                    }
                }
            }

            for history in &item.history {
                if !(1..=MAX_EPISODE).contains(&history.episode) {
                    continue;
                }
                if !history.position.is_finite() || history.position < 0.0 {
                    continue;
                }
                if !history.duration.is_finite() || history.duration < 0.0 {
                    continue;
                }
                if history.duration > 0.0 && history.position > history.duration + 1000.0 {
                    continue;
                }
                if history.episode_title.chars().count() > MAX_TITLE_CHARS {
                    continue;
                }
                let watched_at = match normalize_timestamp(&history.watched_at, now) {
                    Some((value, fixed)) => {
                        if fixed {
                            summary.fixed_timestamps += 1;
                        }
                        value
                    }
                    None => continue,
                };
                let deleted_at =
                    match normalize_deleted_at(history.deleted_at.as_deref(), now, &mut summary) {
                        Ok(value) => value,
                        Err(()) => continue,
                    };
                let source_id = history
                    .source_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| {
                        !value.is_empty() && value.chars().count() <= MAX_SOURCE_ID_CHARS
                    })
                    .map(str::to_string);
                let local: Option<String> = transaction
                    .query_row(
                        "SELECT watched_at FROM watch_history WHERE media_id = ?1 AND episode = ?2",
                        params![&media_id, history.episode],
                        |row| row.get(0),
                    )
                    .optional()?;
                match local {
                    None => {
                        transaction.execute(
                            r#"
                            INSERT INTO watch_history
                              (media_id, episode, episode_title, position, duration, source_id, watched_at, deleted_at)
                            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                            "#,
                            params![
                                &media_id,
                                history.episode,
                                history.episode_title,
                                history.position,
                                history.duration,
                                source_id,
                                watched_at,
                                deleted_at
                            ],
                        )?;
                        summary.history += 1;
                    }
                    Some(local_watched) => {
                        if local_watched.as_str() < watched_at.as_str() {
                            transaction.execute(
                                r#"
                                UPDATE watch_history
                                SET episode_title = ?3, position = ?4, duration = ?5, source_id = ?6,
                                    watched_at = ?7, deleted_at = ?8
                                WHERE media_id = ?1 AND episode = ?2
                                "#,
                                params![
                                    &media_id,
                                    history.episode,
                                    history.episode_title,
                                    history.position,
                                    history.duration,
                                    source_id,
                                    watched_at,
                                    deleted_at
                                ],
                            )?;
                            summary.history += 1;
                        }
                    }
                }
            }

            for binding in &item.bindings {
                if binding.source_id.trim().is_empty()
                    || binding.source_id.chars().count() > MAX_SOURCE_ID_CHARS
                {
                    continue;
                }
                if !validate_url(&binding.remote_media_url)
                    || binding.remote_title.chars().count() > MAX_TITLE_CHARS
                    || binding.road_index < 0
                {
                    continue;
                }
                let verified_at = match normalize_timestamp(&binding.verified_at, now) {
                    Some((value, fixed)) => {
                        if fixed {
                            summary.fixed_timestamps += 1;
                        }
                        value
                    }
                    None => continue,
                };
                let inserted = transaction.execute(
                    r#"
                    INSERT INTO source_binding
                      (media_id, source_id, remote_media_url, remote_title, road_index, verified_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(media_id, source_id) DO NOTHING
                    "#,
                    params![
                        &media_id,
                        binding.source_id.trim(),
                        binding.remote_media_url,
                        binding.remote_title,
                        binding.road_index,
                        verified_at
                    ],
                )?;
                if inserted == 1 {
                    summary.bindings += 1;
                }
                if !known_sources.contains(binding.source_id.trim()) {
                    unknown_sources.insert(binding.source_id.trim().to_string());
                }
            }

            summary.written += 1;
        }

        if replace_records {
            transaction.execute(
                "DELETE FROM media WHERE id NOT IN (SELECT id FROM kuriume_import_media)",
                [],
            )?;
            transaction.execute("DROP TABLE kuriume_import_media", [])?;
        }

        if mode == ImportMode::Overwrite && has_settings_section(document) {
            if let Some(settings) = &document.settings {
                transaction.execute(
                    r#"
                    UPDATE settings
                    SET default_volume = ?1, default_speed = ?2, auto_next = ?3,
                        display_language = ?4, catalog_source = ?5
                    WHERE id = 1
                    "#,
                    params![
                        settings.default_volume,
                        settings.default_speed,
                        i64::from(settings.auto_next),
                        settings.display_language,
                        settings.catalog_source
                    ],
                )?;
            }
        }

        transaction.commit()?;
        summary.unknown_sources = unknown_sources.len();
        Ok(summary)
    }
}

fn normalize_optional_url(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|url| validate_url(url))
        .map(str::to_string)
}

fn normalize_deleted_at(
    value: Option<&str>,
    now: Timestamp,
    summary: &mut ImportSummary,
) -> std::result::Result<Option<String>, ()> {
    match value {
        None => Ok(None),
        Some(text) => match parse_timestamp(text) {
            None => Err(()),
            Some(parsed) if parsed.epoch > now.epoch + 300 => {
                summary.fixed_timestamps += 1;
                Ok(Some(format_timestamp(now)))
            }
            Some(_) => Ok(Some(text.to_string())),
        },
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open(":memory:").expect("open in-memory store")
    }

    fn account_media(id: &str, title: &str) -> DocumentMedia {
        DocumentMedia {
            id: id.into(),
            title: title.into(),
            cover: None,
            banner: None,
            total_episodes: 12,
            kind: "anime".into(),
            created_at: "2026-01-01 00:00:00".into(),
            updated_at: "2026-01-01 00:00:00".into(),
        }
    }

    fn identity(provider: &str, external_id: &str) -> DocumentIdentity {
        DocumentIdentity {
            provider: provider.into(),
            external_id: external_id.into(),
            scope: "title".into(),
            confidence: 1.0,
            verified_at: "2026-01-01 00:00:00".into(),
        }
    }

    fn library(status: &str, updated_at: &str) -> DocumentLibrary {
        DocumentLibrary {
            status: status.into(),
            added_at: "2026-01-01 00:00:00".into(),
            updated_at: updated_at.into(),
            deleted_at: None,
        }
    }

    fn history(episode: i32, watched_at: &str) -> DocumentHistory {
        DocumentHistory {
            episode,
            episode_title: format!("Episode {episode}"),
            position: 60.0,
            duration: 1400.0,
            source_id: Some("builtin:age".into()),
            watched_at: watched_at.into(),
            deleted_at: None,
        }
    }

    fn document(items: Vec<RecordItem>) -> RecordDocument {
        RecordDocument {
            format: RECORDS_FORMAT.into(),
            format_version: RECORDS_FORMAT_VERSION,
            schema_version: CURRENT_SCHEMA_VERSION,
            app_version: "test".into(),
            exported_at: "2026-06-01 00:00:00".into(),
            device_id: "device-a".into(),
            sections: vec!["records".into(), "settings".into()],
            counts: RecordCounts::default(),
            settings: None,
            items,
        }
    }

    fn valid_settings() -> Settings {
        Settings {
            default_volume: 0.5,
            default_speed: 1.0,
            auto_next: true,
            display_language: "zh".into(),
            catalog_source: "anilist".into(),
        }
    }

    fn seed_media(store: &Store) -> String {
        let media = store
            .ensure_media(&crate::store::CatalogMediaInput {
                provider: "anilist".into(),
                external_id: "21".into(),
                title: "One Piece".into(),
                cover: None,
                banner: None,
                total_episodes: 1000,
                kind: "anime".into(),
            })
            .unwrap();
        media.id
    }

    #[test]
    fn merge_roundtrip_carries_deletions_and_keeps_local_progress() {
        let source = store();
        let media_id = seed_media(&source);
        source
            .library_add(&media_id, crate::store::LibraryStatus::Following)
            .unwrap();
        source
            .history_upsert(
                &media_id,
                1,
                "Episode 1",
                100.0,
                1400.0,
                Some("builtin:age"),
            )
            .unwrap();
        source
            .history_upsert(
                &media_id,
                2,
                "Episode 2",
                200.0,
                1400.0,
                Some("builtin:age"),
            )
            .unwrap();
        source.history_remove(&media_id, Some(2)).unwrap();

        let exported = source
            .export_records("0.4.1", "device-a", true, false)
            .unwrap();
        assert_eq!(exported.sections, vec!["records"]);
        assert_eq!(exported.items.len(), 1);
        assert_eq!(exported.items[0].history.len(), 2);
        assert!(exported.items[0]
            .history
            .iter()
            .any(|row| row.deleted_at.is_some()));

        let mut target = store();
        let mut summary = target.import_records(&exported, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.skipped, 0);
        summary = target.import_records(&exported, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);

        let entry = target.library_get(&media_id).unwrap().unwrap();
        assert_eq!(entry.status, "following");
        let rows = target.history_list(20, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].episode, 1);

        // A newer local progress row must survive an older file row.
        target
            .history_upsert(
                &media_id,
                1,
                "Episode 1",
                900.0,
                1400.0,
                Some("builtin:age"),
            )
            .unwrap();
        let mut older = document(vec![RecordItem {
            media: account_media(&media_id, "One Piece"),
            identities: vec![identity("anilist", "21")],
            library: Some(library("completed", "2026-01-02 00:00:00")),
            history: vec![history(1, "2026-01-02 00:00:00")],
            bindings: Vec::new(),
        }]);
        older.settings = None;
        let summary = target.import_records(&older, ImportMode::Merge).unwrap();
        assert_eq!(summary.history, 0);
        assert_eq!(
            target.library_get(&media_id).unwrap().unwrap().status,
            "following"
        );
        let rows = target.history_list(20, 0).unwrap();
        assert_eq!(rows[0].position, 900.0);
    }

    #[test]
    fn overwrite_replaces_records_and_applies_settings() {
        let source = store();
        let media_id = seed_media(&source);
        source
            .library_add(&media_id, crate::store::LibraryStatus::Completed)
            .unwrap();
        source
            .history_upsert(&media_id, 3, "Episode 3", 60.0, 1400.0, None)
            .unwrap();
        let mut exported = source
            .export_records("0.4.1", "device-a", true, true)
            .unwrap();
        exported.settings = Some(valid_settings());

        let mut target = store();
        let stale = target
            .ensure_media(&crate::store::CatalogMediaInput {
                provider: "anilist".into(),
                external_id: "99".into(),
                title: "Stale".into(),
                cover: None,
                banner: None,
                total_episodes: 1,
                kind: "anime".into(),
            })
            .unwrap();
        target
            .library_add(&stale.id, crate::store::LibraryStatus::Following)
            .unwrap();
        target.set_default_volume(0.9).unwrap();

        let summary = target
            .import_records(&exported, ImportMode::Overwrite)
            .unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(target.library_list(None).unwrap().len(), 1);
        assert_eq!(target.history_list(20, 0).unwrap().len(), 1);
        assert!(target.get_media(&stale.id).unwrap().is_none());
        assert_eq!(target.get_settings().unwrap().default_volume, 0.5);
        assert!(target.get_settings().unwrap().auto_next);
    }

    #[test]
    fn item_without_catalog_identity_is_skipped() {
        let mut record = document(vec![RecordItem {
            media: account_media("new-id", "No Identity Show"),
            identities: Vec::new(),
            library: Some(library("following", "2026-01-02 00:00:00")),
            history: vec![history(1, "2026-01-02 00:00:00")],
            bindings: Vec::new(),
        }]);
        record.sections = vec!["records".into()];
        let mut target = store();
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.skipped_no_identity, 1);
        assert_eq!(summary.written, 0);
        assert!(target.library_list(None).unwrap().is_empty());
    }

    #[test]
    fn future_timestamps_are_pulled_back_to_now() {
        let mut record = document(vec![RecordItem {
            media: DocumentMedia {
                created_at: "2999-01-01 00:00:00".into(),
                updated_at: "2999-01-01 00:00:00".into(),
                ..account_media("future-id", "Future Show")
            },
            identities: vec![identity("bangumi", "555")],
            library: None,
            history: Vec::new(),
            bindings: Vec::new(),
        }]);
        record.sections = vec!["records".into()];
        let mut target = store();
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.fixed_timestamps, 2);
        let stored: String = target
            .connection()
            .query_row(
                "SELECT created_at FROM media WHERE title = 'Future Show'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored.as_str() < "2030");
    }

    #[test]
    fn invalid_settings_reject_the_whole_document() {
        let mut record = document(Vec::new());
        let mut settings = valid_settings();
        settings.default_volume = 2.0;
        record.settings = Some(settings);
        let mut target = store();
        let error = target
            .import_records(&record, ImportMode::Overwrite)
            .unwrap_err();
        assert!(error.to_string().contains("default_volume"));
        assert_ne!(target.get_settings().unwrap().default_volume, 2.0);
    }

    #[test]
    fn anonymous_media_is_reused_by_exact_title() {
        let mut target = store();
        let anonymous_id = Uuid::new_v4().to_string();
        target
            .connection()
            .execute(
                r#"
                INSERT INTO media (id, title, total_episodes, kind)
                VALUES (?1, 'Lonely Show', 12, 'anime')
                "#,
                [anonymous_id.as_str()],
            )
            .unwrap();
        let item = RecordItem {
            media: account_media("file-id", "Lonely Show"),
            identities: vec![identity("anilist", "777")],
            library: Some(library("following", "2026-01-02 00:00:00")),
            history: Vec::new(),
            bindings: Vec::new(),
        };
        let mut record = document(vec![item]);
        record.sections = vec!["records".into()];
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.library, 1);
        let owner: String = target
            .connection()
            .query_row(
                "SELECT media_id FROM external_identity WHERE provider = 'anilist' AND external_id = '777'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, anonymous_id);
    }

    #[test]
    fn oversized_history_skips_the_item_before_writing() {
        let mut target = store();
        let history: Vec<DocumentHistory> = (1..=MAX_HISTORY_PER_ITEM + 1)
            .map(|episode| DocumentHistory {
                episode: episode as i32,
                episode_title: format!("Episode {episode:04}"),
                position: 0.0,
                duration: 1440.0,
                source_id: None,
                watched_at: "2026-01-02 00:00:00".into(),
                deleted_at: None,
            })
            .collect();
        let item = RecordItem {
            media: account_media("big-item", "Too Much History"),
            identities: vec![identity("anilist", "900")],
            library: Some(library("following", "2026-01-02 00:00:00")),
            history,
            bindings: Vec::new(),
        };
        let mut record = document(vec![item]);
        record.sections = vec!["records".into()];
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.written, 0);
        assert_eq!(summary.library, 0);
        let media_rows: i64 = target
            .connection()
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .unwrap();
        assert_eq!(media_rows, 0);
    }

    #[test]
    fn timestamp_parser_rejects_impossible_dates() {
        assert!(parse_timestamp("2026-02-29 00:00:00").is_none());
        assert!(parse_timestamp("2024-02-29 00:00:00").is_some());
        assert!(parse_timestamp("2026-13-01 00:00:00").is_none());
        assert!(parse_timestamp("2026-01-01 24:00:00").is_none());
        assert!(parse_timestamp("2026-1-1 00:00:00").is_none());
        assert!(parse_timestamp("").is_none());
    }

    #[test]
    fn roundtrip_preserves_every_recorded_field() {
        let source = store();
        let media = source
            .ensure_media(&crate::store::CatalogMediaInput {
                provider: "anilist".into(),
                external_id: "4242".into(),
                title: "Field Show".into(),
                cover: Some("https://example.com/cover.jpg".into()),
                banner: Some("https://example.com/banner.jpg".into()),
                total_episodes: 24,
                kind: "anime".into(),
            })
            .unwrap();
        source
            .library_add(&media.id, crate::store::LibraryStatus::Following)
            .unwrap();
        source
            .history_upsert(
                &media.id,
                5,
                "Episode 5",
                12.5,
                1420.25,
                Some("builtin:xifan"),
            )
            .unwrap();
        source
            .source_binding_upsert(
                &media.id,
                "builtin:xifan",
                "https://example.com/play/5",
                "Road 2",
                2,
            )
            .unwrap();

        let exported = source
            .export_records("0.4.1", "device-a", true, true)
            .unwrap();
        let mut target = store();
        target.import_records(&exported, ImportMode::Merge).unwrap();
        let reexported = target
            .export_records("0.4.1", "device-a", true, true)
            .unwrap();

        assert_eq!(
            serde_json::to_value(&exported.items).unwrap(),
            serde_json::to_value(&reexported.items).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&exported.settings).unwrap(),
            serde_json::to_value(&reexported.settings).unwrap()
        );

        let item = &reexported.items[0];
        assert_eq!(
            item.media.cover.as_deref(),
            Some("https://example.com/cover.jpg")
        );
        assert_eq!(
            item.media.banner.as_deref(),
            Some("https://example.com/banner.jpg")
        );
        assert_eq!(item.media.total_episodes, 24);
        assert_eq!(item.identities.len(), 1);
        assert_eq!(item.identities[0].confidence, 1.0);
        assert_eq!(item.history.len(), 1);
        assert_eq!(item.history[0].position, 12.5);
        assert_eq!(item.history[0].duration, 1420.25);
        assert_eq!(item.bindings.len(), 1);
        assert_eq!(item.bindings[0].road_index, 2);
        assert_eq!(item.bindings[0].remote_title, "Road 2");
    }

    #[test]
    fn same_title_with_different_catalog_ids_stays_separate() {
        let mut record = document(vec![
            RecordItem {
                media: account_media("first-id", "Same Name"),
                identities: vec![identity("anilist", "1")],
                library: Some(library("following", "2026-01-02 00:00:00")),
                history: Vec::new(),
                bindings: Vec::new(),
            },
            RecordItem {
                media: account_media("second-id", "Same Name"),
                identities: vec![identity("anilist", "2")],
                library: Some(library("following", "2026-01-02 00:00:00")),
                history: Vec::new(),
                bindings: Vec::new(),
            },
        ]);
        record.sections = vec!["records".into()];
        let mut target = store();
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 2);
        assert_eq!(summary.merged_items, 0);
        let media_rows: i64 = target
            .connection()
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .unwrap();
        assert_eq!(media_rows, 2);
    }

    #[test]
    fn identity_conflict_keeps_the_existing_media_row() {
        let mut target = store();
        let existing = seed_media(&target);
        let mut record = document(vec![RecordItem {
            media: account_media("another-id", "One Piece"),
            identities: vec![identity("anilist", "21")],
            library: Some(library("following", "2026-01-02 00:00:00")),
            history: Vec::new(),
            bindings: Vec::new(),
        }]);
        record.sections = vec!["records".into()];
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.merged_items, 1);
        let media_rows: i64 = target
            .connection()
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .unwrap();
        assert_eq!(media_rows, 1);
        let owner: String = target
            .connection()
            .query_row(
                "SELECT media_id FROM external_identity WHERE provider = 'anilist' AND external_id = '21'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, existing);
        assert!(target.library_get(&existing).unwrap().is_some());
    }

    #[test]
    fn old_timestamps_are_imported_verbatim() {
        let item = RecordItem {
            media: DocumentMedia {
                created_at: "2020-01-01 00:00:00".into(),
                updated_at: "2020-01-02 00:00:00".into(),
                ..account_media("old-id", "Old Show")
            },
            identities: vec![identity("bangumi", "8080")],
            library: Some(DocumentLibrary {
                status: "completed".into(),
                added_at: "2020-02-01 00:00:00".into(),
                updated_at: "2020-03-01 00:00:00".into(),
                deleted_at: None,
            }),
            history: vec![DocumentHistory {
                watched_at: "2020-04-01 00:00:00".into(),
                ..history(3, "2020-04-01 00:00:00")
            }],
            bindings: Vec::new(),
        };
        let mut record = document(vec![item]);
        record.sections = vec!["records".into()];
        let mut target = store();
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);

        let media_id: String = target
            .connection()
            .query_row("SELECT id FROM media WHERE title = 'Old Show'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let entry = target.library_get(&media_id).unwrap().unwrap();
        assert_eq!(entry.added_at, "2020-02-01 00:00:00");
        assert_eq!(entry.updated_at, "2020-03-01 00:00:00");
        let rows = target.history_list(20, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].watched_at, "2020-04-01 00:00:00");
    }

    #[test]
    fn invalid_deleted_at_is_skipped() {
        let mut bad_library = document(vec![RecordItem {
            media: account_media("bad-library", "Bad Library"),
            identities: vec![identity("anilist", "31")],
            library: Some(DocumentLibrary {
                status: "completed".into(),
                added_at: "2026-01-01 00:00:00".into(),
                updated_at: "2026-01-02 00:00:00".into(),
                deleted_at: Some("2026-02-30 00:00:00".into()),
            }),
            history: Vec::new(),
            bindings: Vec::new(),
        }]);
        bad_library.sections = vec!["records".into()];
        let mut target = store();
        let summary = target
            .import_records(&bad_library, ImportMode::Merge)
            .unwrap();
        assert_eq!(summary.skipped, 1);
        assert_eq!(summary.written, 0);
        assert_eq!(summary.library, 0);

        let mut bad_history = document(vec![RecordItem {
            media: account_media("bad-history", "Bad History"),
            identities: vec![identity("anilist", "32")],
            library: None,
            history: vec![DocumentHistory {
                deleted_at: Some("not a timestamp".into()),
                ..history(1, "2026-01-02 00:00:00")
            }],
            bindings: Vec::new(),
        }]);
        bad_history.sections = vec!["records".into()];
        let summary = target
            .import_records(&bad_history, ImportMode::Overwrite)
            .unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.history, 0);
    }

    #[test]
    fn invalid_watched_at_skips_only_that_row() {
        let mut record = document(vec![RecordItem {
            media: account_media("mixed-history", "Mixed History"),
            identities: vec![identity("anilist", "33")],
            library: None,
            history: vec![history(1, "2026-01-02 00:00:00"), history(2, "yesterday")],
            bindings: Vec::new(),
        }]);
        record.sections = vec!["records".into()];
        let mut target = store();
        let summary = target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(summary.written, 1);
        assert_eq!(summary.history, 1);
        assert_eq!(target.history_list(20, 0).unwrap().len(), 1);
    }

    #[test]
    fn merge_mode_leaves_settings_alone() {
        let mut record = document(Vec::new());
        record.settings = Some(valid_settings());
        let mut target = store();
        target.set_default_volume(0.9).unwrap();
        target.import_records(&record, ImportMode::Merge).unwrap();
        assert_eq!(target.get_settings().unwrap().default_volume, 0.9);
    }

    #[test]
    fn source_rules_are_not_touched_by_import() {
        let mut target = store();
        target
            .source_rule_upsert("My Rule", "{\"id\":\"custom:my-rule\"}")
            .unwrap();
        let mut record = document(vec![RecordItem {
            media: account_media("rule-show", "Rule Show"),
            identities: vec![identity("anilist", "34")],
            library: None,
            history: Vec::new(),
            bindings: Vec::new(),
        }]);
        record.sections = vec!["records".into()];
        target.import_records(&record, ImportMode::Merge).unwrap();
        let rules: i64 = target
            .connection()
            .query_row("SELECT COUNT(*) FROM source_rule", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rules, 1);
    }

    #[test]
    fn backup_database_writes_a_complete_copy() {
        let source = store();
        seed_media(&source);
        let path = std::env::temp_dir().join(format!("kuriume-backup-{}.db", Uuid::new_v4()));
        source.backup_database(&path).unwrap();
        let copy = rusqlite::Connection::open(&path).unwrap();
        let integrity: String = copy
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
        let media_rows: i64 = copy
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .unwrap();
        assert_eq!(media_rows, 1);
        drop(copy);
        std::fs::remove_file(&path).unwrap();
    }
}
