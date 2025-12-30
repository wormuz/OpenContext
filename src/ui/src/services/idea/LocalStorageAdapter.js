/**
 * LocalStorageAdapter - 本地文件存储适配器
 * 
 * 使用本地文件系统存储 Ideas，兼容当前的 Markdown 格式
 * 
 * 存储格式：
 * - 目录结构：.ideas/{box}/{year}/{month}/{date}-{slug}-{timestamp}.md
 * - 文件格式：Markdown with hidden markers for entry metadata
 */

import { IdeaStorageAdapter } from './IdeaStorageAdapter';

// ============ 常量 ============

const IDEAS_ROOT = '.ideas';
const DEFAULT_BOX = 'inbox';

// Entry marker 正则：[//]: # (idea:id=xxx created_at=xxx [is_ai=true])
const ENTRY_MARKER_REGEX = /^\[\/\/\]: # \(idea:id=([a-f0-9-]+) created_at=([^\s)]+)(?:\s+is_ai=(\w+))?\)\s*$/;

// ============ 工具函数 ============

function generateEntryId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'untitled';
}

function sanitizeBoxName(name) {
  const value = String(name || '').trim();
  if (!value) return DEFAULT_BOX;
  if (value.includes('/') || value.includes('\\')) return DEFAULT_BOX;
  return value;
}

function generateThreadPath(title, box = DEFAULT_BOX) {
  const safeBox = sanitizeBoxName(box);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  const slug = slugify(title);
  const timestamp = Date.now().toString(36);
  
  return `${IDEAS_ROOT}/${safeBox}/${year}/${month}/${datePrefix}-${slug}-${timestamp}.md`;
}

function extractTitleFromPath(path) {
  const filename = path.split('/').pop().replace('.md', '');
  const parts = filename.split('-');
  if (parts.length > 2) {
    return parts.slice(1, -1).join(' ');
  }
  return filename;
}

function extractDateFromPath(path) {
  const filename = path.split('/').pop().replace('.md', '');
  const dateMatch = filename.match(/^(\d{4})(\d{2})(\d{2})/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }
  return null;
}

function stripIdeasRoot(path) {
  if (!path) return '';
  return path.startsWith(`${IDEAS_ROOT}/`) ? path.slice(`${IDEAS_ROOT}/`.length) : path;
}

function isLegacyThreadPath(path) {
  const relPath = stripIdeasRoot(path);
  return /^\d{4}\/\d{2}\//.test(relPath);
}

function extractBoxFromPath(path) {
  const relPath = stripIdeasRoot(path);
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return DEFAULT_BOX;
  if (/^\d{4}$/.test(parts[0])) return DEFAULT_BOX;
  return parts[0] || DEFAULT_BOX;
}

/**
 * 从内容中提取图片（Markdown 图片语法）
 * @param {string} content
 * @returns {{ text: string, images: string[] }}
 */
function extractImagesFromContent(content) {
  if (!content) return { text: '', images: [] };
  
  const images = [];
  // 匹配 Markdown 图片语法：![alt](src)
  const imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  
  while ((match = imgRegex.exec(content)) !== null) {
    images.push(match[1]);
  }
  
  // 移除图片标记，只保留文本
  const text = content.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, '').trim();
  
  return { text, images };
}

/**
 * 将图片添加到内容中（作为 Markdown 图片语法）
 * @param {string} text
 * @param {string[]} images - base64 图片数组
 * @returns {string}
 */
function addImagesToContent(text, images) {
  if (!images || images.length === 0) return text;
  
  const imageMarkdown = images.map((img, idx) => `![image-${idx + 1}](${img})`).join('\n');
  return text ? `${text}\n\n${imageMarkdown}` : imageMarkdown;
}

/**
 * 解析 Thread 文档，提取所有 entries
 */
function parseThreadDocument(content) {
  if (!content) return [];
  
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;
  let contentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

  return entries;
}

/**
 * 序列化 entries 为 Markdown 文档
 */
function serializeThreadDocument(entries) {
  return entries
    .map((entry) => {
      const marker = createEntryMarker(entry.id, entry.createdAt, entry.isAI);
      const contentWithImages = addImagesToContent(entry.content, entry.images);
      return `${marker}\n${contentWithImages}`;
    })
    .join('\n\n');
}

// ============ LocalStorageAdapter ============

export class LocalStorageAdapter extends IdeaStorageAdapter {
  /**
   * @param {Object} api - API 接口对象
   */
  constructor(api) {
    super();
    this.api = api;
    this.ideasRoot = IDEAS_ROOT;
  }

  getType() {
    return 'local';
  }

  /**
   * 确保 ideas 目录存在
   */
  async ensureRootFolder() {
    try {
      await this.api.createFolder(this.ideasRoot, 'Ideas and thoughts');
    } catch {
      // 目录可能已存在，忽略
    }
    try {
      await this.api.createFolder(`${this.ideasRoot}/${DEFAULT_BOX}`, 'Default ideas box');
    } catch {
      // ignore
    }
  }

  async migrateLegacyThreads() {
    const docs = await this.api.listDocs(this.ideasRoot, true);
    if (!docs || docs.length === 0) return;
    for (const doc of docs) {
      const relPath = doc?.rel_path || '';
      if (!isLegacyThreadPath(relPath)) continue;
      const restPath = stripIdeasRoot(relPath);
      const destPath = `${this.ideasRoot}/${DEFAULT_BOX}/${restPath}`;
      const destFolder = destPath.split('/').slice(0, -1).join('/');
      try {
        await this.api.createFolder(destFolder, '');
      } catch {
        // ignore
      }
      try {
        await this.api.moveDoc(relPath, destFolder);
      } catch {
        // ignore failed migration
      }
    }
  }

  /**
   * 获取所有 Threads
   */
  async listThreads(filter = {}) {
    await this.ensureRootFolder();
    await this.migrateLegacyThreads();
    const docs = await this.api.listDocs(this.ideasRoot, true);
    
    const threads = await Promise.all(
      (docs || [])
        .filter((doc) => String(doc?.rel_path || '').toLowerCase().endsWith('.md'))
        .map(async (doc) => {
        try {
          const { content } = await this.api.getDocContent(doc.rel_path);
          const entries = parseThreadDocument(content);
          
          // 添加 threadId 到每个 entry
          const entriesWithThreadId = entries.map(e => ({
            ...e,
            threadId: doc.rel_path,
          }));

          const firstEntry = entriesWithThreadId[0];
          const lastEntry = entriesWithThreadId[entriesWithThreadId.length - 1];

          return {
            id: doc.rel_path,
            title: extractTitleFromPath(doc.rel_path),
            createdAt: firstEntry?.createdAt || doc.created_at || new Date().toISOString(),
            updatedAt: lastEntry?.createdAt || doc.updated_at || new Date().toISOString(),
            entries: entriesWithThreadId,
            // 保留原始 path 信息
            _path: doc.rel_path,
            _date: extractDateFromPath(doc.rel_path),
            _box: extractBoxFromPath(doc.rel_path),
          };
        } catch {
          return null;
        }
      })
    );

    let result = threads.filter(Boolean);

    // 应用筛选
    if (filter.date) {
      result = result.filter(t => t._date === filter.date);
    }

    if (filter.search) {
      const keyword = filter.search.toLowerCase();
      result = result.filter(t => 
        t.title.toLowerCase().includes(keyword) ||
        t.entries.some(e => e.content.toLowerCase().includes(keyword))
      );
    }

    if (filter.box) {
      result = result.filter(t => (t._box || DEFAULT_BOX) === filter.box);
    }

    return result;
  }

  /**
   * 获取单个 Thread
   */
  async getThread(threadId) {
    try {
      const { content } = await this.api.getDocContent(threadId);
      const entries = parseThreadDocument(content);
      
      const entriesWithThreadId = entries.map(e => ({
        ...e,
        threadId,
      }));

      const firstEntry = entriesWithThreadId[0];
      const lastEntry = entriesWithThreadId[entriesWithThreadId.length - 1];

      return {
        id: threadId,
        title: extractTitleFromPath(threadId),
        createdAt: firstEntry?.createdAt || new Date().toISOString(),
        updatedAt: lastEntry?.createdAt || new Date().toISOString(),
        entries: entriesWithThreadId,
        _path: threadId,
        _date: extractDateFromPath(threadId),
        _box: extractBoxFromPath(threadId),
      };
    } catch {
      return null;
    }
  }

  /**
   * 创建新 Thread
   */
  async createThread(input) {
    const { content, title, isAI = false, images = [], box = DEFAULT_BOX } = input;
    
    const now = new Date().toISOString();
    const entryId = generateEntryId();
    const threadPath = generateThreadPath(title || content.slice(0, 20) || 'image', box);
    const folderPath = threadPath.split('/').slice(0, -1).join('/');
    const fileName = threadPath.split('/').pop();

    // 确保文件夹存在
    try {
      await this.api.createFolder(folderPath, '');
    } catch {
      // 忽略
    }

    // 创建第一个 entry
    const firstEntry = {
      id: entryId,
      threadId: threadPath,
      content,
      images,
      isAI,
      createdAt: now,
    };

    // 序列化并保存
    const docContent = serializeThreadDocument([firstEntry]);
    await this.api.createDoc(folderPath, fileName, '');
    await this.api.saveDocContent(threadPath, docContent, '');

    return {
      id: threadPath,
      title: extractTitleFromPath(threadPath),
      createdAt: now,
      updatedAt: now,
      entries: [firstEntry],
      _path: threadPath,
      _date: formatDateKey(now),
      _box: extractBoxFromPath(threadPath),
    };
  }

  /**
   * 添加 Entry 到 Thread
   */
  async addEntry(input) {
    const { threadId, content, isAI = false, images = [] } = input;
    
    const now = new Date().toISOString();
    const entryId = generateEntryId();

    // 获取现有 thread
    const thread = await this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // 创建新 entry
    const newEntry = {
      id: entryId,
      threadId,
      content,
      images,
      isAI,
      createdAt: now,
    };

    // 添加到 entries 列表
    const updatedEntries = [...thread.entries, newEntry];

    // 序列化并保存
    const docContent = serializeThreadDocument(updatedEntries);
    await this.api.saveDocContent(threadId, docContent, '');

    return newEntry;
  }

  /**
   * 更新 Entry
   */
  async updateEntry(entryId, updates) {
    // 需要遍历所有 threads 找到包含此 entry 的 thread
    const threads = await this.listThreads();
    
    for (const thread of threads) {
      const entryIndex = thread.entries.findIndex(e => e.id === entryId);
      if (entryIndex !== -1) {
        // 更新 entry
        const updatedEntry = { ...thread.entries[entryIndex], ...updates };
        thread.entries[entryIndex] = updatedEntry;

        // 保存
        const docContent = serializeThreadDocument(thread.entries);
        await this.api.saveDocContent(thread.id, docContent, '');

        return updatedEntry;
      }
    }

    throw new Error(`Entry not found: ${entryId}`);
  }

  /**
   * 删除 Thread
   */
  async deleteThread(threadId) {
    await this.api.removeDoc(threadId);
  }

  /**
   * 删除 Entry
   */
  async deleteEntry(entryId) {
    const threads = await this.listThreads();
    
    for (const thread of threads) {
      const entryIndex = thread.entries.findIndex(e => e.id === entryId);
      if (entryIndex !== -1) {
        // 如果是唯一的 entry，删除整个 thread
        if (thread.entries.length === 1) {
          await this.deleteThread(thread.id);
          return;
        }

        // 否则只删除 entry
        thread.entries.splice(entryIndex, 1);
        const docContent = serializeThreadDocument(thread.entries);
        await this.api.saveDocContent(thread.id, docContent, '');
        return;
      }
    }

    throw new Error(`Entry not found: ${entryId}`);
  }

  async listBoxes() {
    await this.ensureRootFolder();
    const folders = await this.api.listFolders({ all: true });
    const boxes = (folders || [])
      .map((folder) => folder?.rel_path || '')
      .filter((relPath) => relPath && (relPath === this.ideasRoot || relPath.startsWith(`${this.ideasRoot}/`)))
      .map((relPath) => {
        if (relPath === this.ideasRoot) return '';
        return relPath.slice(`${this.ideasRoot}/`.length);
      })
      .map((name) => name.split('/')[0])
      .filter(Boolean)
      .filter((name) => !/^\d{4}$/.test(name));

    const unique = new Set([DEFAULT_BOX, ...boxes]);
    const list = Array.from(unique);
    const rest = list.filter((name) => name !== DEFAULT_BOX).sort();
    return [DEFAULT_BOX, ...rest];
  }

  async createBox(name) {
    const safeName = sanitizeBoxName(name);
    await this.ensureRootFolder();
    await this.api.createFolder(`${this.ideasRoot}/${safeName}`, '');
    return safeName;
  }

  async renameBox(oldName, newName) {
    const safeName = sanitizeBoxName(newName);
    if (!oldName || oldName === safeName) return safeName;
    await this.ensureRootFolder();
    await this.api.renameFolder(`${this.ideasRoot}/${oldName}`, safeName);
    return safeName;
  }

  async deleteBox(name) {
    if (!name) return;
    await this.api.removeFolder(`${this.ideasRoot}/${name}`, true);
  }

  async moveThread(threadId, targetBox) {
    const safeTarget = sanitizeBoxName(targetBox);
    const relPath = stripIdeasRoot(threadId);
    if (!relPath) return threadId;
    const parts = relPath.split('/').filter(Boolean);
    const restPath = /^\d{4}$/.test(parts[0]) ? relPath : parts.slice(1).join('/');
    const destPath = `${this.ideasRoot}/${safeTarget}/${restPath}`;
    const destFolder = destPath.split('/').slice(0, -1).join('/');
    try {
      await this.api.createFolder(`${this.ideasRoot}/${safeTarget}`, '');
    } catch {
      // ignore
    }
    try {
      await this.api.createFolder(destFolder, '');
    } catch {
      // ignore
    }
    await this.api.moveDoc(threadId, destFolder);
    return destPath;
  }
}

export default LocalStorageAdapter;
