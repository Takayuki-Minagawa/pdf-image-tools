import { PDFArray, PDFContentStream, PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { REGION_REDACTION_LIMITS, parseRegionRedactionSettings, type RegionPageInfo, type RegionRedactionRegion, type RegionRedactionSettings } from '../types/regionRedaction';
import { ensurePdfjsWorker } from './pdfjsWorker';
import { getPdfjsDocumentOptions } from './pdfjsDocumentOptions';
import { sha256, verifyRasterPdfStructure, verifyRasterPdfText, type ExpectedRasterPage, type SafePdfReport } from './safePdfVerification';

export type { RegionPageInfo, RegionRedactionSettings, RegionRedactionRegion } from '../types/regionRedaction';
export type { SafePdfReport } from './safePdfVerification';

export interface RasterCanvasSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  encodePng: () => Promise<Uint8Array>;
  dispose: () => void;
}
export type RasterCanvasFactory = (width: number, height: number) => RasterCanvasSurface;
export interface RegionRedactionProgress { stage: 'rendering' | 'verifying'; page: number; total: number }
export interface RegionRedactionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RegionRedactionProgress) => void;
  canvasFactory?: RasterCanvasFactory;
  documentOptions?: Partial<DocumentInitParameters>;
}
export interface RegionRedactionEstimate {
  totalPixels: number;
  maxPagePixels: number;
  estimatedWorkingBytes: number;
  estimatedOutputBytes: number;
}

export const browserRasterCanvas: RasterCanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('画像処理用の Canvas を作成できません');
  return {
    canvas, context,
    encodePng: () => new Promise((resolve, reject) => canvas.toBlob((blob) => {
      if (!blob) reject(new Error('処理済み画像を符号化できません'));
      else blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png')),
    dispose: () => { canvas.width = 0; canvas.height = 0; },
  };
};

function assertInput(bytes: ArrayBuffer | Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > REGION_REDACTION_LIMITS.maxInputBytes) throw new Error('原本は 128 MiB 以下の PDF を指定してください');
}

function dataCopy(bytes: ArrayBuffer | Uint8Array) { return bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0)); }

async function openDocument(bytes: ArrayBuffer | Uint8Array, options: RegionRedactionOptions) {
  options.signal?.throwIfAborted();
  ensurePdfjsWorker();
  const task = pdfjs.getDocument({
    ...getPdfjsDocumentOptions(), ...options.documentOptions,
    url: undefined, range: undefined, data: dataCopy(bytes), password: undefined,
    isEvalSupported: false, useSystemFonts: false, stopAtErrors: true, verbosity: 0,
  });
  const cancel = () => { void task.destroy().catch(() => undefined); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const document = await task.promise;
    // An empty user password opens without a password challenge, but is still an
    // encrypted input. Reject it as well as password-protected documents.
    if (await document.getPermissions() !== null) throw new Error('encrypted input');
    options.signal?.throwIfAborted();
    return document;
  } catch {
    // Failed loading tasks also own worker-side document data and must be released.
    await task.destroy().catch(() => undefined);
    options.signal?.throwIfAborted();
    throw new Error('PDF を読み込めません。破損または暗号化された PDF は処理できません');
  }
  finally { options.signal?.removeEventListener('abort', cancel); }
}

async function pageInformation(document: pdfjs.PDFDocumentProxy, signal?: AbortSignal): Promise<RegionPageInfo[]> {
  if (document.numPages > REGION_REDACTION_LIMITS.maxPages) throw new Error('領域除去は 200 ページ以下に分割して実行してください');
  const result: RegionPageInfo[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    signal?.throwIfAborted();
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    if (![viewport.width, viewport.height, page.userUnit].every((n) => Number.isFinite(n) && n > 0)) throw new Error(`ページ ${pageNumber} の用紙寸法が正しくありません`);
    result.push({ pageNumber, width: viewport.width, height: viewport.height, rotation: page.rotate, userUnit: page.userUnit });
    page.cleanup();
  }
  return result;
}

export async function describeDocument(bytes: ArrayBuffer | Uint8Array, options: RegionRedactionOptions = {}) {
  assertInput(bytes);
  const document = await openDocument(bytes, options);
  try { return await pageInformation(document, options.signal); }
  finally { await document.destroy(); }
}

/** All bounds are explicit; the renderer never silently lowers the selected DPI. */
export function estimateRegionRedaction(pages: RegionPageInfo[], input: RegionRedactionSettings): RegionRedactionEstimate {
  const settings = parseRegionRedactionSettings(input);
  if (!pages.length || pages.length > REGION_REDACTION_LIMITS.maxPages) throw new Error('ページ数が処理上限を超えています');
  for (const region of settings.regions) {
    for (const pageNumber of region.pages) {
      const page = pages.find((item) => item.pageNumber === pageNumber);
      if (!page) throw new Error(`対象ページ ${pageNumber} がありません`);
      if (Math.abs(page.width - region.pageWidth) > 0.01 || Math.abs(page.height - region.pageHeight) > 0.01) throw new Error(`ページ ${pageNumber} の用紙寸法・向きが領域テンプレートと一致しません。個別に指定してください`);
    }
  }
  let totalPixels = 0;
  let maxPagePixels = 0;
  for (const page of pages) {
    if (![page.width, page.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error('用紙寸法が正しくありません');
    const width = Math.ceil(page.width * settings.dpi / 72);
    const height = Math.ceil(page.height * settings.dpi / 72);
    const pixels = width * height;
    if (width > REGION_REDACTION_LIMITS.maxCanvasSide || height > REGION_REDACTION_LIMITS.maxCanvasSide || pixels > REGION_REDACTION_LIMITS.maxPagePixels) throw new Error(`ページ ${page.pageNumber} の画素数が上限を超えます。DPI を下げてください`);
    totalPixels += pixels;
    maxPagePixels = Math.max(maxPagePixels, pixels);
  }
  // Conservative estimate: canvas/RGBA/RGB/PNG codec work plus worst-case PDF
  // object storage, serialization and the independently reopened verification copy.
  const estimatedWorkingBytes = maxPagePixels * 24 + totalPixels * 9;
  const estimatedOutputBytes = totalPixels * 3;
  if (totalPixels > REGION_REDACTION_LIMITS.maxTotalPixels || estimatedWorkingBytes > REGION_REDACTION_LIMITS.maxEstimatedBytes || estimatedOutputBytes > REGION_REDACTION_LIMITS.maxOutputBytes) throw new Error('推定メモリ・出力容量が上限を超えます。DPI を下げるか原本を分割してください');
  return { totalPixels, maxPagePixels, estimatedWorkingBytes, estimatedOutputBytes };
}

/** Outward rounding guarantees that every selected physical point is replaced. */
export function regionPixelBounds(region: Pick<RegionRedactionRegion, 'x' | 'y' | 'width' | 'height'>, dpi: number, width: number, height: number) {
  const scale = dpi / 72;
  return {
    left: Math.max(0, Math.floor(region.x * scale)),
    top: Math.max(0, Math.floor(region.y * scale)),
    right: Math.min(width, Math.ceil((region.x + region.width) * scale)),
    bottom: Math.min(height, Math.ceil((region.y + region.height) * scale)),
  };
}

/** Mutate the source raster itself; this image is the only image embedded in the PDF. */
export function replaceRegionPixels(rgba: Uint8ClampedArray, width: number, height: number, regions: RegionRedactionRegion[], dpi: number) {
  if (rgba.length !== width * height * 4) throw new Error('画像サイズが正しくありません');
  for (const region of regions) {
    const box = regionPixelBounds(region, dpi, width, height);
    const value = region.fill === 'black' ? 0 : 255;
    for (let y = box.top; y < box.bottom; y++) {
      for (let x = box.left; x < box.right; x++) {
        const offset = (y * width + x) * 4;
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
        rgba[offset + 3] = 255;
      }
    }
  }
}

function rgbBytes(rgba: Uint8ClampedArray) {
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) throw new Error('透明な画素が残っています。保存は許可されません');
    rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
  }
  return rgb;
}

export async function rasterizeAndVerify(bytes: ArrayBuffer | Uint8Array, input: RegionRedactionSettings, options: RegionRedactionOptions = {}): Promise<{ bytes: Uint8Array; report: SafePdfReport }> {
  assertInput(bytes);
  const settings = parseRegionRedactionSettings(input);
  options.signal?.throwIfAborted();
  const originalHash = await sha256(dataCopy(bytes));
  const source = await openDocument(bytes, options);
  let currentPage = 0;
  try {
    const pages = await pageInformation(source, options.signal);
    estimateRegionRedaction(pages, settings);
    const output = await PDFDocument.create({ updateMetadata: false });
    const expected: ExpectedRasterPage[] = [];
    const factory = options.canvasFactory ?? browserRasterCanvas;
    for (const info of pages) {
      currentPage = info.pageNumber;
      options.signal?.throwIfAborted();
      options.onProgress?.({ stage: 'rendering', page: info.pageNumber, total: pages.length });
      options.signal?.throwIfAborted();
      const page = await source.getPage(info.pageNumber);
      const viewport = page.getViewport({ scale: settings.dpi / 72 });
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
      const surface = factory(width, height);
      try {
        // The integer canvas can extend beyond a fractional CropBox. Clip before
        // rendering so content outside the visible page cannot enter edge pixels.
        // Initialize the padding first, and restore our clip before redaction.
        surface.context.fillStyle = '#ffffff';
        surface.context.fillRect(0, 0, width, height);
        surface.context.save();
        surface.context.beginPath();
        surface.context.rect(0, 0, viewport.width, viewport.height);
        surface.context.clip();
        try {
          const render = page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' });
          const cancel = () => render.cancel();
          options.signal?.addEventListener('abort', cancel, { once: true });
          try { await render.promise; } finally { options.signal?.removeEventListener('abort', cancel); }
        } finally { surface.context.restore(); }
        options.signal?.throwIfAborted();
        const imageData = surface.context.getImageData(0, 0, width, height);
        replaceRegionPixels(imageData.data, width, height, settings.regions.filter((region) => region.pages.includes(info.pageNumber)), settings.dpi);
        const rgbSha256 = await sha256(rgbBytes(imageData.data));
        // Paint opaque, integer-aligned replacements into the raster before encoding.
        // The independently replaced pixel array above is the verification reference.
        // Reset PDF.js drawing state explicitly; no PDF overlay objects are emitted.
        surface.context.save();
        surface.context.resetTransform();
        surface.context.globalAlpha = 1;
        surface.context.globalCompositeOperation = 'source-over';
        surface.context.shadowBlur = 0;
        for (const region of settings.regions.filter((item) => item.pages.includes(info.pageNumber))) {
          const box = regionPixelBounds(region, settings.dpi, width, height);
          surface.context.fillStyle = region.fill === 'black' ? '#000000' : '#ffffff';
          surface.context.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        }
        surface.context.restore();
        const png = await surface.encodePng();
        options.signal?.throwIfAborted();
        const image = await output.embedPng(png);
        if (image.width !== width || image.height !== height) throw new Error('符号化画像の寸法が一致しません');
        const newPage = output.addPage([info.width, info.height]);
        // ceil(viewport dimensions) adds a fractional edge pixel. Keep the image's
        // actual DPI and align its top-left, letting the page clip that padding.
        // Stretching it to info.width/height would shift the selected mask inward.
        const rasterWidth = width * 72 / settings.dpi;
        const rasterHeight = height * 72 / settings.dpi;
        newPage.drawImage(image, { x: 0, y: info.height - rasterHeight, width: rasterWidth, height: rasterHeight });
        newPage.node.delete(PDFName.of('Annots'));
        await image.embed(); // Release PNG decoder buffers before rendering the next page.
        const content = newPage.node.lookup(PDFName.of('Contents'), PDFArray).lookup(0);
        if (!(content instanceof PDFContentStream)) throw new Error('生成内容を検証できません');
        const contentSha256 = await sha256(content.getUnencodedContents());
        expected.push({ pageNumber: info.pageNumber, width: info.width, height: info.height, pixelWidth: width, pixelHeight: height, rgbSha256, contentSha256 });
      } finally { surface.dispose(); page.cleanup(); }
    }
    options.signal?.throwIfAborted();
    const result = await output.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    if (result.byteLength > REGION_REDACTION_LIMITS.maxOutputBytes) throw new Error('出力容量が上限を超えています。DPI を下げてください');
    options.onProgress?.({ stage: 'verifying', page: 0, total: pages.length });
    await verifyRasterPdfStructure(result, expected, options.signal);
    const reopened = await openDocument(result, options);
    try {
      await verifyRasterPdfText(reopened, expected, options.signal, (page) => options.onProgress?.({ stage: 'verifying', page, total: pages.length }));
    } finally { await reopened.destroy(); }
    options.signal?.throwIfAborted();
    if (await sha256(dataCopy(bytes)) !== originalHash) throw new Error('処理中に原本データが変更されました。保存は許可されません');
    const report: SafePdfReport = {
      version: 1, method: 'raster-regions-v1', dpi: settings.dpi, pageCount: pages.length,
      regionCount: settings.regions.reduce((count, region) => count + region.pages.length, 0),
      outputSha256: await sha256(result),
      pages: expected.map(({ pageNumber, width, height, pixelWidth, pixelHeight }) => ({ pageNumber, width, height, pixelWidth, pixelHeight })),
      checks: { structure: true, text: true, pixels: true, sourceUnchanged: true },
    };
    return { bytes: result, report };
  } catch (error) {
    options.signal?.throwIfAborted();
    // Parser messages can contain document text: expose only a safe location and category.
    if (error instanceof Error && /^(推定|対象ページ|ページ \d+ の用紙寸法|ページ \d+ の画素数|生成 PDF|出力容量|処理中に原本|領域除去は)/.test(error.message)) throw error;
    throw new Error(`ページ ${currentPage || 1} の領域除去・検証に失敗しました。出力は保存できません`);
  } finally { await source.destroy(); }
}
