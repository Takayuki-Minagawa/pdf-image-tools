/** 配列の要素を1つ移動した新しい配列を返す（入力は変更しない）。範囲外の指定ではコピーを返す。 */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** 1始まりのページ番号範囲 [start, end] を0始まりのインデックス配列にする。 */
export function pageRangeToIndices(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
}
