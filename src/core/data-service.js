/**
 * DataService — unified data access layer over store-native.
 *
 * Adds:
 * - In-memory cache for read-heavy operations (folder tree, manifest)
 * - Cache invalidation on any write mutation
 * - Single import point for all three clients (CLI, MCP, HTTP)
 */

const store = require('./store-native');

const CACHE_TTL_MS = 30_000; // 30 s

class DataService {
  constructor() {
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._cache = new Map();
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  _get(key) {
    const entry = this._cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  _set(key, value) {
    this._cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /** Invalidate all cached entries. Called after any write operation. */
  _invalidate() {
    this._cache.clear();
  }

  // ── Environment ───────────────────────────────────────────────────────────

  initEnvironment() {
    return store.initEnvironment();
  }

  // ── Folders (cached reads) ────────────────────────────────────────────────

  listFolders(options = {}) {
    const key = `listFolders:${options.all ?? false}`;
    const cached = this._get(key);
    if (cached) return cached;
    const result = store.listFolders(options);
    this._set(key, result);
    return result;
  }

  createFolder(options) {
    const result = store.createFolder(options);
    this._invalidate();
    return result;
  }

  renameFolder(options) {
    const result = store.renameFolder(options);
    this._invalidate();
    return result;
  }

  moveFolder(options) {
    const result = store.moveFolder(options);
    this._invalidate();
    return result;
  }

  removeFolder(options) {
    const result = store.removeFolder(options);
    this._invalidate();
    return result;
  }

  // ── Docs (cached reads) ───────────────────────────────────────────────────

  listDocs(options) {
    const key = `listDocs:${options.folderPath}:${options.recursive ?? false}`;
    const cached = this._get(key);
    if (cached) return cached;
    const result = store.listDocs(options);
    this._set(key, result);
    return result;
  }

  createDoc(options) {
    const result = store.createDoc(options);
    this._invalidate();
    return result;
  }

  moveDoc(options) {
    const result = store.moveDoc(options);
    this._invalidate();
    return result;
  }

  renameDoc(options) {
    const result = store.renameDoc(options);
    this._invalidate();
    return result;
  }

  removeDoc(options) {
    const result = store.removeDoc(options);
    this._invalidate();
    return result;
  }

  setDocDescription(options) {
    const result = store.setDocDescription(options);
    this._invalidate();
    return result;
  }

  getDocMeta(options) {
    return store.getDocMeta(options);
  }

  getDocByStableId(stableId) {
    return store.getDocByStableId(stableId);
  }

  getDocContent(docPath) {
    return store.getDocContent(docPath);
  }

  saveDocContent(options) {
    const result = store.saveDocContent(options);
    this._invalidate();
    return result;
  }

  reconcileDoc(options) {
    const result = store.reconcileDoc(options);
    this._invalidate();
    return result;
  }

  /** Manifest result is cached per folderPath+limit key. */
  generateManifest(options) {
    const key = `manifest:${options.folderPath}:${options.limit ?? 'all'}`;
    const cached = this._get(key);
    if (cached) return cached;
    const result = store.generateManifest(options);
    this._set(key, result);
    return result;
  }

  reconcileFolder(options) {
    const result = store.reconcileFolder(options);
    this._invalidate();
    return result;
  }

  suggestFolders(options) {
    return store.suggestFolders(options);
  }

  // ── Pass-through availability ─────────────────────────────────────────────

  get isNativeAvailable() {
    return store.isNativeAvailable;
  }

  get getNativeError() {
    return store.getNativeError;
  }
}

// Export a singleton — all clients share the same cache
module.exports = new DataService();
