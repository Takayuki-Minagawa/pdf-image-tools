import type { TextBoxConfig } from '../types/pdfEdit';

/**
 * ページ並び替え/削除後も各テキストボックスが同じ「元ページ」を指し続けるように
 * pageIndex（表示順インデックス）を変換する。対象ページが削除された場合は取り除く。
 */
export function remapTextBoxesForPageOrder(
  textBoxes: TextBoxConfig[],
  prevOrder: number[],
  nextOrder: number[],
) {
  return textBoxes.flatMap((box) => {
    if (box.pageIndex === -1) return [box];

    const originalPageIndex = prevOrder[box.pageIndex];
    if (originalPageIndex === undefined) return [];

    const nextDisplayIndex = nextOrder.indexOf(originalPageIndex);
    if (nextDisplayIndex === -1) return [];

    return [{ ...box, pageIndex: nextDisplayIndex }];
  });
}

export function isIdentityPageOrder(pageOrder: number[]) {
  return pageOrder.every((pageIndex, index) => pageIndex === index);
}
