import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';
import type { RecognizedTextItem } from '../types/contentEdit';
import { setFontBytesSource } from './fontLoader';
import { applyPdfEdits, expandPageTargets, formatPageNumber, wrapTextByWidth } from './pdfEditOperations';
import { recognizePageContent } from './contentRecognition';

beforeAll(() => {
  setFontBytesSource(async () => new Uint8Array(await readFile(new URL('../../public/fonts/NotoSansJP.ttf', import.meta.url))));
});

async function textItems(bytes: Uint8Array, pageNumber = 1) {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const items = (await recognizePageContent(page)).filter((item): item is RecognizedTextItem => item.kind === 'text');
    return { items, viewport: page.getViewport({ scale: 1 }) };
  } finally {
    await doc.destroy();
  }
}

describe('helpers', () => {
  it('formats page numbers and expands targets', () => {
    expect(formatPageNumber(4, 'roman-lower', '[', ']')).toBe('[iv]');
    expect(formatPageNumber(4, 'dash-numeric', '[', ']')).toBe('- 4 -');
    expect(expandPageTargets(-1, 3)).toEqual([0, 1, 2]);
    expect(expandPageTargets(5, 3)).toEqual([]);
    expect(wrapTextByWidth('abc def', (text) => text.length * 10, 35)).toEqual(['abc', 'def']);
  });
});

describe('applyPdfEdits on cropped and rotated pages', () => {
  it.each([0, 90, 270])('places a text box where the preview shows it (rotation %i)', async (rotation) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    // The visible area is offset from the MediaBox origin, like the editor preview (pdf.js) shows.
    page.setMediaBox(20, 30, 400, 500);
    page.setCropBox(50, 70, 300, 400);
    page.setRotation(degrees(rotation));
    const source = await doc.save();

    const output = await applyPdfEdits(source, {
      textBoxes: [{
        id: 'box', text: 'HELLO', x: 40, y: 60, width: 150, height: 40, fontSize: 12, fontColor: '#000000',
        backgroundColor: 'transparent', borderStyle: 'none', borderWidth: 0, borderColor: '#000000', pageIndex: 0,
      }],
      headerFooter: DEFAULT_HEADER_FOOTER,
      pageNumbering: DEFAULT_PAGE_NUMBERING,
    }, 'test.pdf');

    const { items, viewport } = await textItems(output);
    const hello = items.find((item) => item.text === 'HELLO');
    expect(hello).toBeDefined();
    // Expected baseline in visual (top-left) coordinates: x + padding, y + padding + fontSize.
    const [canvasX, canvasY] = viewport.convertToViewportPoint(hello!.x, hello!.y);
    expect(canvasX).toBeCloseTo(44, 0);
    expect(canvasY).toBeCloseTo(76, 0);
  });

  it('aligns header and footer text with the visible page edges', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    page.setCropBox(50, 70, 300, 400);
    const source = await doc.save();

    const output = await applyPdfEdits(source, {
      textBoxes: [],
      headerFooter: {
        header: { ...DEFAULT_HEADER_FOOTER.header, enabled: true, left: 'HEAD', margin: 20, marginHorizontal: 10, fontSize: 10 },
        footer: { ...DEFAULT_HEADER_FOOTER.footer, enabled: true, center: '', right: 'FOOT', margin: 20, marginHorizontal: 10, fontSize: 10 },
      },
      pageNumbering: DEFAULT_PAGE_NUMBERING,
    }, 'test.pdf');

    const { items, viewport } = await textItems(output);
    const head = items.find((item) => item.text === 'HEAD')!;
    const foot = items.find((item) => item.text === 'FOOT')!;
    const [headX, headY] = viewport.convertToViewportPoint(head.x, head.y);
    const [footX, footY] = viewport.convertToViewportPoint(foot.x + foot.width, foot.y);
    expect(headX).toBeCloseTo(10, 0);
    expect(headY).toBeGreaterThan(20);
    expect(headY).toBeLessThan(35);
    expect(footX).toBeCloseTo(viewport.width - 10, 0);
    expect(footY).toBeGreaterThan(viewport.height - 25);
    expect(footY).toBeLessThan(viewport.height - 15);
  });
});
