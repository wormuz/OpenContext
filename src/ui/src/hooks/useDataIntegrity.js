/**
 * useDataIntegrity - 统一管理数据有效性
 * 
 * 职责：
 * 1. 检测 .opencontext 目录是否存在/有效
 * 2. 当检测到数据无效时，统一清理所有缓存状态
 * 3. 提供给其他 hooks 使用的工具函数
 */

import { useCallback, useRef } from 'react';
import { isNotFoundError } from '../utils/errors';

const LAST_URL_KEY = 'opencontext_last_url';

/**
 * 收集文件夹树中的所有路径
 * @param {Array} folders - 文件夹树
 * @param {string} prefix - 路径前缀
 * @returns {Set<string>} 所有文件夹路径的集合
 */
export function collectFolderPaths(folders, prefix = '') {
  const paths = new Set();
  for (const folder of folders || []) {
    const path = prefix ? `${prefix}/${folder.name}` : folder.name;
    paths.add(path);
    if (folder.children?.length) {
      collectFolderPaths(folder.children, path).forEach((p) => paths.add(p));
    }
  }
  return paths;
}

/**
 * 清除 localStorage 中保存的 URL
 */
export function clearLastUrl() {
  try {
    localStorage.removeItem(LAST_URL_KEY);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('id');
      url.searchParams.delete('doc');
      window.history.replaceState({}, '', url.pathname);
    }
  } catch {
    // ignore
  }
}

/**
 * 保存当前 URL 到 localStorage
 */
export function saveLastUrl() {
  try {
    const url = window.location.pathname + window.location.search;
    if (url && url !== '/') {
      localStorage.setItem(LAST_URL_KEY, url);
    }
  } catch {
    // ignore
  }
}

/**
 * 从 localStorage 恢复上次的 URL
 * @returns {boolean} 是否成功恢复
 */
export function restoreLastUrl() {
  try {
    const currentSearch = window.location.search || '';
    if (currentSearch && currentSearch !== '?') return false;
    
    const lastUrl = localStorage.getItem(LAST_URL_KEY);
    if (!lastUrl || lastUrl === '/') return false;
    
    window.history.replaceState({}, '', lastUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * 数据完整性管理 Hook
 */
export function useDataIntegrity({ api }) {
  const lastValidationRef = useRef(null);
  
  /**
   * 验证数据是否有效，并返回有效的文件夹路径集合
   * @returns {Promise<{isValid: boolean, folders?: Array, validPaths?: Set, error?: Error}>}
   */
  const validate = useCallback(async () => {
    try {
      const folders = await api.listFolders({ all: true });
      const validPaths = collectFolderPaths(folders);
      lastValidationRef.current = { isValid: true, folders, validPaths, timestamp: Date.now() };
      return lastValidationRef.current;
    } catch (err) {
      lastValidationRef.current = { isValid: false, error: err, timestamp: Date.now() };
      return lastValidationRef.current;
    }
  }, [api]);
  
  /**
   * 处理 API 错误 - 如果是资源不存在错误，返回 true 表示需要清理
   * @param {Error} err - 错误对象
   * @returns {boolean} 是否需要清理缓存
   */
  const shouldCleanupOnError = useCallback((err) => {
    return isNotFoundError(err);
  }, []);
  
  /**
   * 清理过时的文件夹缓存
   * @param {Object} currentState - 当前状态 { expandedFolders, folderDocs }
   * @param {Set} validPaths - 有效的文件夹路径集合
   * @returns {Object} 清理后的状态 { expandedFolders, folderDocs }
   */
  const cleanStaleFolders = useCallback((currentState, validPaths) => {
    const { expandedFolders, folderDocs } = currentState;
    
    const newExpanded = new Set();
    expandedFolders.forEach((p) => {
      if (validPaths.has(p)) newExpanded.add(p);
    });
    
    const newFolderDocs = {};
    Object.keys(folderDocs).forEach((p) => {
      if (validPaths.has(p)) newFolderDocs[p] = folderDocs[p];
    });
    
    return { expandedFolders: newExpanded, folderDocs: newFolderDocs };
  }, []);
  
  /**
   * 完全重置所有缓存状态（当 .opencontext 被删除时使用）
   */
  const resetAllCache = useCallback(() => {
    clearLastUrl();
    return {
      folders: [],
      expandedFolders: new Set(),
      folderDocs: {},
      selectedDoc: null,
      docContent: '',
    };
  }, []);
  
  return {
    validate,
    shouldCleanupOnError,
    cleanStaleFolders,
    resetAllCache,
    clearLastUrl,
    saveLastUrl,
    restoreLastUrl,
    collectFolderPaths,
  };
}

