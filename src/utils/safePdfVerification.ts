import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface ExpectedRasterPage {
  pageNumber: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  rgbSha256: string;
  contentSha256: string;
}

export interface SafePdfReport {
  version: 1;
  method: 'raster-regions-v1';
  dpi: number;
  pageCount: number;
  regionCount: number;
  outputSha256: string;
  pages: Array<Pick<ExpectedRasterPage, 'pageNumber' | 'width' | 'height' | 'pixelWidth' | 'pixelHeight'>>;
  checks: { structure: true; text: true; pixels: true; sourceUnchanged: true };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('生成 PDF の構造・画素検証に失敗しました。保存は許可されません');
}

function keys(dictionary: PDFDict, allowed: string[]) {
  check(dictionary.keys().every((key) => allowed.includes(key.decodeText())));
}

function number(dictionary: PDFDict, name: string): number {
  const value = dictionary.lookup(PDFName.of(name));
  check(value instanceof PDFNumber);
  return value.asNumber();
}

/**
 * Verify the actual serialized PDF, including every indirect object. Exact decoded RGB
 * hashes include pixels outside the selected regions; no original image or alpha mask is
 * permitted alongside the processed image. This does not discover unselected secrets.
 */
export async function verifyRasterPdfStructure(bytes: Uint8Array, expected: ExpectedRasterPage[], signal?: AbortSignal) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  check(!pdf.isEncrypted && !pdf.context.trailerInfo.Info && !pdf.context.trailerInfo.Encrypt && !pdf.context.trailerInfo.ID);
  check(pdf.getPageCount() === expected.length);
  keys(pdf.catalog, ['Type', 'Pages']);
  check(pdf.catalog.get(PDFName.of('Type')) === PDFName.of('Catalog'));
  const knownRefs = new Set<string>();
  const mark = (ref: unknown) => { check(ref instanceof PDFRef); knownRefs.add(ref.toString()); };
  mark(pdf.context.trailerInfo.Root);
  const visitTree = (ref: unknown) => {
    mark(ref);
    const dict = pdf.context.lookup(ref as PDFRef, PDFDict);
    if (dict.get(PDFName.of('Type')) === PDFName.of('Page')) return;
    keys(dict, ['Type', 'Kids', 'Count', 'Parent']);
    check(dict.get(PDFName.of('Type')) === PDFName.of('Pages'));
    const children = dict.lookup(PDFName.of('Kids'), PDFArray);
    for (let i = 0; i < children.size(); i++) visitTree(children.get(i));
  };
  visitTree(pdf.catalog.get(PDFName.of('Pages')));
  for (let index = 0; index < expected.length; index++) {
    signal?.throwIfAborted();
    const page = pdf.getPage(index);
    const info = expected[index];
    keys(page.node, ['Type', 'Parent', 'MediaBox', 'Resources', 'Contents']);
    check(Math.abs(page.getWidth() - info.width) < 0.00001 && Math.abs(page.getHeight() - info.height) < 0.00001);
    check(page.getRotation().angle === 0);
    const resources = page.node.lookup(PDFName.of('Resources'), PDFDict);
    keys(resources, ['XObject', 'Font', 'ExtGState']);
    for (const name of ['Font', 'ExtGState']) {
      const dict = resources.lookupMaybe(PDFName.of(name), PDFDict);
      check(!dict || dict.keys().length === 0);
    }
    const images = resources.lookup(PDFName.of('XObject'), PDFDict);
    check(images.keys().length === 1);
    const imageRef = images.get(images.keys()[0]);
    mark(imageRef);
    const image = pdf.context.lookup(imageRef);
    check(image instanceof PDFRawStream);
    keys(image.dict, ['Type', 'Subtype', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent', 'Length', 'Filter']);
    check(image.dict.get(PDFName.of('Type')) === PDFName.of('XObject') && image.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    check(image.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB'));
    check(image.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode'));
    check(number(image.dict, 'BitsPerComponent') === 8 && number(image.dict, 'Width') === info.pixelWidth && number(image.dict, 'Height') === info.pixelHeight);
    const rgb = decodePDFRawStream(image).decode();
    check(rgb.length === info.pixelWidth * info.pixelHeight * 3);
    check(await sha256(rgb) === info.rgbSha256);
    const contents = page.node.lookup(PDFName.of('Contents'), PDFArray);
    check(contents.size() === 1);
    mark(contents.get(0));
    const content = contents.lookup(0);
    check(content instanceof PDFRawStream);
    keys(content.dict, ['Length', 'Filter']);
    check(content.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode'));
    check(await sha256(decodePDFRawStream(content).decode()) === info.contentSha256);
  }
  // Every serialized object must be one of the pages, their tree, processed images, or
  // generated drawing streams. An unreachable source object would fail this check too.
  check(pdf.context.enumerateIndirectObjects().every(([ref]) => knownRefs.has(ref.toString())));
}

export async function verifyRasterPdfText(document: PDFDocumentProxy, expected: ExpectedRasterPage[], signal?: AbortSignal, onPage?: (page: number) => void) {
  check(document.numPages === expected.length);
  check(!(await document.getAttachments()));
  check(!(await document.getJSActions()));
  const metadata = await document.getMetadata();
  check(!metadata.metadata);
  for (let index = 0; index < expected.length; index++) {
    signal?.throwIfAborted();
    const page = await document.getPage(index + 1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      check(Math.abs(viewport.width - expected[index].width) < 0.00001 && Math.abs(viewport.height - expected[index].height) < 0.00001);
      check((await page.getTextContent()).items.length === 0);
      check((await page.getAnnotations()).length === 0);
      // Parse display instructions as a second parser before allowing the candidate.
      await page.getOperatorList();
      onPage?.(index + 1);
    } finally { page.cleanup(); }
  }
}
