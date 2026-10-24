import { useEffect } from 'react';

/** 未保存の変更がある間、ページ離脱時にブラウザの確認ダイアログを出す。 */
export function useBeforeUnloadWarning(enabled: boolean) {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!enabled) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled]);
}

/** Ctrl/Cmd+Z で元に戻す、Shift を加えてやり直す。テキスト入力中は対象外。 */
export function useUndoRedoShortcut(undo: () => void, redo: () => void) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const isTextInput = target?.matches('input, textarea, [contenteditable="true"]');
      if (isTextInput) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [undo, redo]);
}
