/**
 * レシピを1つのPDFへ適用する（バッチ処理・CLI 共通）。
 * コンテンツ編集ルールは pdf.js で各ページを解析して解決してから、共通パイプラインで描画する。
 */
import type { ContentRule, PdfEditRecipe, RecipeGraphic } from '../types/recipe';
import type { PdfGraphic } from '../types/pdfGraphics';
import { resolveContentRules, type ResolvedContentRules } from './contentRules';
import { buildEditedPdf } from './editPipeline';
import { openPdfForInspection } from './pdfInspection';

export interface ApplyRecipeOptions {
  fileName: string;
  allowCoverOnly?: boolean;
  /** imagePath だけを持つ画像を data URL に解決する（CLI が実装）。未指定なら例外 */
  resolveImage?: (graphic: RecipeGraphic) => Promise<string>;
}

export interface ApplyRecipeResult {
  bytes: Uint8Array;
  /** contentRules と同じ順の一致件数 */
  matchCounts: number[];
  unmatched: ContentRule[];
}

async function materializeGraphics(
  graphics: RecipeGraphic[],
  resolveImage: ApplyRecipeOptions['resolveImage'],
): Promise<PdfGraphic[]> {
  return Promise.all(graphics.map(async (graphic) => {
    const { imagePath, ...rest } = graphic;
    if (graphic.kind !== 'image' || rest.imageDataUrl) return rest;
    if (!imagePath || !resolveImage) {
      throw new Error(`「${graphic.label}」の画像データがありません（imagePath はCLIでのみ使用できます）`);
    }
    return { ...rest, imageDataUrl: await resolveImage(graphic) };
  }));
}

export async function applyRecipeToPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  recipe: PdfEditRecipe,
  options: ApplyRecipeOptions,
): Promise<ApplyRecipeResult> {
  if (recipe.regionRedaction) {
    throw new Error('領域除去レシピは「領域除去」画面または CLI の redact-regions で実行し、出力を目視確認してください');
  }
  const graphics = await materializeGraphics(recipe.graphics, options.resolveImage);

  let contentEdits: ResolvedContentRules = { edits: [], matchCounts: [], unmatched: [] };
  if (recipe.contentRules.length > 0) {
    const opened = await openPdfForInspection(pdfBytes);
    try {
      contentEdits = await resolveContentRules(recipe.contentRules, opened.pageCount, opened.readPage);
    } finally {
      await opened.destroy();
    }
  }

  const bytes = await buildEditedPdf(pdfBytes, {
    pageEntries: [],
    textBoxes: recipe.textBoxes,
    headerFooter: recipe.headerFooter,
    pageNumbering: recipe.pageNumbering,
    contentEdits: contentEdits.edits,
    graphics,
    watermark: recipe.watermark,
  }, { fileName: options.fileName, allowCoverOnly: options.allowCoverOnly });

  return { bytes, matchCounts: contentEdits.matchCounts, unmatched: contentEdits.unmatched };
}
