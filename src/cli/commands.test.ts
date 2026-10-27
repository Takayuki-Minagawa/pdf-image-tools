import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { setFontBytesSource } from '../utils/fontLoader';
import { parseRecipe } from '../types/recipe';
import type { RecognizedPathItem, RecognizedTextItem } from '../types/contentEdit';
import {
  addText,
  addTextOptionsFromArgs,
  applyRecipe,
  extractPages,
  inspect,
  mergePdfs,
  parseArgs,
  parsePageSpec,
  reorderPages,
  rotatePages,
} from './commands';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

beforeAll(() => {
  setFontBytesSource(async () => new Uint8Array(await readFile(new URL('../../public/fonts/NotoSansJP.ttf', import.meta.url))));
});

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 500]);
  first.drawText('BUILDING-NAME', { x: 40, y: 430, size: 18, font });
  first.drawText('ROOM-101', { x: 40, y: 250, size: 12, font });
  first.drawRectangle({ x: 60, y: 300, width: 120, height: 60, borderColor: rgb(0, 0, 1), borderWidth: 2 });
  first.drawLine({ start: { x: 40, y: 100 }, end: { x: 360, y: 100 }, thickness: 3, color: rgb(0, 0.5, 0) });
  const second = doc.addPage([400, 500]);
  second.drawText('ROOM-202', { x: 40, y: 450, size: 12, font });
  return doc.save();
}

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('argument parsing', () => {
  it('parses page specs', () => {
    expect(parsePageSpec('1-3,5', 6)).toEqual([0, 1, 2, 4]);
    expect(() => parsePageSpec('0', 3)).toThrow(/1〜3/);
    expect(() => parsePageSpec('a', 3)).toThrow(/不正/);
    expect(() => parsePageSpec('', 3)).toThrow(/1つ以上/);
  });

  it('separates positional arguments from --options', () => {
    expect(parseArgs(['in.pdf', 'out.pdf', '--page', 'all', '--x=12', 'text', '--flag'])).toEqual({
      positional: ['in.pdf', 'out.pdf', 'text'],
      options: { page: 'all', x: '12', flag: true },
    });
    // A bare --option followed by a plain value consumes that value.
    expect(parseArgs(['--pages', '1-2', '--allow-cover-only'])).toEqual({
      positional: [],
      options: { pages: '1-2', 'allow-cover-only': true },
    });
    expect(parseArgs(['a', '--', '--not-an-option'])).toEqual({ positional: ['a', '--not-an-option'], options: {} });
  });

  it('builds add-text options with defaults and validation', () => {
    const options = addTextOptionsFromArgs('hello', { page: 'all', x: '10', size: '20' }, 'file.pdf');
    expect(options).toMatchObject({ text: 'hello', page: 'all', x: 10, y: 50, fontSize: 20, borderStyle: 'none', fileName: 'file.pdf' });
    expect(() => addTextOptionsFromArgs('x', { x: 'abc' }, 'f')).toThrow(/--x/);
    expect(() => addTextOptionsFromArgs('x', { border: 'double' }, 'f')).toThrow(/--border/);
  });
});

describe('page commands', () => {
  it('merges, extracts, reorders and rotates', async () => {
    const sample = await samplePdf();
    expect(await pageCount(await mergePdfs([sample, sample]))).toBe(4);
    await expect(mergePdfs([sample])).rejects.toThrow(/2つ以上/);
    expect(await pageCount(await extractPages(sample, '2'))).toBe(1);
    const reordered = await PDFDocument.load(await reorderPages(sample, '2,1,1'));
    expect(reordered.getPageCount()).toBe(3);
    const rotated = await PDFDocument.load(await rotatePages(sample, '2', 90));
    expect(rotated.getPage(0).getRotation().angle).toBe(0);
    expect(rotated.getPage(1).getRotation().angle).toBe(90);
    await expect(rotatePages(sample, undefined, 45)).rejects.toThrow(/90/);
  });
});

describe('inspect', () => {
  it('returns rounded text and path items per page and filters by kind', async () => {
    const sample = await samplePdf();
    const all = await inspect(sample, 'sample.pdf', { pages: '1' });
    expect(all.pageCount).toBe(2);
    expect(all.pages).toHaveLength(1);
    const texts = all.pages[0].items.filter((item): item is RecognizedTextItem => item.kind === 'text');
    const paths = all.pages[0].items.filter((item): item is RecognizedPathItem => item.kind === 'path');
    expect(texts.map((item) => item.text)).toEqual(['BUILDING-NAME', 'ROOM-101']);
    expect(paths.map((item) => item.shape)).toEqual(['rectangle', 'line']);
    expect(paths[0].strokeColor).toBe('#0000ff');
    expect(texts[0].id).toBe('p0-text-0');

    const onlyPaths = await inspect(sample, 'sample.pdf', { kinds: 'paths' });
    expect(onlyPaths.pages.flatMap((page) => page.items).every((item) => item.kind === 'path')).toBe(true);
    await expect(inspect(sample, 'sample.pdf', { kinds: 'images' })).rejects.toThrow(/--kinds/);
  });
});

describe('add-text and apply-recipe', () => {
  it('refuses secure recipes on the ordinary save path', async () => {
    const recipe = parseRecipe({ version: 3, regionRedaction: { version: 1, dpi: 72, regions: [] } });
    await expect(applyRecipe(await samplePdf(), recipe, { fileName: 'sample.pdf' })).rejects.toThrow(/redact-regions/);
  });

  it('adds a text box on every page at the requested visual position', async () => {
    const sample = await samplePdf();
    const output = await addText(sample, addTextOptionsFromArgs('承認済', { page: 'all', x: '200', y: '440', size: '14' }, 'sample.pdf'));
    const result = await inspect(output, 'out.pdf', { kinds: 'text' });
    for (const page of result.pages) {
      const added = page.items.find((item) => item.kind === 'text' && item.text === '承認済') as RecognizedTextItem | undefined;
      expect(added).toBeDefined();
      // Baseline = pageHeight - y - padding - fontSize, x = x + padding.
      expect(added!.x).toBeCloseTo(204, 0);
      expect(added!.y).toBeCloseTo(500 - 440 - 4 - 14, 0);
    }
  });

  it('applies content rules, graphics and watermark from a recipe and reports matches', async () => {
    const sample = await samplePdf();
    const recipe = parseRecipe({
      version: 2,
      name: 'test',
      watermark: { enabled: true, text: 'DRAFT', fontSize: 40, opacity: 0.3, rotation: 0, pageIndex: -1 },
      graphics: [
        { kind: 'rectangle', pageIndex: 1, x: 10, y: 10, width: 60, height: 30, color: '#ff0000', lineWidth: 1 },
        { kind: 'image', pageIndex: 0, x: 10, y: 10, width: 20, height: 20, imagePath: 'logo.png' },
      ],
      contentRules: [
        { kind: 'text', match: { text: 'BUILDING-NAME' }, action: 'redact' },
        { kind: 'text', match: { text: 'ROOM-(\\d+)', mode: 'regex' }, action: 'replace', newText: 'UNIT-$1' },
        { kind: 'path', match: { shape: 'line' }, action: 'delete' },
        { kind: 'text', match: { text: 'MISSING' }, action: 'delete' },
      ],
    });

    const result = await applyRecipe(sample, recipe, {
      fileName: 'sample.pdf',
      resolveImage: async (graphic) => {
        expect(graphic.imagePath).toBe('logo.png');
        return PNG;
      },
    });
    expect(result.matchCounts).toEqual([1, 2, 1, 0]);
    expect(result.unmatched).toHaveLength(1);

    const after = await inspect(result.bytes, 'out.pdf');
    const texts = after.pages.map((page) => page.items.filter((item) => item.kind === 'text').map((item) => (item as RecognizedTextItem).text));
    expect(texts[0]).not.toContain('BUILDING-NAME');
    expect(texts[0]).toContain('UNIT-101');
    expect(texts[1]).toContain('UNIT-202');
    expect(texts.every((pageTexts) => pageTexts.includes('DRAFT'))).toBe(true);
    expect(after.pages[1].items.some((item) => item.kind === 'path' && item.shape === 'rectangle')).toBe(true);

    await expect(applyRecipe(sample, recipe, { fileName: 'sample.pdf' })).rejects.toThrow(/imagePath/);
  });
});
