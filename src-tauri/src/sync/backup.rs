//! Local backups taken before anything destructive happens.

use std::fs;
use std::path::{Path, PathBuf};

use kuriume_store::Store;

use super::{Code, Phase, SyncError};

pub const BACKUP_LIMIT: usize = 5;

fn backup_error() -> SyncError {
    SyncError::new(Code::Internal, Phase::Backup)
}

/// `VACUUM INTO` keeps a consistent copy while WAL is active; copying the
/// database file alone could capture a partial transaction.
pub fn database(store: &Store, dir: &Path) -> Result<PathBuf, SyncError> {
    let stamp = store.timestamp_now().map_err(|_| backup_error())?;
    let target = dir.join(format!("kuriume-{stamp}.db"));
    store.backup_database(&target).map_err(|_| backup_error())?;
    prune(dir, "kuriume-", ".db");
    Ok(target)
}

pub fn records_snapshot(bytes: &[u8], dir: &Path, stamp: &str) -> Result<PathBuf, SyncError> {
    fs::create_dir_all(dir).map_err(|_| backup_error())?;
    let target = dir.join(format!("records-{stamp}.json"));
    fs::write(&target, bytes).map_err(|_| backup_error())?;
    prune(dir, "records-", ".json");
    Ok(target)
}

/// Keep the newest `BACKUP_LIMIT` files whose names share the prefix and suffix.
pub fn prune(dir: &Path, prefix: &str, suffix: &str) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(prefix) && name.ends_with(suffix))
        })
        .collect();
    if files.len() <= BACKUP_LIMIT {
        return;
    }
    files.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
    for path in files.iter().take(files.len() - BACKUP_LIMIT) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kuriume-backup-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pruning_keeps_the_newest_five() {
        let dir = scratch("prune");
        for stamp in [
            "20260101-000001",
            "20260102-000002",
            "20260103-000003",
            "20260104-000004",
            "20260105-000005",
            "20260106-000006",
            "20260107-000007",
        ] {
            fs::write(dir.join(format!("records-{stamp}.json")), b"{}").unwrap();
        }
        fs::write(dir.join("other.txt"), b"keep").unwrap();
        prune(&dir, "records-", ".json");

        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "other.txt".to_string(),
                "records-20260103-000003.json".to_string(),
                "records-20260104-000004.json".to_string(),
                "records-20260105-000005.json".to_string(),
                "records-20260106-000006.json".to_string(),
                "records-20260107-000007.json".to_string(),
            ]
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
