import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import {
  buildPdfFromPagePlan,
  copyPdfBytes,
  deletePdfPages,
  duplicatePagePlanSelection,
  extractPdfPageIndices,
  getUnrotatedPageSize,
  remapPageIndex,
  remapPageSelection,
  remapTextBoxesForPagePlan,
  remapWatermarkForPagePlan,
  reorderPdfPages,
  retainContentEditsForPagePlan,
} from './pdfEditor';
import { sanitizeFilename } from './download';
import { visualPointToPdf } from './pdfEditOperations';
import type { ContentEdit } from '../types/contentEdit';
import type { TextBoxConfig } from '../types/pdfEdit';
import { DEFAULT_WATERMARK } from '../types/pdfGraphics';

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
    expect(result.getPages().every((page) => page.node.has(PDFName.of('Parent')))).toBe(true);
  });

  it('does not allow an empty PDF', async () => {
    await expect(buildPdfFromPagePlan(await createSourcePdf(), [])).rejects.toThrow(
      'PDFには1ページ以上必要です',
    );
  });

  it('normalizes negative source rotations', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 300]);
    page.setRotation(degrees(-90));

    const output = await buildPdfFromPagePlan(await document.save(), [
      { id: 'rotated', sourcePageIndex: 0, rotation: 0 },
    ]);
    const result = await PDFDocument.load(output);

    expect(result.getPage(0).getRotation().angle).toBe(270);
  });

  it('removes AcroForm fields whose widgets belong only to deleted pages', async () => {
    const document = await PDFDocument.create();
    const keptPage = document.addPage([200, 300]);
    const removedPage = document.addPage([200, 300]);
    const form = document.getForm();
    form.createTextField('kept').addToPage(keptPage, { x: 10, y: 10, width: 80, height: 20 });
    form.createTextField('removed').addToPage(removedPage, { x: 10, y: 10, width: 80, height: 20 });

    const output = await buildPdfFromPagePlan(await document.save(), [
      { id: 'kept', sourcePageIndex: 0, rotation: 0 },
    ]);
    const result = await PDFDocument.load(output);

    expect(result.getForm().getFields().map((field) => field.getName())).toEqual(['kept']);
  });

  it('keeps page tree parents when reordering through the legacy API', async () => {
    const output = await reorderPdfPages(await createSourcePdf(), [1, 0]);
    const result = await PDFDocument.load(output);

    expect(result.getPageCount()).toBe(2);
    expect(result.getPages().every((page) => page.node.has(PDFName.of('Parent')))).toBe(true);
  });

  it('cleans up form fields on pages removed through the delete API', async () => {
    const document = await PDFDocument.create();
    const keptPage = document.addPage([200, 300]);
    const removedPage = document.addPage([200, 300]);
    const form = document.getForm();
    form.createTextField('kept').addToPage(keptPage, { x: 10, y: 10, width: 80, height: 20 });
    form.createTextField('removed').addToPage(removedPage, { x: 10, y: 10, width: 80, height: 20 });

    const result = await PDFDocument.load(await deletePdfPages(await document.save(), [1]));

    expect(result.getForm().getFields().map((field) => field.getName())).toEqual(['kept']);
    expect(result.getPages().every((page) => page.node.has(PDFName.of('Parent')))).toBe(true);
  });
});

describe('page plan helpers', () => {
  it('copies duplicated page-scoped redactions and text boxes to the new entry', () => {
    const entries = [
      { id: 'first', sourcePageIndex: 0, rotation: 0 as const },
      { id: 'second', sourcePageIndex: 1, rotation: 0 as const },
    ];
    const textBox: TextBoxConfig = {
      id: 'box',
      text: 'note',
      x: 10,
      y: 10,
      width: 100,
      height: 30,
      fontSize: 12,
      fontColor: '#000000',
      backgroundColor: '#ffffff',
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: '#000000',
      pageIndex: 1,
    };
    const redaction: ContentEdit = {
      kind: 'text',
      pageEntryId: 'second',
      target: {
        id: 'secret',
        kind: 'text',
        pageIndex: 1,
        text: 'SECRET',
        x: 10,
        y: 20,
        width: 50,
        height: 12,
        fontSize: 12,
      },
      action: 'redact',
      newText: '',
      fontSize: 12,
      fontColor: '#000000',
      coverColor: '#000000',
    };
    let nextId = 0;

    const duplicated = duplicatePagePlanSelection(
      entries,
      new Set([1]),
      [textBox],
      [redaction],
      () => `copy-${++nextId}`,
    );

    expect(duplicated.pageEntries.map((entry) => entry.id)).toEqual([
      'first',
      'second',
      'copy-1',
    ]);
    expect(duplicated.textBoxes.map((box) => [box.id, box.pageIndex])).toEqual([
      ['box', 1],
      ['copy-2', 2],
    ]);
    expect(duplicated.contentEdits.map((edit) => edit.pageEntryId)).toEqual([
      'second',
      'copy-1',
    ]);
  });

  it('returns base page dimensions and independent byte copies', () => {
    expect(getUnrotatedPageSize({ width: 300, height: 200 }, 90)).toEqual({
      width: 200,
      height: 300,
    });
    const source = new Uint8Array([1, 2, 3]);
    const copy = copyPdfBytes(source);
    copy[0] = 9;
    expect(source[0]).toBe(1);
    expect(copy.buffer).not.toBe(source.buffer);
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

  it('uses a non-zero MediaBox lower-left corner as the page origin', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 300]);
    page.setMediaBox(-30, -40, 200, 300);

    expect(visualPointToPdf(page, 0, 0)).toEqual({ x: -30, y: 260 });
  });
});

describe('page plan remapping', () => {
  const previous = [
    { id: 'a', sourcePageIndex: 0, rotation: 0 as const },
    { id: 'b', sourcePageIndex: 1, rotation: 0 as const },
    { id: 'c', sourcePageIndex: 2, rotation: 0 as const },
  ];
  // 'b' を削除し、'c' を先頭へ移動した構成
  const next = [previous[2], previous[0]];

  const box = (id: string, pageIndex: number) => ({ id, pageIndex }) as TextBoxConfig;

  it('follows page entries across reorder and deletion', () => {
    expect(remapPageIndex(0, previous, next)).toBe(1);
    expect(remapPageIndex(1, previous, next)).toBe(-1);
    expect(remapPageIndex(2, previous, next)).toBe(0);
    expect(remapPageIndex(9, previous, next)).toBe(-1);
  });

  it('remaps the page selection and drops deleted pages', () => {
    expect([...remapPageSelection(new Set([0, 1, 2]), previous, next)].sort()).toEqual([0, 1]);
  });

  it('keeps all-page text boxes and removes boxes on deleted pages', () => {
    const remapped = remapTextBoxesForPagePlan(
      [box('all', -1), box('first', 0), box('deleted', 1), box('last', 2)],
      previous,
      next,
    );
    expect(remapped.map(({ id, pageIndex }) => [id, pageIndex])).toEqual([
      ['all', -1],
      ['first', 1],
      ['last', 0],
    ]);
  });

  it('disables a watermark whose page was deleted', () => {
    const allPages = { ...DEFAULT_WATERMARK, enabled: true, pageIndex: -1 };
    expect(remapWatermarkForPagePlan(allPages, previous, next)).toBe(allPages);
    expect(remapWatermarkForPagePlan({ ...allPages, pageIndex: 2 }, previous, next).pageIndex).toBe(0);
    expect(remapWatermarkForPagePlan({ ...allPages, pageIndex: 1 }, previous, next)).toMatchObject({
      enabled: false,
      pageIndex: -1,
    });
  });

  it('drops content edits scoped to deleted page entries', () => {
    const edits = [
      { pageEntryId: 'a' },
      { pageEntryId: 'b' },
      { pageEntryId: undefined },
    ] as ContentEdit[];
    expect(retainContentEditsForPagePlan(edits, next).map((edit) => edit.pageEntryId)).toEqual(['a', undefined]);
  });
});
