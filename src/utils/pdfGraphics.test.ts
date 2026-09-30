import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist';
import { DEFAULT_WATERMARK, createDefaultGraphic, type PdfGraphic } from '../types/pdfGraphics';
import type { PagePlanEntry } from '../types/pdfEdit';
import { recognizePageContent } from './contentRecognition';
import { loadFontBytes } from './fontLoader';
import {
  applyPdfGraphics, duplicateGraphicsForPages, getVisiblePageGeometry,
  remapGraphicsForPages, visualToPdf,
} from './pdfGraphics';

vi.mock('./fontLoader', () => ({ loadFontBytes: vi.fn() }));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

async function sourcePdf(rotation = 0, userUnit = 1) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.setMediaBox(20, 30, 400, 500);
  page.setCropBox(50, 70, 300, 400);
  page.setRotation(degrees(rotation));
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  return document;
}

beforeEach(() => vi.mocked(loadFontBytes).mockReset());

describe('visible geometry agrees with PDF.js', () => {
  it.each([0, 90, 180, 270])('converts CropBox and UserUnit coordinates with rotation %i', async (rotation) => {
    const document = await sourcePdf(rotation, 2);
    const page = document.getPage(0);
    const parsed = await getDocument({ data: await document.save() }).promise;
    try {
      const viewport = (await parsed.getPage(1)).getViewport({ scale: 1 });
      const geometry = getVisiblePageGeometry(page);
      expect(geometry.visualWidth).toBe(viewport.width);
      expect(geometry.visualHeight).toBe(viewport.height);
      for (const [x, y] of [[0, 0], [130, 180], [viewport.width, viewport.height]]) {
        const expected = viewport.convertToPdfPoint(x, y);
        const actual = visualToPdf(page, x, y);
        expect(actual.x).toBeCloseTo(expected[0], 8);
        expect(actual.y).toBeCloseTo(expected[1], 8);
      }
    } finally {
      await parsed.destroy();
    }
  });

  it('uses the intersection when CropBox extends beyond MediaBox and MediaBox for disjoint boxes', async () => {
    const document = await sourcePdf();
    const page = document.getPage(0);
    page.setCropBox(-100, 50, 300, 800);
    expect(getVisiblePageGeometry(page)).toMatchObject({ x: 20, y: 50, width: 180, height: 480 });
    page.setCropBox(1000, 1000, 40, 40);
    expect(getVisiblePageGeometry(page)).toMatchObject({ x: 20, y: 30, width: 400, height: 500 });
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(-2));
    expect(getVisiblePageGeometry(page).userUnit).toBe(1);
  });
});

describe('PDF graphic round trips', () => {
  it.each([0, 90, 180, 270])('preserves the visible rectangle bounds and line width on rotation %i', async (rotation) => {
    const document = await sourcePdf(rotation, 2);
    const graphic: PdfGraphic = {
      ...createDefaultGraphic('rectangle', 0), x: 42, y: 66, width: 140, height: 80,
      color: '#ff0000', fillColor: '#00ff00', lineWidth: 6,
    };
    const output = await applyPdfGraphics(await document.save(), [graphic], DEFAULT_WATERMARK);
    const parsed = await getDocument({ data: output }).promise;
    try {
      const page = await parsed.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const paths = (await recognizePageContent(page)).filter((item) => item.kind === 'path');
      expect(paths).toHaveLength(1);
      const points = paths[0].points.map(({ x, y }) => viewport.convertToViewportPoint(x, y));
      expect(Math.min(...points.map((point) => point[0]))).toBeCloseTo(42);
      expect(Math.max(...points.map((point) => point[0]))).toBeCloseTo(182);
      expect(Math.min(...points.map((point) => point[1]))).toBeCloseTo(66);
      expect(Math.max(...points.map((point) => point[1]))).toBeCloseTo(146);
      expect(paths[0].lineWidth * page.userUnit).toBeCloseTo(6);
      expect(paths[0].strokeColor).toBe('#ff0000');
      expect(paths[0].fillColor).toBe('#00ff00');
      expect(loadFontBytes).not.toHaveBeenCalled();
    } finally {
      await parsed.destroy();
    }
  });

  it('supports horizontal arrows, ellipses and a translucent Multiply highlight without hiding original content', async () => {
    const document = await sourcePdf();
    document.getPage(0).drawText('Original content', { x: 90, y: 350, size: 14 });
    const graphics: PdfGraphic[] = [
      { ...createDefaultGraphic('arrow', 0), x: 10, y: 40, width: 120, height: 0 },
      { ...createDefaultGraphic('ellipse', 0), x: 30, y: 80, width: 100, height: 40, fillColor: '#ff0000' },
      { ...createDefaultGraphic('highlight', 0), x: 30, y: 100, width: 160, height: 30 },
    ];
    const output = await applyPdfGraphics(await document.save(), graphics, DEFAULT_WATERMARK);
    const parsed = await getDocument({ data: output }).promise;
    try {
      const page = await parsed.getPage(1);
      const items = await recognizePageContent(page);
      expect(items.some((item) => item.kind === 'text' && item.text === 'Original content')).toBe(true);
      expect(items.filter((item) => item.kind === 'path' && item.shape === 'line')).toHaveLength(3);
      const operators = await page.getOperatorList();
      const fillColors = operators.argsArray.filter((_, index) => operators.fnArray[index] === OPS.setFillRGBColor).flat();
      expect(fillColors).toContain('#ff0000');
      const states = operators.argsArray.filter((_, index) => operators.fnArray[index] === OPS.setGState).flat(3);
      expect(states).toContain('multiply');
      expect(states).toContain(0.4);
    } finally {
      await parsed.destroy();
    }
  });

  it('places an image with its requested visible bounds on a rotated cropped UserUnit page and shares image resources', async () => {
    const document = await sourcePdf(270, 2);
    document.addPage([400, 500]);
    const graphic = { ...createDefaultGraphic('image', -1), imageDataUrl: PNG, x: 35, y: 47, width: 100, height: 60 };
    const output = await applyPdfGraphics(await document.save(), [graphic], DEFAULT_WATERMARK);
    const loaded = await PDFDocument.load(output);
    const imageObjects = loaded.context.enumerateIndirectObjects().filter(([, object]) => {
      return 'dict' in object && String(object.dict).includes('/Subtype /Image');
    });
    // A transparent PNG can have a second image for its alpha mask.
    expect(imageObjects.length).toBeGreaterThanOrEqual(1);
    expect(imageObjects.length).toBeLessThanOrEqual(2);
    const parsed = await getDocument({ data: output }).promise;
    try {
      const page = await parsed.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const operators = await page.getOperatorList();
      type Matrix = number[];
      let matrix: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      const imageBounds: number[][] = [];
      for (let index = 0; index < operators.fnArray.length; index++) {
        const op = operators.fnArray[index];
        if (op === OPS.save) stack.push([...matrix]);
        else if (op === OPS.restore) matrix = stack.pop()!;
        else if (op === OPS.transform) {
          const [a, b, c, d, e, f] = operators.argsArray[index] as number[];
          const [m0, m1, m2, m3, m4, m5] = matrix;
          matrix = [m0 * a + m2 * b, m1 * a + m3 * b, m0 * c + m2 * d,
            m1 * c + m3 * d, m0 * e + m2 * f + m4, m1 * e + m3 * f + m5];
        } else if (op === OPS.paintImageXObject) {
          for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            imageBounds.push(viewport.convertToViewportPoint(matrix[0] * x + matrix[2] * y + matrix[4],
              matrix[1] * x + matrix[3] * y + matrix[5]));
          }
        }
      }
      expect(imageBounds).toHaveLength(4);
      expect(Math.min(...imageBounds.map((p) => p[0]))).toBeCloseTo(35);
      expect(Math.max(...imageBounds.map((p) => p[0]))).toBeCloseTo(135);
      expect(Math.min(...imageBounds.map((p) => p[1]))).toBeCloseTo(47);
      expect(Math.max(...imageBounds.map((p) => p[1]))).toBeCloseTo(107);
      expect(loadFontBytes).not.toHaveBeenCalled();
    } finally {
      await parsed.destroy();
    }
  });

  it('targets the requested page while a global mark reaches every page', async () => {
    const document = await sourcePdf();
    document.addPage([300, 400]);
    const global = { ...createDefaultGraphic('rectangle', -1), fillColor: '#00ff00' };
    const local = { ...createDefaultGraphic('rectangle', 1), fillColor: '#ff0000' };
    const output = await applyPdfGraphics(await document.save(), [global, local], DEFAULT_WATERMARK);
    const parsed = await getDocument({ data: output }).promise;
    try {
      const first = await recognizePageContent(await parsed.getPage(1));
      const second = await recognizePageContent(await parsed.getPage(2));
      expect(first.filter((item) => item.kind === 'path')).toHaveLength(1);
      expect(second.filter((item) => item.kind === 'path')).toHaveLength(2);
    } finally {
      await parsed.destroy();
    }
  });

  it('does not emit hairlines or leak paths when the border width is zero', async () => {
    const document = await sourcePdf();
    const graphics = [
      { ...createDefaultGraphic('rectangle', 0), lineWidth: 0, fillColor: 'transparent' },
      { ...createDefaultGraphic('line', 0), lineWidth: 0 },
      { ...createDefaultGraphic('rectangle', 0), x: 90, y: 150, width: 20, height: 20, fillColor: '#ff0000', lineWidth: 0 },
    ];
    const output = await applyPdfGraphics(await document.save(), graphics, DEFAULT_WATERMARK);
    const parsed = await getDocument({ data: output }).promise;
    try {
      const paths = (await recognizePageContent(await parsed.getPage(1))).filter((item) => item.kind === 'path');
      expect(paths).toHaveLength(1);
      expect(paths[0].filled).toBe(true);
      expect(paths[0].stroked).toBe(false);
    } finally {
      await parsed.destroy();
    }
  });

  it('embeds and extracts Japanese watermarks only when enabled', async () => {
    const bytes = await readFile(new URL('../../public/fonts/NotoSansJP.ttf', import.meta.url));
    vi.mocked(loadFontBytes).mockResolvedValue(new Uint8Array(bytes).buffer);
    const document = await sourcePdf(90, 2);
    const source = await document.save();
    await applyPdfGraphics(source, [], DEFAULT_WATERMARK);
    expect(loadFontBytes).not.toHaveBeenCalled();
    const output = await applyPdfGraphics(source, [], { ...DEFAULT_WATERMARK, enabled: true, text: '社外秘', fontSize: 30 });
    const parsed = await getDocument({ data: output }).promise;
    try {
      const content = await (await parsed.getPage(1)).getTextContent();
      expect(content.items.some((item) => 'str' in item && item.str === '社外秘')).toBe(true);
      expect(loadFontBytes).toHaveBeenCalledOnce();
    } finally {
      await parsed.destroy();
    }
  });

  it('keeps ASCII watermark text searchable and requires no external font', async () => {
    const document = await sourcePdf();
    document.getPage(0).drawRectangle({ x: 60, y: 80, width: 100, height: 100, color: rgb(1, 1, 1) });
    const output = await applyPdfGraphics(await document.save(), [], { ...DEFAULT_WATERMARK, enabled: true, text: 'DRAFT', rotation: 0, fontSize: 30 });
    const parsed = await getDocument({ data: output }).promise;
    try {
      const page = await parsed.getPage(1);
      const item = (await page.getTextContent()).items.find((item) => 'str' in item && item.str === 'DRAFT');
      expect(item && 'str' in item).toBe(true);
      if (!item || !('str' in item)) throw new Error('Watermark text is missing');
      const [x] = page.getViewport({ scale: 1 }).convertToViewportPoint(item.transform[4], item.transform[5]);
      expect(x + item.width / 2).toBeCloseTo(page.getViewport({ scale: 1 }).width / 2, 2);
      expect(loadFontBytes).not.toHaveBeenCalled();
    } finally {
      await parsed.destroy();
    }
  });

  it('rejects unsupported images and nonfinite coordinates before saving', async () => {
    const bytes = await (await sourcePdf()).save();
    await expect(applyPdfGraphics(bytes, [{ ...createDefaultGraphic('image', 0), imageDataUrl: 'data:image/svg+xml;base64,AA==' }], DEFAULT_WATERMARK)).rejects.toThrow('PNG');
    await expect(applyPdfGraphics(bytes, [{ ...createDefaultGraphic('rectangle', 0), x: Number.NaN }], DEFAULT_WATERMARK)).rejects.toThrow('位置');
  });
});

describe('graphic page associations', () => {
  const entries: PagePlanEntry[] = [
    { id: 'a', sourcePageIndex: 0, rotation: 0 },
    { id: 'b', sourcePageIndex: 0, rotation: 0 },
    { id: 'blank', sourcePageIndex: null, rotation: 0, width: 200, height: 300 },
  ];

  it('distinguishes existing duplicate pages and removes marks on deleted entries', () => {
    const a = createDefaultGraphic('rectangle', 0);
    const b = createDefaultGraphic('ellipse', 1);
    const global = createDefaultGraphic('highlight', -1);
    const remapped = remapGraphicsForPages([a, b, global], entries, [entries[2], entries[1]]);
    expect(remapped).toEqual([{ ...b, pageIndex: 1 }, global]);
  });

  it('duplicates local marks for immediately inserted copies, including blank pages, once', () => {
    const a = createDefaultGraphic('rectangle', 0);
    const blank = createDefaultGraphic('line', 2);
    const global = createDefaultGraphic('highlight', -1);
    const next = [entries[0], { ...entries[0], id: 'a-copy' }, entries[1], entries[2], { ...entries[2], id: 'blank-copy' }];
    const copied = duplicateGraphicsForPages([a, blank, global], entries, next);
    expect(copied.map((graphic) => graphic.pageIndex).sort()).toEqual([-1, 0, 1, 3, 4]);
    expect(new Set(copied.map((graphic) => graphic.id)).size).toBe(5);
    expect(copied.find((graphic) => graphic.pageIndex === 1)?.kind).toBe('rectangle');
    expect(copied.find((graphic) => graphic.pageIndex === 4)?.kind).toBe('line');
  });
});


describe('duplicated layers', () => {
  it('keeps page-scoped marks between the same all-page layers on every copy', () => {
    const entries = [{ id: 'page', sourcePageIndex: 0, rotation: 0 as const }];
    const graphics = [
      { ...createDefaultGraphic('image', -1), label: 'background' },
      { ...createDefaultGraphic('rectangle', 0), label: 'local' },
      { ...createDefaultGraphic('highlight', -1), label: 'foreground' },
    ];
    const copied = duplicateGraphicsForPages(graphics, entries, [...entries, { ...entries[0], id: 'copy' }]);
    for (const pageIndex of [0, 1]) {
      expect(copied.filter((item) => item.pageIndex === -1 || item.pageIndex === pageIndex).map((item) => item.label))
        .toEqual(['background', 'local', 'foreground']);
    }
  });
});
