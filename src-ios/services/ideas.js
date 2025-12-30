const FileSystem = require('expo-file-system');
const { generateStableId } = require('../utils/uuid');
const { joinPath } = require('../utils/paths');

const APP_ROOT = `${FileSystem.documentDirectory}opencontext/`;
const IDEAS_ROOT = `${APP_ROOT}.ideas/`;
const DEFAULT_BOX = 'inbox';
const ENTRY_MARKER_REGEX = /^\[\/\/\]: # \(idea:id=([a-f0-9-]+) created_at=([^\s)]+)(?:\s+is_ai=(\w+))?\)\s*$/;

async function ensureIdeasRoot() {
  try {
    await FileSystem.makeDirectoryAsync(IDEAS_ROOT, { intermediates: true });
  } catch {
    // ignore
  }
  try {
    await FileSystem.makeDirectoryAsync(joinPath(IDEAS_ROOT, DEFAULT_BOX), { intermediates: true });
  } catch {
    // ignore
  }
}

function sanitizeBoxName(name) {
  const value = String(name || '').trim();
  if (!value) return DEFAULT_BOX;
  if (value.includes('/') || value.includes('\\')) return DEFAULT_BOX;
  return value;
}

function stripIdeasRoot(path) {
  if (!path) return '';
  return path.startsWith('.ideas/') ? path.slice('.ideas/'.length) : path;
}

function isLegacyThreadPath(relPath) {
  const normalized = stripIdeasRoot(relPath);
  const first = normalized.split('/').filter(Boolean)[0] || '';
  return /^\d{4}$/.test(first);
}

function extractBoxFromPath(relPath) {
  const normalized = stripIdeasRoot(relPath);
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return DEFAULT_BOX;
  if (/^\d{4}$/.test(parts[0])) return DEFAULT_BOX;
  return parts[0];
}

function generateEntryId() {
  return generateStableId();
}

function createEntryMarker(id, createdAt, isAI = false) {
  const base = `[//]: # (idea:id=${id} created_at=${createdAt}`;
  return isAI ? `${base} is_ai=true)` : `${base})`;
}

function parseEntryMarker(line) {
  const match = line.match(ENTRY_MARKER_REGEX);
  if (!match) return null;
  return {
    id: match[1],
    createdAt: match[2],
    isAI: match[3] === 'true',
  };
}

function extractImagesFromContent(content) {
  if (!content) return { text: '', images: [] };
  const images = [];
  const imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    images.push(match[1]);
  }
  const text = content.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, '').trim();
  return { text, images };
}

function addImagesToContent(text, images) {
  if (!images || images.length === 0) return text;
  const imageMarkdown = images.map((img, idx) => `![image-${idx + 1}](${img})`).join('\n');
  return text ? `${text}\n\n${imageMarkdown}` : imageMarkdown;
}

function parseThreadDocument(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;
  let contentLines = [];

  for (const line of lines) {
    const marker = parseEntryMarker(line);
    if (marker) {
      if (currentEntry) {
        const rawContent = contentLines.join('\n').trim();
        const { text, images } = extractImagesFromContent(rawContent);
        currentEntry.content = text;
        currentEntry.images = images;
        entries.push(currentEntry);
      }
      currentEntry = {
        id: marker.id,
        createdAt: marker.createdAt,
        content: '',
        images: [],
        isAI: marker.isAI || false,
      };
      contentLines = [];
    } else if (currentEntry) {
      contentLines.push(line);
    }
  }

  if (currentEntry) {
    const rawContent = contentLines.join('\n').trim();
    const { text, images } = extractImagesFromContent(rawContent);
    currentEntry.content = text;
    currentEntry.images = images;
    entries.push(currentEntry);
  }

  if (entries.length === 0 && content.trim()) {
    entries.push({
      id: generateEntryId(),
      createdAt: new Date().toISOString(),
      content: content.trim(),
      images: [],
      isAI: false,
    });
  }

  return entries;
}

function serializeThreadDocument(entries) {
  if (!entries || entries.length === 0) return '';
  return entries
    .map((entry) => {
      const marker = createEntryMarker(entry.id, entry.createdAt, entry.isAI);
      const contentWithImages = addImagesToContent(entry.content, entry.images);
      return `${marker}\n${contentWithImages}`;
    })
    .join('\n\n');
}

function formatDateKey(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'thread';
}

function generateThreadPath(title, date = new Date(), box = DEFAULT_BOX) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  const slug = slugify(title || '');
  const timestamp = Date.now().toString(36);
  const safeBox = sanitizeBoxName(box);
  return `${safeBox}/${year}/${month}/${datePrefix}-${slug}-${timestamp}.md`;
}

function extractTitleFromPath(relPath) {
  const filename = relPath.split('/').pop().replace('.md', '');
  const parts = filename.split('-');
  if (parts.length > 2) {
    return parts.slice(1, -1).join(' ');
  }
  return filename;
}

function extractDateFromPath(relPath) {
  const filename = relPath.split('/').pop().replace('.md', '');
  const dateMatch = filename.match(/^(\d{4})(\d{2})(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }
  return null;
}

async function listMarkdownFiles(dir, prefix = '') {
  const items = await FileSystem.readDirectoryAsync(dir);
  const result = [];

  for (const name of items) {
    const absPath = joinPath(dir, name);
    const info = await FileSystem.getInfoAsync(absPath);
    if (info.isDirectory) {
      const nestedPrefix = joinPath(prefix, name);
      const nested = await listMarkdownFiles(absPath, nestedPrefix);
      result.push(...nested);
    } else if (name.endsWith('.md')) {
      result.push(joinPath(prefix, name));
    }
  }

  return result;
}

async function migrateLegacyThreads() {
  const files = await listMarkdownFiles(IDEAS_ROOT);
  for (const relPath of files) {
    if (!isLegacyThreadPath(relPath)) continue;
    const fromPath = joinPath(IDEAS_ROOT, relPath);
    const destRelPath = joinPath(DEFAULT_BOX, relPath);
    const destPath = joinPath(IDEAS_ROOT, destRelPath);
    const destFolder = destPath.split('/').slice(0, -1).join('/');
    try {
      await FileSystem.makeDirectoryAsync(destFolder, { intermediates: true });
      await FileSystem.moveAsync({ from: fromPath, to: destPath });
    } catch {
      // ignore failed migration
    }
  }
}

async function listBoxes() {
  await ensureIdeasRoot();
  const items = await FileSystem.readDirectoryAsync(IDEAS_ROOT);
  const boxes = [];
  for (const name of items) {
    if (!name) continue;
    const info = await FileSystem.getInfoAsync(joinPath(IDEAS_ROOT, name));
    if (!info.isDirectory) continue;
    if (/^\d{4}$/.test(name)) continue;
    boxes.push(name);
  }
  const unique = Array.from(new Set([DEFAULT_BOX, ...boxes]));
  const rest = unique.filter((box) => box !== DEFAULT_BOX).sort();
  return [DEFAULT_BOX, ...rest];
}

function resolveThreadPaths(threadId) {
  const relPath = stripIdeasRoot(threadId);
  const absPath = joinPath(IDEAS_ROOT, relPath);
  return { relPath, absPath, threadId: `.ideas/${relPath}` };
}

async function listThreads(options = {}) {
  const { box } = options;
  await ensureIdeasRoot();
  await migrateLegacyThreads();
  const files = await listMarkdownFiles(IDEAS_ROOT);
  const threads = [];

  for (const relPath of files) {
    const threadBox = extractBoxFromPath(relPath);
    if (box && threadBox !== box) continue;
    const absPath = joinPath(IDEAS_ROOT, relPath);
    const content = await FileSystem.readAsStringAsync(absPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const entries = parseThreadDocument(content);
    const threadId = `.ideas/${relPath}`;
    const entriesWithThreadId = entries.map((entry) => ({
      ...entry,
      threadId,
    }));
    const firstEntry = entriesWithThreadId[0];
    const lastEntry = entriesWithThreadId[entriesWithThreadId.length - 1];
    const createdAt = firstEntry?.createdAt || new Date().toISOString();
    const updatedAt = lastEntry?.createdAt || createdAt;

    threads.push({
      id: threadId,
      title: extractTitleFromPath(relPath),
      createdAt,
      updatedAt,
      entries: entriesWithThreadId,
      _path: threadId,
      _date: extractDateFromPath(relPath) || formatDateKey(createdAt),
      _box: threadBox,
    });
  }

  return threads;
}

async function getThread(threadId) {
  const { absPath, threadId: normalizedId } = resolveThreadPaths(threadId);
  try {
    const content = await FileSystem.readAsStringAsync(absPath, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const entries = parseThreadDocument(content).map((entry) => ({
      ...entry,
      threadId: normalizedId,
    }));
    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];
    const createdAt = firstEntry?.createdAt || new Date().toISOString();
    const updatedAt = lastEntry?.createdAt || createdAt;
    const relPath = stripIdeasRoot(normalizedId);
    return {
      id: normalizedId,
      title: extractTitleFromPath(relPath),
      createdAt,
      updatedAt,
      entries,
      _path: normalizedId,
      _date: extractDateFromPath(relPath) || formatDateKey(createdAt),
      _box: extractBoxFromPath(relPath),
    };
  } catch (err) {
    return null;
  }
}

async function createThread({ content, title, isAI = false, images = [], box = DEFAULT_BOX }) {
  await ensureIdeasRoot();
  const now = new Date().toISOString();
  const entryId = generateEntryId();
  const threadRelPath = generateThreadPath(title || content.slice(0, 20), new Date(), box);
  const absPath = joinPath(IDEAS_ROOT, threadRelPath);
  const folderPath = absPath.split('/').slice(0, -1).join('/');

  await FileSystem.makeDirectoryAsync(folderPath, { intermediates: true });

  const threadId = `.ideas/${threadRelPath}`;
  const firstEntry = {
    id: entryId,
    threadId,
    content,
    images,
    isAI,
    createdAt: now,
  };

  const docContent = serializeThreadDocument([firstEntry]);
  await FileSystem.writeAsStringAsync(absPath, docContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    id: threadId,
    title: extractTitleFromPath(threadRelPath),
    createdAt: now,
    updatedAt: now,
    entries: [firstEntry],
    _path: threadId,
    _date: formatDateKey(now),
    _box: extractBoxFromPath(threadRelPath),
  };
}

async function continueThread({ threadId, content, isAI = false, images = [] }) {
  const { absPath, threadId: normalizedId } = resolveThreadPaths(threadId);
  const thread = await getThread(normalizedId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const now = new Date().toISOString();
  const entryId = generateEntryId();
  const newEntry = {
    id: entryId,
    threadId: normalizedId,
    content,
    images,
    isAI,
    createdAt: now,
  };

  const updatedEntries = [...thread.entries, newEntry];
  const docContent = serializeThreadDocument(updatedEntries);
  await FileSystem.writeAsStringAsync(absPath, docContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return newEntry;
}

async function deleteEntry({ threadId, entryId }) {
  const { absPath, threadId: normalizedId } = resolveThreadPaths(threadId);
  const thread = await getThread(normalizedId);
  if (!thread) return false;

  const updatedEntries = thread.entries.filter((entry) => entry.id !== entryId);
  if (updatedEntries.length === 0) {
    await FileSystem.deleteAsync(absPath, { idempotent: true });
    return true;
  }

  const docContent = serializeThreadDocument(updatedEntries);
  await FileSystem.writeAsStringAsync(absPath, docContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return true;
}

async function deleteThread(threadId) {
  const { absPath } = resolveThreadPaths(threadId);
  await FileSystem.deleteAsync(absPath, { idempotent: true });
  return true;
}

async function createBox(name) {
  const safeName = sanitizeBoxName(name);
  await ensureIdeasRoot();
  await FileSystem.makeDirectoryAsync(joinPath(IDEAS_ROOT, safeName), { intermediates: true });
  return safeName;
}

async function renameBox(oldName, newName) {
  const safeName = sanitizeBoxName(newName);
  if (!oldName || oldName === safeName || oldName === DEFAULT_BOX) return oldName;
  await ensureIdeasRoot();
  const fromPath = joinPath(IDEAS_ROOT, oldName);
  const toPath = joinPath(IDEAS_ROOT, safeName);
  await FileSystem.moveAsync({ from: fromPath, to: toPath });
  return safeName;
}

async function deleteBox(name) {
  if (!name || name === DEFAULT_BOX) return false;
  const target = joinPath(IDEAS_ROOT, name);
  await FileSystem.deleteAsync(target, { idempotent: true });
  return true;
}

async function moveThread({ threadId, targetBox }) {
  const safeBox = sanitizeBoxName(targetBox);
  const { relPath, absPath } = resolveThreadPaths(threadId);
  const currentBox = extractBoxFromPath(relPath);
  if (currentBox === safeBox) {
    return `.ideas/${relPath}`;
  }
  const restPath = isLegacyThreadPath(relPath)
    ? relPath
    : relPath.split('/').slice(1).join('/');
  const destRelPath = joinPath(safeBox, restPath);
  const destPath = joinPath(IDEAS_ROOT, destRelPath);
  const destFolder = destPath.split('/').slice(0, -1).join('/');
  await FileSystem.makeDirectoryAsync(destFolder, { intermediates: true });
  await FileSystem.moveAsync({ from: absPath, to: destPath });
  return `.ideas/${destRelPath}`;
}

module.exports = {
  listBoxes,
  listThreads,
  getThread,
  createThread,
  continueThread,
  deleteEntry,
  deleteThread,
  createBox,
  renameBox,
  deleteBox,
  moveThread,
};
