/**
 * useDocLoader - 文档加载管理
 * 
 * 职责：
 * 1. 管理当前选中的文档
 * 2. 加载文档内容
 * 3. 处理 URL 同步
 * 4. 检测远端更新
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { clearLastUrl, saveLastUrl, restoreLastUrl } from './useDataIntegrity';
import { isNotFoundError } from '../utils/errors';

// ============ Reducer ============

const initialState = {
  selectedDoc: null,
  docContent: '',
  isLoadingContent: false,
  diffGate: null,
  spaceNewDocs: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD_DOC_START':
      return { ...state, isLoadingContent: true };
      
    case 'LOAD_DOC_SUCCESS':
      return {
        ...state,
        selectedDoc: action.doc,
        docContent: action.content,
        isLoadingContent: false,
      };
      
    case 'LOAD_DOC_FINISH':
      return { ...state, isLoadingContent: false };
      
    case 'SET_SELECTED_DOC':
      return { ...state, selectedDoc: action.doc };
      
    case 'SET_DOC_CONTENT':
      return { ...state, docContent: action.content };
      
    case 'SET_DIFF_GATE':
      return { ...state, diffGate: action.diffGate };
      
    case 'SET_SPACE_NEW_DOCS':
      return { ...state, spaceNewDocs: action.spaceNewDocs };
      
    case 'CLEAR_SELECTION':
      return { ...state, selectedDoc: null, docContent: '' };
      
    default:
      return state;
  }
}

// ============ Hook ============

export function useDocLoader({
  api,
  foldersLoaded,
  expandedFolders,
  setExpandedFolders,
  folderDocs,
  refreshFolder,
  hasPendingChanges,
  beforeLoadDoc,
  onAfterLoadDoc,
  setError,
  onAlert,
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Refs
  const editGateInFlightRef = useRef(false);
  const isHydratingContentRef = useRef(false);
  const lastSavedContentRef = useRef('');
  const lastSpaceSnapshotRef = useRef({ space: '', relPaths: new Set() });
  const editorScrollRef = useRef(null);

  // ---- 辅助函数 ----
  const getStableId = useCallback((doc) => {
    return String(doc?.stable_id || doc?.stableId || '').trim();
  }, []);

  const isNewerUpdatedAt = (a, b) => {
    const ta = Date.parse(a || '');
    const tb = Date.parse(b || '');
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
    return String(a || '') > String(b || '');
  };

  const computeLineChangeSnippet = (localText, remoteText, context = 3) => {
    const a = String(localText ?? '').replace(/\r\n/g, '\n').split('\n');
    const b = String(remoteText ?? '').replace(/\r\n/g, '\n').split('\n');
    const min = Math.min(a.length, b.length);
    let start = 0;
    while (start < min && a[start] === b[start]) start += 1;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
      endA -= 1;
      endB -= 1;
    }
    const aFrom = Math.max(0, start - context);
    const bFrom = Math.max(0, start - context);
    const aTo = Math.min(a.length, endA + 1 + context);
    const bTo = Math.min(b.length, endB + 1 + context);
    return {
      startLine: start + 1,
      local: a.slice(aFrom, aTo).join('\n'),
      remote: b.slice(bFrom, bTo).join('\n'),
    };
  };

  // ---- 清除选择状态 ----
  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
    clearLastUrl();
  }, []);

  // ---- URL 同步 ----
  const updateUrlForDoc = useCallback(
    (doc, mode = 'replace') => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        if (!doc) {
          params.delete('id');
          params.delete('doc');
        } else {
          const stableId = getStableId(doc);
          const relPath = String(doc?.rel_path || '').trim();
          if (stableId) params.set('id', stableId);
          else params.delete('id');
          if (relPath) params.set('doc', relPath);
          else params.delete('doc');
        }
        url.search = params.toString();
        if (mode === 'push') window.history.pushState({}, '', url);
        else window.history.replaceState({}, '', url);
      } catch {
        // ignore
      }
    },
    [getStableId],
  );

  // ---- Setters ----
  const setSelectedDoc = useCallback((valueOrUpdater) => {
    const prev = stateRef.current.selectedDoc;
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    dispatch({ type: 'SET_SELECTED_DOC', doc: next });
  }, []);

  const setDocContent = useCallback((valueOrUpdater) => {
    const prev = stateRef.current.docContent;
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    dispatch({ type: 'SET_DOC_CONTENT', content: next });
  }, []);

  const setDiffGate = useCallback((valueOrUpdater) => {
    const prev = stateRef.current.diffGate;
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    dispatch({ type: 'SET_DIFF_GATE', diffGate: next });
  }, []);

  const setSpaceNewDocs = useCallback((valueOrUpdater) => {
    const prev = stateRef.current.spaceNewDocs;
    const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
    dispatch({ type: 'SET_SPACE_NEW_DOCS', spaceNewDocs: next });
  }, []);

  // ---- 加载文档 ----
  const loadDocRaw = useCallback(
    async (doc, options = {}) => {
      if (!doc?.rel_path) return;
      
      const prevSelected = stateRef.current.selectedDoc;
      if (typeof beforeLoadDoc === 'function' && prevSelected?.rel_path && prevSelected.rel_path !== doc.rel_path) {
        const ok = await beforeLoadDoc(doc);
        if (!ok) return;
      }
      
      dispatch({ type: 'LOAD_DOC_START' });
      setError?.('');
      
      try {
        // 先验证文档是否存在
        const { content } = await api.getDocContent(doc.rel_path);
        
        // 文档存在，更新 URL
        const urlMode = options?.urlMode;
        if (urlMode === 'push') updateUrlForDoc(doc, 'push');
        else if (urlMode === 'replace') updateUrlForDoc(doc, 'replace');
        else if (urlMode !== 'none') {
          if (prevSelected?.rel_path !== doc.rel_path) updateUrlForDoc(doc, 'push');
        }

        dispatch({ type: 'SET_SELECTED_DOC', doc });

        // 展开父文件夹
        const parts = doc.rel_path.split('/');
        const newExpanded = new Set(expandedFolders);
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          newExpanded.add(currentPath);
        }
        setExpandedFolders(newExpanded);

        // 预加载侧边栏
        const shouldPreloadSidebar = options?.preloadSidebar !== false;
        if (shouldPreloadSidebar) {
          for (let i = 0; i < parts.length - 1; i++) {
            const folderPath = parts.slice(0, i + 1).join('/');
            if (!folderPath) continue;
            if (!folderDocs[folderPath]) {
              await refreshFolder(folderPath).catch(() => {});
            }
          }
        }

        isHydratingContentRef.current = true;
        lastSavedContentRef.current = content;
        dispatch({ type: 'LOAD_DOC_SUCCESS', doc, content });
        onAfterLoadDoc?.({ doc, content });
        setTimeout(() => {
          isHydratingContentRef.current = false;
        }, 0);
      } catch (err) {
        if (isNotFoundError(err)) {
          clearSelection();
        }
        setError?.(err.message);
      } finally {
        dispatch({ type: 'LOAD_DOC_FINISH' });
      }
    },
    [
      api,
      beforeLoadDoc,
      expandedFolders,
      folderDocs,
      onAfterLoadDoc,
      refreshFolder,
      setExpandedFolders,
      setError,
      updateUrlForDoc,
      clearSelection,
    ],
  );

  // ---- 通过 stable_id 打开文档 ----
  const openDocByStableId = useCallback(
    async (stableId, meta = {}, options = {}) => {
      try {
        const fallbackRelPath = String(meta?.fallbackRelPath || '').trim();
        if (!stableId && fallbackRelPath) {
          await loadDocRaw(
            { rel_path: fallbackRelPath, description: '', updated_at: new Date().toISOString() },
            options,
          );
          return;
        }
        const doc = await api.getDocById(stableId);
        await loadDocRaw(doc, options);
      } catch (err) {
        const fallbackRelPath = String(meta?.fallbackRelPath || '').trim();
        if (fallbackRelPath) {
          try {
            await loadDocRaw(
              { rel_path: fallbackRelPath, description: '', updated_at: new Date().toISOString() },
              options,
            );
            return;
          } catch (e2) {
            onAlert?.('Open link failed', e2.message);
            return;
          }
        }
        onAlert?.('Open link failed', err.message);
      }
    },
    [api, loadDocRaw, onAlert],
  );

  // ---- 从 URL 恢复文档 ----
  const openFromUrl = useCallback(
    async (mode = 'replace') => {
      if (typeof window === 'undefined') return;
      
      restoreLastUrl();
      
      const params = new URLSearchParams(window.location.search || '');
      const id = String(params.get('id') || '').trim();
      const rel = String(params.get('doc') || '').trim();
      
      if (!id && !rel) return;
      
      const decodedRel = rel ? decodeURIComponent(rel) : rel;
      try {
        if (id) {
          await openDocByStableId(id, { fallbackRelPath: decodedRel }, { urlMode: mode === 'push' ? 'push' : 'none' });
        } else {
          await loadDocRaw(
            { rel_path: decodedRel, description: '', updated_at: new Date().toISOString() },
            { urlMode: mode === 'push' ? 'push' : 'none' },
          );
        }
      } catch (e) {
        clearSelection();
        setError?.(e?.message || String(e));
      }
    },
    [loadDocRaw, openDocByStableId, setError, clearSelection],
  );

  // ---- URL 同步 effect ----
  useEffect(() => {
    if (!state.selectedDoc) return;
    updateUrlForDoc(state.selectedDoc, 'replace');
  }, [state.selectedDoc?.rel_path, state.selectedDoc?.stable_id, state.selectedDoc?.stableId, state.selectedDoc, updateUrlForDoc]);

  useEffect(() => {
    saveLastUrl();
  }, [state.selectedDoc?.rel_path, state.selectedDoc?.stable_id]);

  // ---- 初始化：从 URL 恢复文档 ----
  useEffect(() => {
    if (!foldersLoaded) return;
    openFromUrl('replace');
  }, [foldersLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 浏览器前进/后退 ----
  useEffect(() => {
    if (!foldersLoaded) return;
    const onPopState = () => openFromUrl('replace');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [foldersLoaded, openFromUrl]);

  // ---- 当前 space ----
  const currentSpace = useMemo(() => {
    const rel = state.selectedDoc?.rel_path;
    if (!rel) return '';
    return String(rel).split('/')[0] || '';
  }, [state.selectedDoc?.rel_path]);

  // ---- 编辑前检查远端更新 ----
  const ensureLatestBeforeEdit = useCallback(async () => {
    const selectedDoc = stateRef.current.selectedDoc;
    const docContent = stateRef.current.docContent;
    const diffGate = stateRef.current.diffGate;
    
    if (!selectedDoc?.rel_path) return true;
    if (editGateInFlightRef.current) return false;
    if (diffGate) return false;
    if (hasPendingChanges && !isHydratingContentRef.current) return true;

    editGateInFlightRef.current = true;
    let openedDiffGate = false;
    
    try {
      const meta = await api.getDocMeta(selectedDoc.rel_path);
      const remoteUpdatedAt = meta?.updated_at;
      const localUpdatedAt = selectedDoc.updated_at;
      
      if (!remoteUpdatedAt || !localUpdatedAt || !isNewerUpdatedAt(remoteUpdatedAt, localUpdatedAt)) {
        editGateInFlightRef.current = false;
        return true;
      }

      if (!hasPendingChanges || isHydratingContentRef.current) {
        await loadDocRaw({ ...selectedDoc, updated_at: remoteUpdatedAt, description: meta?.description ?? selectedDoc.description });
        editGateInFlightRef.current = false;
        return true;
      }

      const { content: remoteContent } = await api.getDocContent(selectedDoc.rel_path);
      setDiffGate({
        rel_path: selectedDoc.rel_path,
        remoteUpdatedAt,
        local: docContent,
        remote: remoteContent,
        snippet: computeLineChangeSnippet(docContent, remoteContent),
      });
      openedDiffGate = true;
      return false;
    } catch (err) {
      if (isNotFoundError(err)) {
        clearSelection();
      }
      editGateInFlightRef.current = false;
      return true;
    } finally {
      if (!openedDiffGate) editGateInFlightRef.current = false;
    }
  }, [api, hasPendingChanges, loadDocRaw, setDiffGate, clearSelection]);

  // ---- 检查远端更新（窗口获得焦点时） ----
  const checkForRemoteUpdatesOnce = useCallback(async () => {
    const selectedDoc = stateRef.current.selectedDoc;
    if (!selectedDoc?.rel_path) return;
    
    try {
      const meta = await api.getDocMeta(selectedDoc.rel_path);
      const remoteUpdatedAt = meta?.updated_at;
      const localUpdatedAt = selectedDoc.updated_at;
      
      if (remoteUpdatedAt && localUpdatedAt && isNewerUpdatedAt(remoteUpdatedAt, localUpdatedAt)) {
        if (!hasPendingChanges && !isHydratingContentRef.current) {
          await loadDocRaw({ 
            ...selectedDoc, 
            updated_at: remoteUpdatedAt, 
            description: meta?.description ?? selectedDoc.description 
          });
        }
      }
    } catch (err) {
      if (isNotFoundError(err)) {
        clearSelection();
      }
    }
  }, [api, hasPendingChanges, loadDocRaw, clearSelection]);

  // ---- 检查 space 中的新文档 ----
  const checkSpaceNewDocsOnce = useCallback(async () => {
    if (!currentSpace) {
      setSpaceNewDocs(null);
      lastSpaceSnapshotRef.current = { space: '', relPaths: new Set() };
      return;
    }
    
    try {
      const docs = await api.listDocs(currentSpace, true);
      const currentSet = new Set((docs || []).map((d) => d?.rel_path).filter(Boolean));
      const prev = lastSpaceSnapshotRef.current;

      if (prev.space !== currentSpace) {
        lastSpaceSnapshotRef.current = { space: currentSpace, relPaths: currentSet };
        setSpaceNewDocs(null);
        return;
      }

      let addedCount = 0;
      let latestRelPath = '';
      currentSet.forEach((p) => {
        if (!prev.relPaths.has(p)) {
          addedCount += 1;
          latestRelPath = p;
        }
      });
      if (addedCount > 0) {
        setSpaceNewDocs({ space: currentSpace, count: addedCount, latestRelPath });
      }
      lastSpaceSnapshotRef.current = { space: currentSpace, relPaths: currentSet };
    } catch (err) {
      if (isNotFoundError(err)) {
        setSpaceNewDocs(null);
        lastSpaceSnapshotRef.current = { space: '', relPaths: new Set() };
      }
    }
  }, [api, currentSpace, setSpaceNewDocs]);

  // ---- 窗口焦点/可见性变化时检查更新 ----
  useEffect(() => {
    const onFocus = () => {
      checkForRemoteUpdatesOnce();
      checkSpaceNewDocsOnce();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkForRemoteUpdatesOnce();
        checkSpaceNewDocsOnce();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkForRemoteUpdatesOnce, checkSpaceNewDocsOnce]);

  return {
    // State
    selectedDoc: state.selectedDoc,
    docContent: state.docContent,
    isLoadingContent: state.isLoadingContent,
    diffGate: state.diffGate,
    spaceNewDocs: state.spaceNewDocs,
    currentSpace,
    // Refs
    editorScrollRef,
    isHydratingContentRef,
    lastSavedContentRef,
    editGateInFlightRef,
    lastSpaceSnapshotRef,
    // Setters
    setSelectedDoc,
    setDocContent,
    setDiffGate,
    setSpaceNewDocs,
    // Actions
    getStableId,
    updateUrlForDoc,
    loadDocRaw,
    openDocByStableId,
    openFromUrl,
    ensureLatestBeforeEdit,
    checkForRemoteUpdatesOnce,
    checkSpaceNewDocsOnce,
    clearSelection,
  };
}

