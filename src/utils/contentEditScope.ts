import type { ContentEdit } from '../types/contentEdit';
import type { PagePlanEntry } from '../types/pdfEdit';

/**
 * コンテンツ編集は「認識対象の id」と「適用先のページエントリー」の組で一意になる
 * （複製したページには、同じ対象への別の編集を持てる）。
 */
function isSameScope(a: ContentEdit, b: ContentEdit): boolean {
  return a.target.id === b.target.id && a.pageEntryId === b.pageEntryId;
}

/** 同じ対象・同じページへの編集があれば置き換え、なければ末尾に追加する。 */
export function upsertScopedContentEdit(edits: ContentEdit[], edit: ContentEdit): ContentEdit[] {
  const index = edits.findIndex((entry) => isSameScope(entry, edit));
  if (index === -1) return [...edits, edit];
  const next = [...edits];
  next[index] = edit;
  return next;
}

/** incoming と同じ対象・同じページの既存編集を取り除き、incoming を末尾に加える。 */
export function mergeScopedContentEdits(edits: ContentEdit[], incoming: ContentEdit[]): ContentEdit[] {
  return [
    ...edits.filter((edit) => !incoming.some((candidate) => isSameScope(candidate, edit))),
    ...incoming,
  ];
}

/**
 * 表示中ページに適用される編集を返す。ページエントリーに紐づかない古い編集は、
 * 元ページ番号で判定する。
 */
export function contentEditsForPage(
  edits: ContentEdit[],
  pageEntryId: string | undefined,
  sourcePageIndex: number,
): ContentEdit[] {
  return edits.filter((edit) =>
    edit.pageEntryId ? edit.pageEntryId === pageEntryId : edit.target.pageIndex === sourcePageIndex,
  );
}

/** 元ページ番号から、そのページを最初に表示するページエントリーへ編集を紐づける。 */
export function scopeContentEditsToPagePlan(edits: ContentEdit[], entries: PagePlanEntry[]): ContentEdit[] {
  return edits.map((edit) => ({
    ...edit,
    pageEntryId: entries.find((entry) => entry.sourcePageIndex === edit.target.pageIndex)?.id,
  }) as ContentEdit);
}
