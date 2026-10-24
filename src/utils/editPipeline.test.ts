import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';
import { DEFAULT_WATERMARK } from '../types/pdfGraphics';
import { createTextEdit } from '../types/contentEdit';
import type { RecognizedTextItem } from '../types/contentEdit';
import { setFontBytesSource } from './fontLoader';
import { buildEditedPdf, createIdentityPagePlan, hasPagePlanChanges, scopeContentEditsToPlan } from './editPipeline';
import { inspectPdf } from './pdfInspection';

beforeAll(() => {
  setFontBytesSource(async () => new Uint8Array(await readFile(new URL('../../public/fonts/NotoSansJP.ttf', import.meta.url))));
});

async function createSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([300, 400]);
  first.drawText('FIRST', { x: 20, y: 350, size: 14, font });
  first.drawRectangle({ x: 50, y: 50, width: 100, height: 40, borderColor: rgb(0, 0, 1), borderWidth: 2 });
  const second = doc.addPage([300, 400]);
  second.drawText('SECOND', { x: 20, y: 350, size: 14, font });
  return doc.save();
}

function pageTexts(inspection: Awaited<ReturnType<typeof inspectPdf>>) {
  return inspection.pages.map((page) => page.items.filter((item) => item.kind === 'text').map((item) => (item as RecognizedTextItem).text));
}

describe('page plan helpers', () => {
  it('detects changes against the original page count and order', () => {
    const plan = createIdentityPagePlan(2);
    expect(hasPagePlanChanges(plan, 2)).toBe(false);
    expect(hasPagePlanChanges([plan[1], plan[0]], 2)).toBe(true);
    expect(hasPagePlanChanges([{ ...plan[0], rotation: 90 }, plan[1]], 2)).toBe(true);
    expect(hasPagePlanChanges([plan[0]], 2)).toBe(true);
  });

  it('maps content edits to the final page index via entry id or source page', () => {
    const plan = createIdentityPagePlan(2);
    const target: RecognizedTextItem = { id: 't', kind: 'text', pageIndex: 1, text: 'x', x: 0, y: 0, width: 1, height: 1, fontSize: 1 };
    const reversed = [plan[1], plan[0]];
    const scoped = scopeContentEditsToPlan([
      createTextEdit(target),
      { ...createTextEdit({ ...target, pageIndex: 0 }), pageEntryId: plan[0].id },
      { ...createTextEdit(target), pageEntryId: 'missing' },
    ], reversed);
    expect(scoped.map((edit) => edit.target.pageIndex)).toEqual([0, 1]);
  });
});

describe('buildEditedPdf', () => {
  it('applies page plan, content edits, text boxes and graphics in one pass', async () => {
    const source = await createSource();
    const before = await inspectPdf(source);
    const secondText = before.pages[1].items.find((item) => item.kind === 'text') as RecognizedTextItem;
    const plan = createIdentityPagePlan(2);

    const output = await buildEditedPdf(source, {
      // Reverse the pages: SECOND becomes page 1.
      pageEntries: [plan[1], plan[0]],
      textBoxes: [{
        id: 'box', text: 'ADDED', x: 20, y: 20, width: 120, height: 30, fontSize: 10, fontColor: '#000000',
        backgroundColor: 'transparent', borderStyle: 'none', borderWidth: 0, borderColor: '#000000', pageIndex: 1,
      }],
      headerFooter: DEFAULT_HEADER_FOOTER,
      pageNumbering: { ...DEFAULT_PAGE_NUMBERING, enabled: true },
      contentEdits: [{ ...createTextEdit(secondText), action: 'redact' }],
      graphics: [{
        id: 'g', kind: 'rectangle', pageIndex: 0, x: 10, y: 10, width: 50, height: 20,
        color: '#ff0000', fillColor: 'transparent', lineWidth: 1, opacity: 1, label: 'r',
      }],
      watermark: DEFAULT_WATERMARK,
    }, { fileName: 'source.pdf' });

    const after = await inspectPdf(output);
    expect(after.pageCount).toBe(2);
    const texts = pageTexts(after);
    // Page 1 is the former second page; its text was redacted and a page number was added.
    expect(texts[0]).not.toContain('SECOND');
    expect(texts[0]).toContain('1');
    // Page 2 is the former first page with the added text box.
    expect(texts[1]).toContain('FIRST');
    expect(texts[1]).toContain('ADDED');
    // The new rectangle landed on page 1 (the former second page), which had no paths before.
    expect(after.pages[0].items.some((item) => item.kind === 'path' && item.shape === 'rectangle')).toBe(true);
  });

  it('counts the original pages itself when not told', async () => {
    const source = await createSource();
    const output = await buildEditedPdf(source, {
      pageEntries: [],
      textBoxes: [],
      headerFooter: DEFAULT_HEADER_FOOTER,
      pageNumbering: DEFAULT_PAGE_NUMBERING,
      contentEdits: [],
      graphics: [],
      watermark: { ...DEFAULT_WATERMARK, enabled: true, text: 'DRAFT' },
    }, { fileName: 'source.pdf' });
    const after = await inspectPdf(output);
    expect(pageTexts(after).every((texts) => texts.includes('DRAFT'))).toBe(true);
  });

  it('writes document properties last when requested', async () => {
    const source = await createSource();
    const plan = createIdentityPagePlan(2);
    const output = await buildEditedPdf(source, {
      pageEntries: [plan[1]],
      textBoxes: [],
      headerFooter: DEFAULT_HEADER_FOOTER,
      pageNumbering: DEFAULT_PAGE_NUMBERING,
      contentEdits: [],
      graphics: [],
      watermark: DEFAULT_WATERMARK,
    }, { fileName: 'source.pdf', metadata: { title: '抜粋', author: '' } });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('抜粋');
    expect(doc.getAuthor()).toBeUndefined();
  });
});
