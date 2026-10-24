/**
 * ページ選択（表示順の0始まりインデックス集合）の操作。
 * extend が true で起点がある場合は、起点から index までを範囲選択に加える。
 */
export function togglePageInSelection(
  selected: ReadonlySet<number>,
  index: number,
  anchor: number | null,
  extend: boolean,
): Set<number> {
  const next = new Set(selected);
  if (extend && anchor !== null) {
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    for (let page = start; page <= end; page++) next.add(page);
  } else if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}

/** すべて選択済みなら解除し、そうでなければ全ページを選択する。 */
export function toggleSelectAllPages(selected: ReadonlySet<number>, pageCount: number): Set<number> {
  if (selected.size === pageCount) return new Set();
  return new Set(Array.from({ length: pageCount }, (_, index) => index));
}

/** 奇数／偶数ページ（1始まりのページ番号で判定）を選択する。 */
export function selectPagesByParity(pageCount: number, parity: 'odd' | 'even'): Set<number> {
  const remainder = parity === 'odd' ? 1 : 0;
  return new Set(
    Array.from({ length: pageCount }, (_, index) => index).filter((index) => (index + 1) % 2 === remainder),
  );
}
