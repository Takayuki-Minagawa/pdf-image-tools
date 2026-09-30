import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pdfFontkit } from './pdfFontkit';
import { loadFontBytes } from './fontLoader';
import { applyPdfGraphics } from './pdfGraphics';
import { applyPdfEdits } from './pdfEditOperations';
import { applyContentEdits } from './contentEditOperations';
import { DEFAULT_WATERMARK } from '../types/pdfGraphics';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING, createDefaultTextBox } from '../types/pdfEdit';
import { createTextEdit } from '../types/contentEdit';

vi.mock('./fontLoader', () => ({ loadFontBytes: vi.fn() }));

const SAMPLE = '社外秘 TEST';
let fontBytes: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fontBytes = new Uint8Array(await readFile(new URL('../../public/fonts/NotoSansJP.ttf', import.meta.url)));
  vi.mocked(loadFontBytes).mockResolvedValue(fontBytes.buffer);
});

async function verifyEmbeddedOutlines(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const fontStreams = document.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (!(object instanceof PDFDict)) return [];
    const reference = object.get(PDFName.of('FontFile2'));
    if (!reference) return [];
    const stream = document.context.lookup(reference);
    return stream instanceof PDFRawStream ? [decodePDFRawStream(stream).decode()] : [];
  });
  expect(fontStreams).toHaveLength(1);
  // Check the actual saved outlines. Text extraction alone only reads ToUnicode,
  // so it misleadingly passes even when a broken font makes characters invisible.
  const embedded = fontkit.create(fontStreams[0]);
  expect(embedded.numGlyphs).toBe(8); // .notdef + 社 外 秘 space T E S
  for (let id = 0; id < embedded.numGlyphs; id++) {
    const outline = embedded.getGlyph(id).path.toSVG();
    if (id === 4) expect(outline).toBe(''); // The single intentional blank is space.
    else expect(outline.length).toBeGreaterThan(0);
  }
  expect(fontStreams[0].length).toBeLessThan(20_000);
}

async function blankPdf() {
  const document = await PDFDocument.create();
  document.addPage([500, 300]);
  return document.save();
}

describe('regular Noto Sans JP PDF subset outlines', () => {
  it('preserves every Japanese and Latin glyph after embedding, saving, and reopening', async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(pdfFontkit);
    const font = await document.embedFont(fontBytes, { subset: true });
    document.addPage([500, 300]).drawText(SAMPLE, { font, x: 30, y: 150, size: 36 });
    await verifyEmbeddedOutlines(await document.save());
  });

  it('uses the safe subset in the watermark export', async () => {
    await verifyEmbeddedOutlines(await applyPdfGraphics(await blankPdf(), [], {
      ...DEFAULT_WATERMARK, enabled: true, text: SAMPLE, fontSize: 36, rotation: 0,
    }));
  });

  it('uses the safe subset for text boxes and shared header/footer/page-number writer', async () => {
    await verifyEmbeddedOutlines(await applyPdfEdits(await blankPdf(), {
      textBoxes: [{ ...createDefaultTextBox(0), text: SAMPLE, width: 400 }],
      headerFooter: DEFAULT_HEADER_FOOTER,
      pageNumbering: DEFAULT_PAGE_NUMBERING,
    }, 'test.pdf'));
  });

  it('uses the safe subset when replacing existing content', async () => {
    const edit = createTextEdit({ id: 'old', kind: 'text', pageIndex: 0, text: 'OLD', x: 20, y: 150, width: 50, height: 20, fontSize: 20 });
    edit.newText = SAMPLE;
    await verifyEmbeddedOutlines(await applyContentEdits(await blankPdf(), [edit]));
  });

  it('uses the same safe variable instance in CLI recipe output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdf-fontkit-'));
    try {
      const input = join(directory, 'input.pdf');
      const output = join(directory, 'output.pdf');
      const recipe = join(directory, 'recipe.json');
      await writeFile(input, await blankPdf());
      await writeFile(recipe, JSON.stringify({
        version: 1,
        textBoxes: [{ ...createDefaultTextBox(0), text: SAMPLE, width: 400 }],
        headerFooter: DEFAULT_HEADER_FOOTER,
        pageNumbering: DEFAULT_PAGE_NUMBERING,
      }));
      await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../../scripts/pdf-image-tools.mjs', import.meta.url)),
        'apply-recipe', input, output, recipe,
      ]);
      await verifyEmbeddedOutlines(new Uint8Array(await readFile(output)));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
