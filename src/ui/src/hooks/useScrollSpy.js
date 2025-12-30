import { useEffect, useMemo, useState, useCallback, useRef } from 'react';

function getHeadingElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('h1,h2,h3'));
}

function computeHeadingTops(container, elements) {
  const containerRect = container.getBoundingClientRect();
  return elements.map((el) => ({
    el,
    top: el.getBoundingClientRect().top - containerRect.top + container.scrollTop,
    id: el.getAttribute('data-heading-id') || el.getAttribute('id') || '',
  }));
}

/**
 * useScrollSpy
 * - 只按稳定 id 工作（data-heading-id 或 id）
 * - 自动将 toc 的 id 顺序写入 DOM heading 的 data-heading-id（避免 text 匹配）
 */
export function useScrollSpy({ containerRef, toc, offset = 120 }) {
  const [activeId, setActiveId] = useState('');
  const isComposingRef = useRef(false);
  const pendingIdSyncRef = useRef(false);

  const tocIds = useMemo(() => (toc || []).map((t) => String(t?.id || '').trim()).filter(Boolean), [toc]);
  const tocIdsRef = useRef(tocIds);

  useEffect(() => {
    tocIdsRef.current = tocIds;
  }, [tocIds]);

  const syncHeadingIds = useCallback(() => {
    const container = containerRef?.current;
    const ids = tocIdsRef.current;
    if (!container || !ids.length) return;
    const headings = getHeadingElements(container);
    const n = Math.min(headings.length, ids.length);
    for (let i = 0; i < n; i++) {
      const nextId = ids[i];
      if (headings[i].getAttribute('data-heading-id') !== nextId) {
        headings[i].setAttribute('data-heading-id', nextId);
      }
    }
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };
    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      if (pendingIdSyncRef.current) {
        pendingIdSyncRef.current = false;
        syncHeadingIds();
      }
    };

    container.addEventListener('compositionstart', handleCompositionStart, true);
    container.addEventListener('compositionend', handleCompositionEnd, true);

    return () => {
      container.removeEventListener('compositionstart', handleCompositionStart, true);
      container.removeEventListener('compositionend', handleCompositionEnd, true);
    };
  }, [containerRef, syncHeadingIds]);

  // Ensure DOM headings have stable identifiers that match toc order.
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;
    if (!tocIds.length) return;

    // Wait a tick for Plate layout to settle.
    const t = setTimeout(() => {
      if (isComposingRef.current) {
        pendingIdSyncRef.current = true;
        return;
      }
      syncHeadingIds();
    }, 0);

    return () => clearTimeout(t);
  }, [containerRef, tocIds, syncHeadingIds]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;
    if (!tocIds.length) {
      setActiveId('');
      return;
    }

    let cached = [];
    let raf = 0;

    const resolve = () => {
      const headings = getHeadingElements(container);
      cached = computeHeadingTops(container, headings)
        .filter((x) => x.id)
        .sort((a, b) => a.top - b.top);
    };

    const computeActive = () => {
      if (!cached.length) resolve();
      if (!cached.length) {
        setActiveId('');
        return;
      }

      const activationLine = container.scrollTop + offset;
      let lastPassed = null;
      for (const item of cached) {
        if (item.top <= activationLine) lastPassed = item;
        else break;
      }
      setActiveId(lastPassed?.id || '');
    };

    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeActive);
    };

    resolve();
    computeActive();
    container.addEventListener('scroll', onScroll, { passive: true });

    // Re-resolve once after layout settles.
    const t = setTimeout(() => {
      resolve();
      computeActive();
    }, 0);

    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      container.removeEventListener('scroll', onScroll);
    };
  }, [containerRef, tocIds, offset]);

  const scrollToId = useCallback(
    (id) => {
      const container = containerRef?.current;
      const targetId = String(id || '').trim();
      if (!container || !targetId) return;
      const el = container.querySelector(`[data-heading-id="${CSS.escape(targetId)}"]`) || container.querySelector(`#${CSS.escape(targetId)}`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    },
    [containerRef],
  );

  return { activeId, scrollToId };
}

// ---- Pure helpers for minimal tests (no DOM dependency) ----

/**
 * @param {Array<{id:string, top:number}>} headings Sorted by top asc.
 * @param {number} scrollTop
 * @param {number} offset
 * @returns {string}
 */
export function pickActiveHeadingId(headings, scrollTop, offset = 120) {
  const activationLine = scrollTop + offset;
  let lastPassed = '';
  for (const h of headings || []) {
    if (!h?.id) continue;
    if (h.top <= activationLine) lastPassed = h.id;
    else break;
  }
  return lastPassed;
}
