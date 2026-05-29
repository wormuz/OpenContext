-- Write-Ahead Log for pending index operations.
-- Written atomically with doc/folder mutations; replayed on restart.
CREATE TABLE IF NOT EXISTS index_wal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op TEXT NOT NULL,       -- 'update' | 'remove' | 'rename'
    rel_path TEXT NOT NULL, -- primary path (or new path for rename)
    old_path TEXT,          -- only set for rename
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done'
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_index_wal_status ON index_wal(status);
