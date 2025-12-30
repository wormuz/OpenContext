const SQLite = require('expo-sqlite');
const FileSystem = require('expo-file-system');
const { ensureSchema } = require('./migrations');
const { resolveDocPaths } = require('../utils/paths');

const DB_NAME = 'opencontext.db';
const APP_ROOT = `${FileSystem.documentDirectory}opencontext/`;
const DOCS_ROOT = `${APP_ROOT}docs/`;

let dbInstance;

async function openDb() {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabase(DB_NAME);
  }
  return dbInstance;
}

async function run(sql, params = []) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result),
        (_, error) => {
          reject(error);
          return true;
        },
      );
    });
  });
}

async function all(sql, params = []) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result?.rows?._array || []),
        (_, error) => {
          reject(error);
          return true;
        },
      );
    });
  });
}

async function initDb() {
  await FileSystem.makeDirectoryAsync(APP_ROOT, { intermediates: true });
  await FileSystem.makeDirectoryAsync(DOCS_ROOT, { intermediates: true });

  await ensureSchema({ run, all });
  await ensureRootFolder();
}

async function ensureRootFolder() {
  const rows = await all('SELECT id FROM folders WHERE rel_path = ?1', ['docs']);
  if (rows && rows.length > 0) {
    return rows[0].id;
  }

  const createdAt = new Date().toISOString();
  const { absPath } = resolveDocPaths({ documentsRoot: DOCS_ROOT, relPath: '' });
  const result = await run(
    `INSERT INTO folders (parent_id, name, rel_path, abs_path, description, created_at, updated_at)
     VALUES (NULL, ?1, ?2, ?3, '', ?4, ?5)`,
    ['docs', 'docs', absPath, createdAt, createdAt],
  );
  return result.insertId;
}

module.exports = {
  initDb,
  run,
  all,
  openDb,
  APP_ROOT,
  DOCS_ROOT,
};
