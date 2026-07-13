import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { buildPdfFromPagePlan, extractPdfPageIndices } from './pdfEditor';
import { sanitizeFilename } from './download';
import { visualPointToPdf } from './pdfEditOperations';

async function createSourcePdf() {
  const document = await PDFDocument.create();
  document.setTitle('Page plan test');
  document.addPage([200, 300]);
  document.addPage([400, 500]);
  return document.save();
}

describe('buildPdfFromPagePlan', () => {
  it('reorders, duplicates, rotates, and inserts blank pages', async () => {
    const source = await createSourcePdf();
    const output = await buildPdfFromPagePlan(source, [
      { id: 'second', sourcePageIndex: 1, rotation: 90 },
      { id: 'first', sourcePageIndex: 0, rotation: 0 },
      { id: 'first-copy', sourcePageIndex: 0, rotation: 180 },
      { id: 'blank', sourcePageIndex: null, rotation: 0, width: 612, height: 792 },
    ]);
    const result = await PDFDocument.load(output);

    expect(result.getPageCount()).toBe(4);
    expect(result.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
    expect(result.getPage(0).getRotation().angle).toBe(90);
    expect(result.getPage(2).getRotation().angle).toBe(180);
    expect(result.getPage(3).getSize()).toEqual({ width: 612, height: 792 });
    expect(result.getTitle()).toBe('Page plan test');
  });

  it('does not allow an empty PDF', async () => {
    await expect(buildPdfFromPagePlan(await createSourcePdf(), [])).rejects.toThrow(
      'PDFには1ページ以上必要です',
    );
  });
});

describe('extractPdfPageIndices', () => {
  it('extracts arbitrary pages while removing duplicate indices', async () => {
    const output = await extractPdfPageIndices(await createSourcePdf(), [1, 1, 0]);
    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(2);
    expect(result.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
  });
});

describe('sanitizeFilename', () => {
  it('removes reserved and control characters', () => {
    expect(sanitizeFilename(' invoice:/\u0001*.pdf. ', 'fallback')).toBe('invoice____.pdf');
    expect(sanitizeFilename('   ', 'fallback')).toBe('fallback');
  });
});

describe('visualPointToPdf', () => {
  it('maps the rotated visual page coordinate to PDF user space', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 300]);
    page.setRotation(degrees(90));
    expect(visualPointToPdf(page, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(visualPointToPdf(page, 300, 200)).toEqual({ x: 200, y: 300 });

    page.setRotation(degrees(270));
    expect(visualPointToPdf(page, 0, 0)).toEqual({ x: 200, y: 300 });
    expect(visualPointToPdf(page, 300, 200)).toEqual({ x: 0, y: 0 });
  });
});
