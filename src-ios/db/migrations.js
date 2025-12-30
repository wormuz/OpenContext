const { SCHEMA_STATEMENTS } = require('./schema');
const { generateStableId } = require('../utils/uuid');

async function ensureSchema({ run, all }) {
  for (const statement of SCHEMA_STATEMENTS) {
    await run(statement);
  }

  await ensureStableIdColumn({ run, all });
  await backfillStableIds({ run, all });
}

async function ensureStableIdColumn({ run, all }) {
  const columns = await all('PRAGMA table_info(docs)');
  const hasStableId = Array.isArray(columns)
    && columns.some((col) => col && col.name === 'stable_id');

  if (!hasStableId) {
    await run('ALTER TABLE docs ADD COLUMN stable_id TEXT');
  }

  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_stable_id ON docs(stable_id)');
}

async function backfillStableIds({ run, all }) {
  const rows = await all(
    "SELECT id FROM docs WHERE stable_id IS NULL OR stable_id = ''",
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  for (const row of rows) {
    if (!row || typeof row.id !== 'number') {
      continue;
    }
    await run('UPDATE docs SET stable_id = ?1 WHERE id = ?2', [
      generateStableId(),
      row.id,
    ]);
  }
}

module.exports = {
  ensureSchema,
};
