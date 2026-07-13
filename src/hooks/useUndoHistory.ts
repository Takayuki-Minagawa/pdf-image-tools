import { useCallback, useEffect, useRef, useState } from 'react';

interface HistoryEntry<T> {
  label: string;
  value: T;
  signature: string;
  createdAt: number;
}

interface UseUndoHistoryOptions<T> {
  value: T;
  onRestore: (value: T) => void;
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
  label?: string;
}

export function useUndoHistory<T>({
  value,
  onRestore,
  enabled = true,
  limit = 50,
  debounceMs = 250,
  label = '編集',
}: UseUndoHistoryOptions<T>) {
  const restoringRef = useRef(false);
  const [historyState, setHistoryState] = useState<{ entries: HistoryEntry<T>[]; index: number }>({
    entries: [],
    index: -1,
  });
  const signature = JSON.stringify(value);

  useEffect(() => {
    if (!enabled) return;
    if (restoringRef.current) {
      restoringRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      const nextEntry: HistoryEntry<T> = {
        label,
        value: structuredClone(value),
        signature,
        createdAt: Date.now(),
      };
      setHistoryState((current) => {
        if (current.entries[current.index]?.signature === signature) return current;
        const entries = current.entries.slice(0, current.index + 1).concat(nextEntry).slice(-limit);
        return { entries, index: entries.length - 1 };
      });
    }, debounceMs);

    return () => window.clearTimeout(timeout);
  }, [debounceMs, enabled, label, limit, signature, value]);

  const restoreAt = useCallback((index: number) => {
    const entry = historyState.entries[index];
    if (!entry) return false;
    restoringRef.current = true;
    setHistoryState((current) => ({ ...current, index }));
    onRestore(structuredClone(entry.value));
    return true;
  }, [historyState.entries, onRestore]);

  const undo = useCallback(() => restoreAt(historyState.index - 1), [historyState.index, restoreAt]);
  const redo = useCallback(() => restoreAt(historyState.index + 1), [historyState.index, restoreAt]);

  const reset = useCallback((initialValue?: T) => {
    const nextEntries = initialValue === undefined ? [] : [{
      label: '開始',
      value: structuredClone(initialValue),
      signature: JSON.stringify(initialValue),
      createdAt: Date.now(),
    }];
    setHistoryState({ entries: nextEntries, index: nextEntries.length - 1 });
    restoringRef.current = false;
  }, []);

  return {
    undo,
    redo,
    reset,
    restoreAt,
    canUndo: historyState.index > 0,
    canRedo: historyState.index >= 0 && historyState.index < historyState.entries.length - 1,
    entries: historyState.entries.map((entry, index) => ({
      label: entry.label,
      createdAt: entry.createdAt,
      active: index === historyState.index,
      index,
    })),
    currentSignature: historyState.entries[historyState.index]?.signature ?? signature,
  };
}
