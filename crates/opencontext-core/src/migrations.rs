//! Versioned SQLite migration engine.

use rusqlite::Connection;

use crate::CoreResult;

/// Ordered list of migrations: (name, sql).
/// The name is stored in `schema_migrations` to track applied versions.
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_initial", include_str!("migrations/001_initial.sql")),
    (
        "002_stable_id",
        include_str!("migrations/002_stable_id.sql"),
    ),
    ("003_wal", include_str!("migrations/003_wal.sql")),
];

/// Apply all pending migrations in order.
/// Creates `schema_migrations` tracking table on first run.
pub fn run(conn: &Connection) -> CoreResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let applied: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
        let rows: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        rows.into_iter().collect()
    };

    for (name, sql) in MIGRATIONS {
        if applied.contains(*name) {
            continue;
        }

        // 002_stable_id: ADD COLUMN cannot run inside execute_batch if column already exists.
        // Guard it explicitly before running the SQL.
        if *name == "002_stable_id" {
            add_stable_id_column_if_missing(conn)?;
            backfill_stable_ids(conn)?;
        }

        conn.execute_batch(sql)?;

        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![name, crate::now_iso()],
        )?;
    }

    Ok(())
}

fn add_stable_id_column_if_missing(conn: &Connection) -> CoreResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(docs)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;

    if !cols.iter().any(|c| c == "stable_id") {
        conn.execute("ALTER TABLE docs ADD COLUMN stable_id TEXT", [])?;
    }
    Ok(())
}

fn backfill_stable_ids(conn: &Connection) -> CoreResult<()> {
    let mut stmt = conn.prepare("SELECT id FROM docs WHERE stable_id IS NULL OR stable_id = ''")?;
    let ids: Vec<i64> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;

    for id in ids {
        let sid = crate::generate_stable_id(conn)?;
        conn.execute(
            "UPDATE docs SET stable_id = ?1 WHERE id = ?2",
            rusqlite::params![sid, id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_creates_schema_migrations_table() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory DB");
        run(&conn).expect("run migrations");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count rows");

        assert_eq!(count, 3, "expected 3 migrations in schema_migrations table");
    }

    #[test]
    fn test_run_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory DB");
        run(&conn).expect("first run");
        run(&conn).expect("second run");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count rows");

        assert_eq!(count, 3, "idempotency check: still 3 rows after second run");
    }

    #[test]
    fn test_run_creates_docs_table() {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory DB");
        run(&conn).expect("run migrations");

        let result: i64 = conn
            .query_row("SELECT COUNT(*) FROM docs", [], |row| row.get(0))
            .expect("query docs table");

        assert_eq!(result, 0, "docs table exists and is queryable");
    }
}
