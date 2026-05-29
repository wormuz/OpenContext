//! Write-Ahead Log helpers for pending index operations.
//!
//! WAL entries are written inside the same SQLite transaction as doc mutations.
//! IndexSyncService replays `pending` entries on startup to recover from crashes.

use rusqlite::{params, Connection};

use crate::CoreResult;

#[derive(Debug, Clone)]
pub enum WalOp {
    Update { rel_path: String },
    Remove { rel_path: String },
    Rename { old_path: String, new_path: String },
}

/// Append a WAL entry (call inside an existing SQLite transaction).
pub fn append(conn: &Connection, op: &WalOp, ts: &str) -> CoreResult<()> {
    let (op_str, rel_path, old_path) = match op {
        WalOp::Update { rel_path } => ("update", rel_path.as_str(), None),
        WalOp::Remove { rel_path } => ("remove", rel_path.as_str(), None),
        WalOp::Rename { old_path, new_path } => {
            ("rename", new_path.as_str(), Some(old_path.as_str()))
        }
    };

    conn.execute(
        "INSERT INTO index_wal (op, rel_path, old_path, status, created_at)
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        params![op_str, rel_path, old_path, ts],
    )?;
    Ok(())
}

/// Mark a WAL entry as done.
pub fn mark_done(conn: &Connection, id: i64) -> CoreResult<()> {
    conn.execute(
        "UPDATE index_wal SET status = 'done' WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Load all pending WAL entries ordered by id (oldest first).
pub fn load_pending(conn: &Connection) -> CoreResult<Vec<(i64, WalOp)>> {
    let mut stmt = conn.prepare(
        "SELECT id, op, rel_path, old_path FROM index_wal WHERE status = 'pending' ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut entries = Vec::with_capacity(rows.len());
    for (id, op_str, rel_path, old_path) in rows {
        let op = match op_str.as_str() {
            "update" => WalOp::Update { rel_path },
            "remove" => WalOp::Remove { rel_path },
            "rename" => {
                let old = old_path.unwrap_or_default();
                WalOp::Rename {
                    old_path: old,
                    new_path: rel_path,
                }
            }
            _ => continue,
        };
        entries.push((id, op));
    }
    Ok(entries)
}

/// Prune done entries older than `keep_days` days (housekeeping).
pub fn prune_done(conn: &Connection, keep_days: u64) -> CoreResult<usize> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(keep_days as i64);
    let cutoff_str = cutoff.to_rfc3339();
    let n = conn.execute(
        "DELETE FROM index_wal WHERE status = 'done' AND created_at < ?1",
        params![cutoff_str],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_wal_table(conn: &Connection) -> CoreResult<()> {
        conn.execute_batch(
            "CREATE TABLE index_wal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                op TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                old_path TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    #[test]
    fn test_append_and_load_pending() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        setup_wal_table(&conn).expect("setup table");

        let ts = crate::now_iso();
        append(
            &conn,
            &WalOp::Update {
                rel_path: "doc1.md".into(),
            },
            &ts,
        )
        .expect("append update");
        append(
            &conn,
            &WalOp::Remove {
                rel_path: "doc2.md".into(),
            },
            &ts,
        )
        .expect("append remove");
        append(
            &conn,
            &WalOp::Rename {
                old_path: "old.md".into(),
                new_path: "new.md".into(),
            },
            &ts,
        )
        .expect("append rename");

        let pending = load_pending(&conn).expect("load pending");
        assert_eq!(pending.len(), 3, "expected 3 pending entries");

        if let WalOp::Update { rel_path } = &pending[0].1 {
            assert_eq!(rel_path, "doc1.md");
        } else {
            panic!("first entry should be Update");
        }

        if let WalOp::Remove { rel_path } = &pending[1].1 {
            assert_eq!(rel_path, "doc2.md");
        } else {
            panic!("second entry should be Remove");
        }

        if let WalOp::Rename { old_path, new_path } = &pending[2].1 {
            assert_eq!(old_path, "old.md");
            assert_eq!(new_path, "new.md");
        } else {
            panic!("third entry should be Rename");
        }
    }

    #[test]
    fn test_mark_done() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        setup_wal_table(&conn).expect("setup table");

        let ts = crate::now_iso();
        append(
            &conn,
            &WalOp::Update {
                rel_path: "doc.md".into(),
            },
            &ts,
        )
        .expect("append");

        let id: i64 = conn
            .query_row("SELECT id FROM index_wal LIMIT 1", [], |row| row.get(0))
            .expect("get id");

        mark_done(&conn, id).expect("mark done");

        let pending = load_pending(&conn).expect("load pending");
        assert_eq!(
            pending.len(),
            0,
            "expected 0 pending entries after mark_done"
        );
    }

    #[test]
    fn test_prune_done_removes_old() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        setup_wal_table(&conn).expect("setup table");

        let ts = crate::now_iso();
        append(
            &conn,
            &WalOp::Update {
                rel_path: "doc1.md".into(),
            },
            &ts,
        )
        .expect("append 1");
        append(
            &conn,
            &WalOp::Remove {
                rel_path: "doc2.md".into(),
            },
            &ts,
        )
        .expect("append 2");

        let id1: i64 = conn
            .query_row("SELECT id FROM index_wal LIMIT 1", [], |row| row.get(0))
            .expect("get id1");
        let id2: i64 = conn
            .query_row("SELECT id FROM index_wal LIMIT 1 OFFSET 1", [], |row| {
                row.get(0)
            })
            .expect("get id2");

        mark_done(&conn, id1).expect("mark id1 done");
        mark_done(&conn, id2).expect("mark id2 done");

        conn.execute(
            "UPDATE index_wal SET created_at = '2020-01-01T00:00:00Z'",
            [],
        )
        .expect("set old date");

        let removed = prune_done(&conn, 7).expect("prune with 7 days");
        assert_eq!(removed, 2, "expected 2 entries pruned");
    }

    #[test]
    fn test_prune_done_keeps_recent() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
        setup_wal_table(&conn).expect("setup table");

        let ts = crate::now_iso();
        append(
            &conn,
            &WalOp::Update {
                rel_path: "doc.md".into(),
            },
            &ts,
        )
        .expect("append");

        let id: i64 = conn
            .query_row("SELECT id FROM index_wal LIMIT 1", [], |row| row.get(0))
            .expect("get id");

        mark_done(&conn, id).expect("mark done");

        let removed = prune_done(&conn, 7).expect("prune with 7 days");
        assert_eq!(removed, 0, "expected 0 entries pruned for recent entry");
    }
}
