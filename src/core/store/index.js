/**
 * OpenContext Store Module
 * 
 * Provides document and folder management via Rust native bindings.
 */

const path = require('path');
const os = require('os');

const native = require('../native');
const dataService = require('../data-service');

// Require native bindings at load time
native.require();

// Constants (derived from environment)
const DEFAULT_BASE_ROOT = path.join(os.homedir(), '.opencontext');
const BASE_ROOT = process.env.OPENCONTEXT_ROOT || DEFAULT_BASE_ROOT;
const CONTEXTS_ROOT = process.env.OPENCONTEXT_CONTEXTS_ROOT || path.join(BASE_ROOT, 'contexts');
const DB_PATH = process.env.OPENCONTEXT_DB_PATH || path.join(BASE_ROOT, 'opencontext.db');

// Log if debug enabled
if (process.env.OC_STORE_DEBUG) {
  console.log('[oc store] Using native (Rust) implementation via DataService');
}

module.exports = {
  // Core functions — all routed through DataService (adds cache + invalidation)
  initEnvironment: (o) => dataService.initEnvironment(o),
  listFolders: (o) => dataService.listFolders(o),
  createFolder: (o) => dataService.createFolder(o),
  renameFolder: (o) => dataService.renameFolder(o),
  moveFolder: (o) => dataService.moveFolder(o),
  removeFolder: (o) => dataService.removeFolder(o),
  listDocs: (o) => dataService.listDocs(o),
  createDoc: (o) => dataService.createDoc(o),
  moveDoc: (o) => dataService.moveDoc(o),
  renameDoc: (o) => dataService.renameDoc(o),
  removeDoc: (o) => dataService.removeDoc(o),
  setDocDescription: (o) => dataService.setDocDescription(o),
  getDocMeta: (o) => dataService.getDocMeta(o),
  getDocByStableId: (id) => dataService.getDocByStableId(id),
  getDocContent: (p) => dataService.getDocContent(p),
  saveDocContent: (o) => dataService.saveDocContent(o),
  reconcileDoc: (o) => dataService.reconcileDoc(o),
  generateManifest: (o) => dataService.generateManifest(o),
  reconcileFolder: (o) => dataService.reconcileFolder(o),
  suggestFolders: (o) => dataService.suggestFolders(o),

  // Constants
  DEFAULT_BASE_ROOT,
  BASE_ROOT,
  CONTEXTS_ROOT,
  DB_PATH,

  // Implementation info
  isNativeAvailable: native.isAvailable,
  USE_NATIVE: true,
};
