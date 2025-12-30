const SCHEMA_STATEMENTS = [
  'PRAGMA foreign_keys = ON',
  `CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rel_path TEXT NOT NULL UNIQUE,
    abs_path TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rel_path TEXT NOT NULL UNIQUE,
    abs_path TEXT NOT NULL,
    description TEXT DEFAULT '',
    stable_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_stable_id ON docs(stable_id)',
];

module.exports = {
  SCHEMA_STATEMENTS,
};
