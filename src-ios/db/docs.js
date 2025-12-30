const FileSystem = require('expo-file-system');
const { run, all, DOCS_ROOT } = require('./index');
const { generateStableId } = require('../utils/uuid');
const { joinPath } = require('../utils/paths');

async function listDocs() {
  return all(
    `SELECT id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
     FROM docs
     ORDER BY updated_at DESC`,
  );
}

async function getDocById(id) {
  const rows = await all(
    `SELECT id, name, rel_path, abs_path, description, stable_id, created_at, updated_at
     FROM docs
     WHERE id = ?1`,
    [id],
  );
  return rows[0] || null;
}

async function getRootFolderId() {
  const rows = await all('SELECT id FROM folders WHERE rel_path = ?1', ['docs']);
  return rows[0] ? rows[0].id : null;
}

async function createDoc({ title, content }) {
  const folderId = await getRootFolderId();
  const createdAt = new Date().toISOString();
  const stableId = generateStableId();
  const docTitle = normalizeTitle(title);
  const description = extractDescription(content);
  const fileName = buildDocFilename(docTitle);
  const relPath = `docs/${fileName}`;
  const absPath = joinPath(DOCS_ROOT, fileName);

  await FileSystem.writeAsStringAsync(absPath, content || '', {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const result = await run(
    `INSERT INTO docs (folder_id, name, rel_path, abs_path, description, stable_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    [folderId, docTitle, relPath, absPath, description, stableId, createdAt, createdAt],
  );
  return getDocById(result.insertId);
}

async function updateDoc({ id, title, content }) {
  const doc = await getDocById(id);
  if (!doc) {
    return null;
  }
  const updatedAt = new Date().toISOString();
  const nextTitle = normalizeTitle(title || doc.name);
  const description = extractDescription(content);

  await FileSystem.writeAsStringAsync(doc.abs_path, content || '', {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await run(
    `UPDATE docs SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4`,
    [nextTitle, description, updatedAt, id],
  );

  return getDocById(id);
}

async function deleteDoc(id) {
  const doc = await getDocById(id);
  if (!doc) {
    return false;
  }
  await run('DELETE FROM docs WHERE id = ?1', [id]);
  try {
    await FileSystem.deleteAsync(doc.abs_path, { idempotent: true });
  } catch (err) {
    // Ignore file deletion failures; DB is the source of truth.
  }
  return true;
}

async function loadDocContent(doc) {
  try {
    return await FileSystem.readAsStringAsync(doc.abs_path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    return '';
  }
}

function buildDocFilename(title) {
  const safeTitle = String(title || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'untitled';
  return `${safeTitle}-${Date.now().toString(36)}.md`;
}

function extractDescription(content) {
  const text = String(content || '').trim();
  if (!text) return '';
  const line = text.split('\n').find((l) => l.trim().length > 0);
  return (line || '').slice(0, 160);
}

function normalizeTitle(title) {
  return String(title || '').trim() || 'Untitled';
}

module.exports = {
  listDocs,
  getDocById,
  createDoc,
  updateDoc,
  deleteDoc,
  loadDocContent,
};
