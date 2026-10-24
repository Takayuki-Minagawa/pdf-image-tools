import type { PdfGraphic, WatermarkConfig } from '../types/pdfGraphics';
import type { RecipeGraphic } from '../types/recipe';

/**
 * PDF編集画面へ適用するため、レシピの図形・透かしを現在の文書に合わせる。
 * 図形は新しいIDで複製し、存在しないページ向けのものと、ファイルパス指定だけの画像
 * （CLI専用）は除外する。存在しないページ向けの透かしは全ページ指定にする。
 */
export function prepareRecipeGraphicsForEditor(
  recipeGraphics: RecipeGraphic[],
  recipeWatermark: WatermarkConfig,
  pageCount: number,
  createId: () => string = () => crypto.randomUUID(),
) {
  const candidates: PdfGraphic[] = recipeGraphics
    .filter((graphic) => graphic.pageIndex < pageCount)
    .map((graphic) => {
      const copy: PdfGraphic & { imagePath?: string } = { ...structuredClone(graphic), id: createId() };
      delete copy.imagePath;
      return copy;
    });
  const isMissingImage = (graphic: PdfGraphic) => graphic.kind === 'image' && !graphic.imageDataUrl;
  return {
    graphics: candidates.filter((graphic) => !isMissingImage(graphic)),
    skippedImageCount: candidates.filter(isMissingImage).length,
    watermark: {
      ...recipeWatermark,
      pageIndex: recipeWatermark.pageIndex < pageCount ? recipeWatermark.pageIndex : -1,
    },
  };
}
