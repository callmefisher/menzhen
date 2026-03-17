import { useState, useEffect, useCallback, useRef } from 'react';
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
  const { data, page, pageSize, loading, onPageChange, findPage, idPrefix } = options;
  const isMobile = useIsMobile();
  const [highlightIds, setHighlightIdsState] = useState<number[]>([]);
  const scrollTargetId = useRef<number | null>(null);
  // Controls: true = just set, need to locate page & scroll; false = done or user navigated away
  const needsLocate = useRef(false);
  // Controls: true = already scrolled for this highlight, don't scroll again on data refresh
  const scrollDone = useRef(false);

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
      setHighlightIdsState([id]);
      scrollTargetId.current = id;
      needsLocate.current = true;
      scrollDone.current = false;
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
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
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

  // Main effect: locate target row and scroll to it
  useEffect(() => {
    if (highlightIds.length === 0) return;
    if (loading) return; // wait for data to finish loading

    const primaryId = scrollTargetId.current ?? highlightIds[0];
    const inCurrentPage = data.some(item => item.id === primaryId);

    if (inCurrentPage && !scrollDone.current) {
      // Found — scroll once, then start auto-clear timer
      needsLocate.current = false;
      scrollDone.current = true;
      const scrollCleanup = doScrollTo(primaryId);
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => { scrollCleanup(); clearTimeout(timer); };
    }

    if (inCurrentPage && scrollDone.current) {
      // Already scrolled — just keep the highlight CSS alive with auto-clear
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => clearTimeout(timer);
    }

    if (!inCurrentPage && needsLocate.current && data.length > 0 && findPage) {
      // Not on current page, first attempt — ask backend
      needsLocate.current = false;
      findPage(primaryId, pageSize)
        .then((targetPage) => {
          if (targetPage !== page) {
            onPageChange(targetPage);
            // After page change, data will update and we'll re-enter this effect
          } else {
            clearHighlight();
          }
        })
        .catch(clearHighlight);
      const timer = setTimeout(clearHighlight, HIGHLIGHT_DURATION);
      return () => clearTimeout(timer);
    }
    // Not in current page and needsLocate is false — either waiting for page data to load
    // after findPage, or user manually changed page (which already calls setHighlightId(null)).
    // Don't clear here; let the 15s timeout or explicit clear handle it.
  }, [highlightIds, data, loading, findPage, pageSize, page, onPageChange, doScrollTo, clearHighlight]);

  const rowClassName = useCallback((record: { id: number }) => {
    return highlightIds.includes(record.id) ? 'row-highlight' : '';
  }, [highlightIds]);

  const isHighlighted = useCallback((id: number) => {
    return highlightIds.includes(id);
  }, [highlightIds]);

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
