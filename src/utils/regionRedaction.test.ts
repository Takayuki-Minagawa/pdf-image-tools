import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream, degrees, rgb } from 'pdf-lib';
import { describeDocument, estimateRegionRedaction, rasterizeAndVerify, regionPixelBounds, replaceRegionPixels, type RasterCanvasFactory } from './regionRedaction';
import { parseRegionRedactionSettings, type RegionRedactionRegion, type RegionRedactionSettings } from '../types/regionRedaction';
import { sha256, verifyRasterPdfStructure, type ExpectedRasterPage } from './safePdfVerification';

vi.mock('./pdfjsWorker', () => ({ ensurePdfjsWorker() {} }));
const nativeCanvas: RasterCanvasFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return { canvas: canvas as unknown as HTMLCanvasElement, context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, encodePng: async () => canvas.toBuffer('image/png'), dispose: () => { canvas.width = 1; canvas.height = 1; } };
};
const documentOptions = { standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`, useWorkerFetch: false };
const options = { canvasFactory: nativeCanvas, documentOptions };
function region(overrides: Partial<RegionRedactionRegion> = {}): RegionRedactionRegion {
  return { id: 'r1', pages: [1], x: 20, y: 20, width: 50, height: 30, pageWidth: 200, pageHeight: 120, fill: 'white', ...overrides };
}
function settings(regions = [region()], dpi = 72): RegionRedactionSettings { return { version: 1, dpi, regions }; }
async function fixture(rotations = [0]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('SECRET TITLE');
  pdf.setAuthor('SECRET AUTHOR');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = createCanvas(10, 10);
  logo.getContext('2d').fillRect(0, 0, 10, 10);
  const image = await pdf.embedPng(logo.toBuffer('image/png'));
  for (const rotation of rotations) {
    const page = pdf.addPage([240, 160]);
    page.setCropBox(10, 20, 200, 120);
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 10, y: 20, width: 200, height: 120, color: rgb(0.25, 0.5, 0.75) });
    page.drawText('PRIVATE 123', { x: 30, y: 100, font, size: 12 });
    page.drawImage(image, { x: 35, y: 95, width: 30, height: 20 });
    page.drawLine({ start: { x: 10, y: 95 }, end: { x: 200, y: 95 }, thickness: 0.5 });
  }
  await pdf.attach(new Uint8Array([1, 2, 3]), 'secret.txt', { description: 'SECRET ATTACHMENT' });
  pdf.addJavaScript('secret', 'console.log("SECRET SCRIPT")');
  const metadata = pdf.context.stream('<metadata>SECRET XMP</metadata>', { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(metadata));
  const field = pdf.getForm().createTextField('secret-field');
  field.setText('SECRET FORM');
  field.addToPage(pdf.getPage(0), { x: 100, y: 60, width: 60, height: 20 });
  return pdf.save();
}
async function imageRgb(bytes: Uint8Array, index = 0) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const resources = pdf.getPage(index).node.lookup(PDFName.of('Resources'), PDFDict);
  const xObjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const image = xObjects.lookup(xObjects.keys()[0]);
  expect(image).toBeInstanceOf(PDFRawStream);
  return decodePDFRawStream(image as PDFRawStream).decode();
}

describe('region rasterization coordinates and limits', () => {
  it('rounds every edge outward and changes only those pixels', () => {
    const r = region({ x: 0.25, y: 0.75, width: 1, height: 1 });
    expect(regionPixelBounds(r, 144, 8, 8)).toEqual({ left: 0, top: 1, right: 3, bottom: 4 });
    const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(27);
    replaceRegionPixels(pixels, 8, 8, [r], 144);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const offset = (y * 8 + x) * 4;
      expect(pixels[offset]).toBe(x < 3 && y >= 1 && y < 4 ? 255 : 27);
    }
  });
  it('rejects invalid coordinates, duplicate pages and unknown versions', () => {
    expect(() => parseRegionRedactionSettings({ ...settings(), version: 2 })).toThrow();
    expect(() => parseRegionRedactionSettings(settings([region({ x: NaN })]))).toThrow();
    expect(() => parseRegionRedactionSettings(settings([region({ pages: [1, 1] })]))).toThrow();
    expect(() => parseRegionRedactionSettings(settings([region({ x: 195 })]))).toThrow();
    expect(() => parseRegionRedactionSettings(settings([], 0))).toThrow();
  });
  it('rejects missing or mixed-size target pages and oversized rendering without lowering DPI', () => {
    const pages = [{ pageNumber: 1, width: 200, height: 120, rotation: 0, userUnit: 1 }, { pageNumber: 2, width: 120, height: 200, rotation: 90, userUnit: 1 }];
    expect(() => estimateRegionRedaction(pages, settings([region({ pages: [1, 2] })]))).toThrow('ページ 2');
    expect(() => estimateRegionRedaction(pages, settings([region({ pages: [3] })]))).toThrow('対象ページ 3');
    expect(() => estimateRegionRedaction([{ ...pages[0], width: 5000, height: 5000 }], settings([], 600))).toThrow('DPI');
    expect(estimateRegionRedaction(pages, settings()).totalPixels).toBe(48000);
  });
});

describe('fresh raster PDF and verification', () => {
  it('excludes source content outside fractional CropBox edges from encoded pixels', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([110, 110]);
    page.setCropBox(0, 20, 100.1, 80.1);
    // These shapes are entirely invisible, but would enter the rounded canvas's
    // final column/row without explicitly clipping the fractional viewport.
    page.drawRectangle({ x: 100.2, y: 20, width: 0.8, height: 80, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 0, y: 19.1, width: 100, height: 0.8, color: rgb(0, 0, 0) });
    const source = await pdf.save();
    const result = await rasterizeAndVerify(source, settings([]), options);
    expect((await imageRgb(result.bytes)).every((value) => value === 255)).toBe(true);
    const edge = await rasterizeAndVerify(source, settings([region({ x: 99, y: 0, width: 1.1, height: 80.1, pageWidth: 100.1, pageHeight: 80.1, fill: 'black' })]), options);
    // Redaction is performed after restoring the clip, so even rounded edge
    // pixels are opaque replacements and match the independent verification.
    expect(Array.from((await imageRgb(edge.bytes)).slice(-3))).toEqual([0, 0, 0]);
  });

  it('preserves physical mask edges on fractional pages without squeezing the raster', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200.5, 100.5]).drawRectangle({ x: 0, y: 0, width: 200.5, height: 100.5, color: rgb(0, 0, 0) });
    const result = await rasterizeAndVerify(await pdf.save(), settings([region({ x: 190, y: 20, width: 10, height: 10, pageWidth: 200.5, pageHeight: 100.5 })]), options);
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const content = output.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).lookup(0) as PDFRawStream;
    const instructions = new TextDecoder().decode(decodePDFRawStream(content).decode());
    expect(instructions).toContain('1 0 0 1 0 -0.5 cm');
    expect(instructions).toContain('201 0 0 101 0 0 cm');
    // Re-render the actual output at 10x scale, independently of the embedded RGB
    // hash. Squeezing 201x101 pixels to 200.5x100.5 pt used to expose black pixels
    // at y=29.8/29.9 pt inside the selected rectangle, despite hashes passing.
    const reopened = await pdfjs.getDocument({ ...documentOptions, data: result.bytes.slice() }).promise;
    const surface = nativeCanvas(2005, 1005);
    try {
      const page = await reopened.getPage(1);
      await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport: page.getViewport({ scale: 10 }) }).promise;
      for (const [x, y] of [[1950, 298], [1950, 299], [1998, 250], [1999, 250]]) {
        expect(Array.from(surface.context.getImageData(x, y, 1, 1).data)).toEqual([255, 255, 255, 255]);
      }
      expect(Array.from(surface.context.getImageData(1950, 305, 1, 1).data)).toEqual([0, 0, 0, 255]);
    } finally { surface.dispose(); await reopened.destroy(); }
  });

  it('rejects encrypted inputs even when the user password is empty', async () => {
    // Synthetic one-page PDF generated by pypdf: encrypt('', 'owner-password').
    // Kept inline so regression tests do not need Python or encryption tooling.
    const fixtureBase64 = 'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDliZmRhZDE4NzM+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA4MCA4MCBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1YgMgovUiAzCi9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPGEwODdjOWRjNDliMzI4MGI0NWRmNDUyYTVhM2QxM2IyOWM5NzY2YjkxM2RkN2ZlZDU2YjMyZjQzZDBmMjk0Nzk+Ci9VIDxkYjU2ZTAyZWI1NmNmNjhlYzlmNTIyYzg5ZDFjMGI3NDI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4Pgo+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTkgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMTY3IDAwMDAwIG4gCjAwMDAwMDAyNTkgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA2Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDw2NDM5MzIzNjMyMzU2NTY1MzgzODM0NjYzNTM2NjIzOTY2MzUzNDY2MzgzMzYzMzEzMDMwMzg2NDMxMzk2NDM2PiA8NjQzOTMyMzYzMjM1NjU2NTM4MzgzNDY2MzUzNjYyMzk2NjM1MzQ2NjM4MzM2MzMxMzAzMDM4NjQzMTM5NjQzNj4gXQovRW5jcnlwdCA1IDAgUgo+PgpzdGFydHhyZWYKNDc0CiUlRU9GCg==';
    const bytes = Uint8Array.from(atob(fixtureBase64), (character) => character.charCodeAt(0));
    await expect(describeDocument(bytes, options)).rejects.toThrow('暗号化された PDF');
    await expect(rasterizeAndVerify(bytes, settings([]), options)).rejects.toThrow('暗号化された PDF');
  });

  it('removes source objects, metadata, form appearances and selected pixels; preserves physical pages', async () => {
    const source = await fixture([0, 90, 180, 270]);
    const before = source.slice();
    const pages = await describeDocument(source, options);
    expect(pages.map((p) => [p.width, p.height])).toEqual([[200, 120], [120, 200], [200, 120], [120, 200]]);
    const regions = pages.map((p, i) => region({ id: `r${i}`, pages: [p.pageNumber], pageWidth: p.width, pageHeight: p.height, fill: i % 2 ? 'black' : 'white' }));
    const result = await rasterizeAndVerify(source, settings(regions, 144), options);
    expect(source).toEqual(before);
    expect(result.report.checks).toEqual({ structure: true, text: true, pixels: true, sourceUnchanged: true });
    expect(result.report.outputSha256).toBe(await sha256(result.bytes));
    expect(result.report.pages.map((p) => [p.width, p.height])).toEqual(pages.map((p) => [p.width, p.height]));
    expect(JSON.stringify(result.report)).not.toContain('SECRET');
    const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(output.getTitle()).toBeUndefined();
    expect(output.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(output.catalog.has(PDFName.of('Names'))).toBe(false);
    for (let i = 0; i < 4; i++) {
      const data = await imageRgb(result.bytes, i);
      const width = result.report.pages[i].pixelWidth;
      for (let y = 40; y < 100; y++) for (let x = 40; x < 140; x++) {
        expect(Array.from(data.slice((y * width + x) * 3, (y * width + x) * 3 + 3))).toEqual(i % 2 ? [0, 0, 0] : [255, 255, 255]);
      }
    }
  }, 30000);

  it('scales physical UserUnit dimensions exactly once and rebuilds unselected pages', async () => {
    const source = await PDFDocument.load(await fixture([0, 90]));
    source.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    const bytes = await source.save();
    const pages = await describeDocument(bytes, options);
    expect([pages[0].width, pages[0].height]).toEqual([400, 240]);
    const output = await rasterizeAndVerify(bytes, settings([], 72), options);
    expect(output.report.pages).toHaveLength(2);
    expect(output.report.pages[0].pixelWidth).toBe(400);
    expect(output.report.regionCount).toBe(0);
  });

  it('excludes visible form appearances rather than burning their values into pixels', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 120]);
    const field = pdf.getForm().createTextField('private-field');
    field.setText('SECRET');
    field.addToPage(page, { x: 20, y: 20, width: 150, height: 80, backgroundColor: rgb(0, 0, 0) });
    const result = await rasterizeAndVerify(await pdf.save(), settings([], 72), options);
    const pixels = await imageRgb(result.bytes);
    expect(pixels.every((value) => value === 255)).toBe(true);
  });

  it('rejects tampered image pixels, source objects, and page content after serialization', async () => {
    const result = await rasterizeAndVerify(await fixture(), settings(), options);
    const pdf = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const page = pdf.getPage(0);
    const content = page.node.lookup(PDFName.of('Contents'), PDFArray).lookup(0) as PDFRawStream;
    const expected: ExpectedRasterPage[] = [{ ...result.report.pages[0], rgbSha256: await sha256(await imageRgb(result.bytes)), contentSha256: await sha256(decodePDFRawStream(content).decode()) }];
    await expect(verifyRasterPdfStructure(result.bytes, expected)).resolves.toBeUndefined();
    await expect(verifyRasterPdfStructure(result.bytes, [{ ...expected[0], rgbSha256: 'bad' }])).rejects.toThrow('保存は許可されません');
    pdf.context.register(pdf.context.obj({ secret: 'orphan' }));
    await expect(verifyRasterPdfStructure(await pdf.save({ useObjectStreams: false }), expected)).rejects.toThrow();
  });

  it('fails closed on cancellation, malformed PDF and canvas/encoding failures', async () => {
    const source = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(rasterizeAndVerify(source, settings(), { ...options, signal: controller.signal })).rejects.toThrow();
    await expect(rasterizeAndVerify(new Uint8Array([1, 2, 3]), settings(), options)).rejects.toThrow('読み込めません');
    let disposed = false;
    await expect(rasterizeAndVerify(source, settings(), { ...options, canvasFactory: (w, h) => {
      const surface = nativeCanvas(w, h);
      return { ...surface, encodePng: async () => { throw new Error('SECRET INTERNAL ERROR'); }, dispose: () => { disposed = true; surface.dispose(); } };
    } })).rejects.toThrow('保存できません');
    expect(disposed).toBe(true);
    const during = new AbortController();
    await expect(rasterizeAndVerify(source, settings(), { ...options, signal: during.signal, onProgress: () => during.abort() })).rejects.toThrow();
  });
});
