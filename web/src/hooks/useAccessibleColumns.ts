import { useMemo, useState, useCallback, useEffect } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { useAccessibility, type AccessibilityMode } from '../store/accessibility';
import useIsMobile from './useIsMobile';

/**
 * Column priority for accessibility mode:
 * - P0 (default): always visible
 * - P1: visible in large, hidden in xlarge
 * - P2: hidden in both large and xlarge
 */
export type ColumnPriority = 0 | 1 | 2;

export interface AccessibleColumn {
  /** Column priority. Default 0 (always visible). */
  a11yPriority?: ColumnPriority;
}

/** Extend antd column with a11y priority */
export type AccessibleColumnsType<T> = (ColumnsType<T>[number] & AccessibleColumn)[];

function shouldHide(priority: ColumnPriority, mode: AccessibilityMode): boolean {
  if (mode === 'normal') return false;
  if (priority === 0) return false;
  if (priority === 2) return true; // hidden in large & xlarge
  // P1: hidden only in xlarge
  return mode === 'xlarge';
}

interface UseAccessibleColumnsResult<T> {
  /** Filtered columns for the Table */
  columns: ColumnsType<T>;
  /** Names of hidden columns (for "show more" UI) */
  hiddenColumnTitles: string[];
  /** Whether any columns are hidden */
  hasHiddenColumns: boolean;
  /** Set of column keys the user manually restored */
  restoredKeys: Set<string>;
  /** Toggle a restored column */
  toggleRestoreColumn: (key: string) => void;
  /** Restore all hidden columns */
  restoreAll: () => void;
}

export function useAccessibleColumns<T>(
  allColumns: AccessibleColumnsType<T>,
): UseAccessibleColumnsResult<T> {
  const { mode } = useAccessibility();
  const isMobile = useIsMobile();
  const [restoredKeys, setRestoredKeys] = useState<Set<string>>(new Set());

  // Reset restored keys when mode changes
  useEffect(() => {
    setRestoredKeys(new Set());
  }, [mode]);

  const toggleRestoreColumn = useCallback((key: string) => {
    setRestoredKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setRestoredKeys(new Set(allColumns
      .filter((col) => shouldHide((col as AccessibleColumn).a11yPriority ?? 0, mode))
      .map((col) => (col as { key?: string }).key ?? '')
      .filter(Boolean),
    ));
  }, [allColumns, mode]);

  const { columns, hiddenColumnTitles } = useMemo(() => {
    // Mobile uses its own card layout, don't filter columns
    // Normal mode: return all columns as-is
    if (isMobile || mode === 'normal') {
      return { columns: allColumns as ColumnsType<T>, hiddenColumnTitles: [] as string[] };
    }

    const visible: ColumnsType<T>[number][] = [];
    const hidden: string[] = [];

    for (const col of allColumns) {
      const priority = (col as AccessibleColumn).a11yPriority ?? 0;
      const key = (col as { key?: string }).key ?? '';
      const title = typeof col.title === 'string' ? col.title : '';

      if (shouldHide(priority, mode) && !restoredKeys.has(key)) {
        hidden.push(title);
      } else {
        visible.push(col);
      }
    }

    return {
      columns: visible as ColumnsType<T>,
      hiddenColumnTitles: hidden,
    };
  }, [allColumns, mode, isMobile, restoredKeys]);

  return {
    columns,
    hiddenColumnTitles,
    hasHiddenColumns: hiddenColumnTitles.length > 0,
    restoredKeys,
    toggleRestoreColumn,
    restoreAll,
  };
}
