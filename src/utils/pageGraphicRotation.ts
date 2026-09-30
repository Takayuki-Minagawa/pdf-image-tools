import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PagePlanEntry } from '../types/pdfEdit';
import type { PdfGraphic } from '../types/pdfGraphics';
import { rotateGraphicsClockwise } from './rotateGraphics';
import { rotateGraphicImage } from './rotateGraphicImage';

/** Rotate marks with their source page, before any page-index remapping. */
export async function rotateGraphicsToPagePlan(
  pdf: PDFDocumentProxy,
  graphics: PdfGraphic[],
  previousEntries: PagePlanEntry[],
  nextEntries: PagePlanEntry[],
) {
  if (graphics.length === 0) return graphics;
  const nextRotations = new Map(nextEntries.map((entry) => [entry.id, entry.rotation]));
  const turns = previousEntries.map((entry) => ((nextRotations.get(entry.id) ?? entry.rotation) - entry.rotation + 360) % 360 / 90);
  const pageSizes = new Map<number, { width: number; height: number }>();
  for (const [index, count] of turns.entries()) {
    if (!count) continue;
    const entry = previousEntries[index];
    if (entry.sourcePageIndex === null) {
      const swapped = entry.rotation === 90 || entry.rotation === 270;
      pageSizes.set(index, {
        width: (swapped ? entry.height : entry.width) ?? (swapped ? 841.89 : 595.28),
        height: (swapped ? entry.width : entry.height) ?? (swapped ? 595.28 : 841.89),
      });
    } else {
      const page = await pdf.getPage(entry.sourcePageIndex + 1);
      const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rotation) % 360 });
      pageSizes.set(index, { width: viewport.width, height: viewport.height });
    }
  }
  let rotated = graphics;
  for (let step = 0; step < 3; step++) {
    const selected = new Set(turns.flatMap((count, index) => count > step ? [index] : []));
    if (selected.size === 0) break;
    rotated = await rotateGraphicsClockwise(rotated, selected, pageSizes, previousEntries.length, rotateGraphicImage);
    for (const index of selected) {
      const size = pageSizes.get(index)!;
      pageSizes.set(index, { width: size.height, height: size.width });
    }
  }
  return rotated;
}
