import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useIsMobile from './useIsMobile';

interface UseRowHighlightOptions {
  data: { id: number }[];
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  findPage?: (id: number, size: number) => Promise<number>;
  idPrefix: string;
}

interface UseRowHighlightReturn {
  setHighlightId: (id: number | null) => void;
  setHighlightIds: (ids: number[]) => void;
  highlightIds: number[];
  rowClassName: (record: { id: number }) => string;
  isHighlighted: (id: number) => boolean;
  onRow: (record: { id: number }) => { id: string };
}

const HIGHLIGHT_DURATION = 15000;

export default function useRowHighlight(options: UseRowHighlightOptions): UseRowHighlightReturn {
  const { data, page, pageSize, loading, idPrefix } = options;
  const isMobile = useIsMobile();
  const [highlightIds, setHighlightIdsState] = useState<number[]>([]);
  const scrollTargetId = useRef<number | null>(null);
  const needsLocate = useRef(false);
  const scrollDone = useRef(false);

  // Stable refs for callbacks that change every render — keeps effect deps stable
  const onPageChangeRef = useRef(options.onPageChange);
  onPageChangeRef.current = options.onPageChange;
  const findPageRef = useRef(options.findPage);
  findPageRef.current = options.findPage;

  const clearHighlight = useCallback(() => {
    setHighlightIdsState([]);
    scrollTargetId.current = null;
    needsLocate.current = false;
    scrollDone.current = false;
  }, []);

  const setHighlightId = useCallback((id: number | null) => {
    if (id === null) {
      clearHighlight();
    } else {
      scrollTargetId.current = id;
      needsLocate.current = true;
      scrollDone.current = false;
      setHighlightIdsState([id]);
    }
  }, [clearHighlight]);

  const setHighlightIds = useCallback((ids: number[]) => {
    if (ids.length === 0) {
      clearHighlight();
    } else {
      setHighlightIdsState(ids);
      scrollTargetId.current = ids[0];
      needsLocate.current = true;
      scrollDone.current = false;
    }
  }, [clearHighlight]);

  const doScrollTo = useCallback((targetId: number) => {
    const doScroll = () => {
      const el = document.getElementById(`${idPrefix}-row-${targetId}`);
      if (!el) return;
      // Restart CSS animation: remove class → force reflow → re-add class.
      // Runs inside rAF after React has committed, so no reconciler conflict.
      el.classList.remove('row-highlight');
      void el.offsetHeight; // force reflow to reset animation state
      el.classList.add('row-highlight');
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    };

    if (isMobile) {
      const t = setTimeout(doScroll, 500);
      return () => clearTimeout(t);
    } else {
      let cancelled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { if (!cancelled) doScroll(); });
      });
      return () => { cancelled = true; };
    }
  }, [idPrefix, isMobile]);

  // Main effect: locate target row, scroll to it, and set up the auto-clear timer.
  useEffect(() => {
    if (highlightIds.length === 0) return;
    if (loading) return;
    if (data.length === 0) return; // data not yet loaded, wait

    const primaryId = scrollTargetId.current ?? highlightIds[0];
    const inCurrentPage = data.some(item => item.id === primaryId);

    if (inCurrentPage && !scrollDone.current) {
      needsLocate.current = false;
      scrollDone.current = true;
      const scrollCleanup = doScrollTo(primaryId);
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => { scrollCleanup(); clearTimeout(timer); };
    }

    if (inCurrentPage && scrollDone.current) {
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => clearTimeout(timer);
    }

    if (!inCurrentPage && needsLocate.current && data.length > 0 && findPageRef.current) {
      needsLocate.current = false;
      let cancelled = false;
      findPageRef.current(primaryId, pageSize)
        .then((targetPage) => {
          if (cancelled) return;
          if (targetPage !== page) {
            onPageChangeRef.current(targetPage);
          } else {
            clearHighlight();
          }
        })
        .catch(clearHighlight);
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [highlightIds, data, loading, pageSize, page, doScrollTo, clearHighlight]);

  // Use a Set for O(1) lookup instead of O(n) Array.includes.
  const highlightSet = useMemo(() => new Set(highlightIds), [highlightIds]);

  const rowClassName = useCallback((record: { id: number }) => {
    return highlightSet.has(record.id) ? 'row-highlight' : '';
  }, [highlightSet]);

  const isHighlighted = useCallback((id: number) => {
    return highlightSet.has(id);
  }, [highlightSet]);

  const onRow = useCallback((record: { id: number }) => ({
    id: `${idPrefix}-row-${record.id}`,
  }), [idPrefix]);

  return {
    setHighlightId,
    setHighlightIds,
    highlightIds,
    rowClassName,
    isHighlighted,
    onRow,
  };
}
