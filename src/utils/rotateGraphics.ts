import type { PdfGraphic } from '../types/pdfGraphics';

type PageSize = { width: number; height: number };

/** Rotate marks with their pages, retaining layer order and unselected-page content. */
export async function rotateGraphicsClockwise(
  graphics: PdfGraphic[],
  selectedPages: Set<number>,
  pageSizes: Map<number, PageSize>,
  pageCount: number,
  rotateImage: (dataUrl: string) => Promise<string>,
): Promise<PdfGraphic[]> {
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new Error('ページ数が不正なため図形を回転できません。');
  }
  const targets = new Set([...selectedPages].filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount));
  if (targets.size === 0 || graphics.length === 0) return graphics;

  // A single all-page mark cannot retain different orientations on different pages.
  // Expand beside its original layer before rotation, including unselected pages.
  const scoped = graphics.flatMap((graphic) => graphic.pageIndex === -1
    ? Array.from({ length: pageCount }, (_, pageIndex) => ({
      ...graphic, pageIndex, id: pageIndex === 0 ? graphic.id : crypto.randomUUID(),
    }))
    : [graphic]);

  // Validate before invoking image work. No input objects are changed on failure.
  for (const graphic of scoped) {
    if (!targets.has(graphic.pageIndex)) continue;
    const size = pageSizes.get(graphic.pageIndex);
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      throw new Error(`${graphic.pageIndex + 1} ページの大きさを取得できないため図形を回転できません。`);
    }
    if (graphic.kind === 'image' && !graphic.imageDataUrl) {
      throw new Error('回転する画像のデータがありません。');
    }
  }

  const rotatedImages = new Map<string, Promise<string>>();
  return Promise.all(scoped.map(async (graphic) => {
    if (!targets.has(graphic.pageIndex)) return graphic;
    const size = pageSizes.get(graphic.pageIndex)!;
    const line = graphic.kind === 'line' || graphic.kind === 'arrow';
    const rotated: PdfGraphic = {
      ...graphic,
      x: size.height - graphic.y - (line ? 0 : graphic.height),
      y: graphic.x,
      width: line ? -graphic.height : graphic.height,
      height: graphic.width,
    };
    if (graphic.kind === 'image') {
      const source = graphic.imageDataUrl!;
      let promise = rotatedImages.get(source);
      if (!promise) {
        promise = rotateImage(source);
        rotatedImages.set(source, promise);
      }
      rotated.imageDataUrl = await promise;
    }
    return rotated;
  }));
}
