import { jsPDF } from 'jspdf';

export type ImageRotation = 0 | 90 | 180 | 270;
export type PageSize = 'original' | 'a4' | 'a3' | 'b5' | 'letter';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type ImageFit = 'contain' | 'cover';
export type QualityPreset = 'high' | 'standard' | 'compact';
export type PdfImageFormat = 'auto' | 'jpeg' | 'png';
export type ImageSortOrder = 'natural' | 'modified-newest' | 'modified-oldest';

export interface ImageCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ImageAdjustments {
  rotation: ImageRotation;
  crop: ImageCrop;
  grayscale: boolean;
  contrast: number;
}

export interface ImageFile {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
  adjustments?: Partial<ImageAdjustments>;
}

export interface ImagesToPdfOptions {
  pageSize: PageSize;
  orientation: PageOrientation;
  margin: number;
  fit: ImageFit;
  backgroundColor: string;
  qualityPreset: QualityPreset;
  jpegQuality: number;
  imageFormat: PdfImageFormat;
}

export interface PageDimensions {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QualitySettings {
  maxDimension: number;
  jpegQuality: number;
  compression: 'FAST' | 'MEDIUM' | 'SLOW';
}

export const EMPTY_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  rotation: 0,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  grayscale: false,
  contrast: 1,
};

export const DEFAULT_IMAGES_TO_PDF_OPTIONS: ImagesToPdfOptions = {
  pageSize: 'original',
  orientation: 'auto',
  margin: 0,
  fit: 'contain',
  backgroundColor: '#ffffff',
  qualityPreset: 'standard',
  jpegQuality: 0.85,
  imageFormat: 'auto',
};

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  high: { maxDimension: 4096, jpegQuality: 0.95, compression: 'SLOW' },
  standard: { maxDimension: 3200, jpegQuality: 0.85, compression: 'MEDIUM' },
  compact: { maxDimension: 1800, jpegQuality: 0.65, compression: 'FAST' },
};

const PAGE_SIZES_MM: Record<Exclude<PageSize, 'original'>, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  b5: [176, 250],
  letter: [215.9, 279.4],
};

const PX_TO_MM = 25.4 / 96;

export function getImageAdjustments(image: ImageFile): ImageAdjustments {
  return {
    ...EMPTY_IMAGE_ADJUSTMENTS,
    ...image.adjustments,
    crop: {
      ...EMPTY_IMAGE_ADJUSTMENTS.crop,
      ...image.adjustments?.crop,
    },
  };
}

export function getEffectiveImageDimensions(image: ImageFile): { width: number; height: number } {
  const adjustments = getImageAdjustments(image);
  const cropWidth = Math.max(1, image.width * (1 - (adjustments.crop.left + adjustments.crop.right) / 100));
  const cropHeight = Math.max(1, image.height * (1 - (adjustments.crop.top + adjustments.crop.bottom) / 100));
  const swapsDimensions = adjustments.rotation === 90 || adjustments.rotation === 270;
  return swapsDimensions
    ? { width: cropHeight, height: cropWidth }
    : { width: cropWidth, height: cropHeight };
}

export function resolvePageDimensions(
  image: ImageFile,
  options: Pick<ImagesToPdfOptions, 'pageSize' | 'orientation'>,
): PageDimensions {
  const imageDimensions = getEffectiveImageDimensions(image);
  let portraitWidth: number;
  let portraitHeight: number;

  if (options.pageSize === 'original') {
    const width = Math.max(1, imageDimensions.width * PX_TO_MM);
    const height = Math.max(1, imageDimensions.height * PX_TO_MM);
    portraitWidth = Math.min(width, height);
    portraitHeight = Math.max(width, height);
  } else {
    [portraitWidth, portraitHeight] = PAGE_SIZES_MM[options.pageSize];
  }

  const orientation = options.orientation === 'auto'
    ? imageDimensions.width > imageDimensions.height ? 'landscape' : 'portrait'
    : options.orientation;

  return orientation === 'landscape'
    ? { width: portraitHeight, height: portraitWidth, orientation }
    : { width: portraitWidth, height: portraitHeight, orientation };
}

export function calculateImagePlacement(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  fit: ImageFit,
): ImagePlacement {
  const safeMargin = Math.max(0, Math.min(margin, Math.min(pageWidth, pageHeight) / 2 - 0.1));
  const availableWidth = Math.max(0.1, pageWidth - safeMargin * 2);
  const availableHeight = Math.max(0.1, pageHeight - safeMargin * 2);
  const widthScale = availableWidth / Math.max(1, imageWidth);
  const heightScale = availableHeight / Math.max(1, imageHeight);
  const scale = fit === 'cover' ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: safeMargin + (availableWidth - width) / 2,
    y: safeMargin + (availableHeight - height) / 2,
    width,
    height,
  };
}

export function fileFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>): string {
  return [file.name.toLocaleLowerCase(), file.size, file.lastModified, file.type].join('\u0000');
}

export function removeDuplicateFiles(
  files: File[],
  existingImages: ImageFile[] = [],
): { files: File[]; duplicateCount: number } {
  const seen = new Set(existingImages.map((image) => fileFingerprint(image.file)));
  const uniqueFiles: File[] = [];
  let duplicateCount = 0;

  for (const file of files) {
    const fingerprint = fileFingerprint(file);
    if (seen.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fingerprint);
    uniqueFiles.push(file);
  }

  return { files: uniqueFiles, duplicateCount };
}

export function sortImageFiles(images: ImageFile[], order: ImageSortOrder): ImageFile[] {
  return [...images].sort((a, b) => {
    if (order === 'modified-newest') {
      return b.file.lastModified - a.file.lastModified || naturalNameCompare(a.file.name, b.file.name);
    }
    if (order === 'modified-oldest') {
      return a.file.lastModified - b.file.lastModified || naturalNameCompare(a.file.name, b.file.name);
    }
    return naturalNameCompare(a.file.name, b.file.name);
  });
}

export function normalizePdfFileName(value: string): string {
  let withoutInvalidCharacters = value.trim().replace(/[<>:"/\\|?*]/g, '_');
  for (let code = 0; code <= 31; code += 1) {
    withoutInvalidCharacters = withoutInvalidCharacters.replaceAll(String.fromCharCode(code), '_');
  }
  const baseName = withoutInvalidCharacters.replace(/\.pdf$/i, '') || 'images_to_pdf';
  return `${baseName}.pdf`;
}

export async function imagesToPdf(
  images: ImageFile[],
  onProgress?: (progress: number) => void,
  options: Partial<ImagesToPdfOptions> = {},
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('No images to convert');
  }

  const qualityPreset = options.qualityPreset ?? DEFAULT_IMAGES_TO_PDF_OPTIONS.qualityPreset;
  const resolvedOptions: ImagesToPdfOptions = {
    ...DEFAULT_IMAGES_TO_PDF_OPTIONS,
    ...options,
    margin: Math.max(0, Number.isFinite(options.margin) ? options.margin as number : DEFAULT_IMAGES_TO_PDF_OPTIONS.margin),
    qualityPreset,
    jpegQuality: clamp(options.jpegQuality ?? QUALITY_PRESETS[qualityPreset].jpegQuality, 0.1, 1),
  };
  const firstPage = resolvePageDimensions(images[0], resolvedOptions);
  const pdf = new jsPDF({
    orientation: firstPage.orientation,
    unit: 'mm',
    format: [firstPage.width, firstPage.height],
    compress: true,
  });

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const page = resolvePageDimensions(image, resolvedOptions);
    const effectiveDimensions = getEffectiveImageDimensions(image);

    if (index > 0) {
      pdf.addPage([page.width, page.height], page.orientation);
    }

    const [red, green, blue] = hexToRgb(resolvedOptions.backgroundColor);
    pdf.setFillColor(red, green, blue);
    pdf.rect(0, 0, page.width, page.height, 'F');

    const safeMargin = Math.max(0, Math.min(resolvedOptions.margin, Math.min(page.width, page.height) / 2 - 0.1));
    const contentWidth = Math.max(0.1, page.width - safeMargin * 2);
    const contentHeight = Math.max(0.1, page.height - safeMargin * 2);
    const coverAspect = resolvedOptions.fit === 'cover' ? contentWidth / contentHeight : undefined;
    const prepared = await prepareImage(image, resolvedOptions, coverAspect);
    const placement = coverAspect
      ? { x: safeMargin, y: safeMargin, width: contentWidth, height: contentHeight }
      : calculateImagePlacement(
          effectiveDimensions.width,
          effectiveDimensions.height,
          page.width,
          page.height,
          safeMargin,
          'contain',
        );

    pdf.addImage(
      prepared.dataUrl,
      prepared.format,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
      undefined,
      QUALITY_PRESETS[resolvedOptions.qualityPreset].compression,
    );
    onProgress?.(((index + 1) / images.length) * 100);
  }

  return pdf.output('blob');
}

export function loadImage(file: File): Promise<ImageFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          file,
          preview: event.target?.result as string,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          adjustments: { ...EMPTY_IMAGE_ADJUSTMENTS, crop: { ...EMPTY_IMAGE_ADJUSTMENTS.crop } },
        });
      };
      image.onerror = () => reject(new Error(`画像を読み込めませんでした: ${file.name}`));
      image.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error(`ファイルを読み込めませんでした: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function naturalNameCompare(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' });
}

function resolveOutputFormat(image: ImageFile, option: PdfImageFormat): 'JPEG' | 'PNG' {
  if (option === 'jpeg') return 'JPEG';
  if (option === 'png') return 'PNG';
  return /image\/(png|webp|gif)/i.test(image.file.type) ? 'PNG' : 'JPEG';
}

async function prepareImage(
  image: ImageFile,
  options: ImagesToPdfOptions,
  coverAspect?: number,
): Promise<{ dataUrl: string; format: 'JPEG' | 'PNG' }> {
  const source = await loadPreviewElement(image.preview);
  const adjustments = getImageAdjustments(image);
  const quality = QUALITY_PRESETS[options.qualityPreset];
  const crop = sanitizeCrop(adjustments.crop);
  const sourceX = source.naturalWidth * crop.left / 100;
  const sourceY = source.naturalHeight * crop.top / 100;
  const sourceWidth = Math.max(1, source.naturalWidth * (1 - (crop.left + crop.right) / 100));
  const sourceHeight = Math.max(1, source.naturalHeight * (1 - (crop.top + crop.bottom) / 100));
  const swapsDimensions = adjustments.rotation === 90 || adjustments.rotation === 270;
  const rotatedWidth = swapsDimensions ? sourceHeight : sourceWidth;
  const rotatedHeight = swapsDimensions ? sourceWidth : sourceHeight;
  const scale = Math.min(1, quality.maxDimension / Math.max(rotatedWidth, rotatedHeight));
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = swapsDimensions ? drawHeight : drawWidth;
  canvas.height = swapsDimensions ? drawWidth : drawHeight;
  const context = canvas.getContext('2d');

  if (!context) throw new Error('画像処理用のCanvasを作成できませんでした');

  const format = resolveOutputFormat(image, options.imageFormat);
  if (format === 'JPEG') {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(adjustments.rotation * Math.PI / 180);
  context.filter = `grayscale(${adjustments.grayscale ? 1 : 0}) contrast(${clamp(adjustments.contrast, 0.5, 2)})`;
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();

  const finalCanvas = coverAspect ? centerCropCanvas(canvas, coverAspect, format, options.backgroundColor) : canvas;
  const jpegQuality = clamp(options.jpegQuality ?? quality.jpegQuality, 0.1, 1);
  const dataUrl = finalCanvas.toDataURL(format === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
  if (finalCanvas !== canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  finalCanvas.width = 0;
  finalCanvas.height = 0;
  source.src = '';
  return {
    dataUrl,
    format,
  };
}

function centerCropCanvas(
  source: HTMLCanvasElement,
  targetAspect: number,
  format: 'JPEG' | 'PNG',
  backgroundColor: string,
): HTMLCanvasElement {
  const sourceAspect = source.width / source.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = source.width;
  let sourceHeight = source.height;

  if (sourceAspect > targetAspect) {
    sourceWidth = source.height * targetAspect;
    sourceX = (source.width - sourceWidth) / 2;
  } else {
    sourceHeight = source.width / targetAspect;
    sourceY = (source.height - sourceHeight) / 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth));
  canvas.height = Math.max(1, Math.round(sourceHeight));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像の切り抜きに失敗しました');
  if (format === 'JPEG') {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadPreviewElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像プレビューを処理できませんでした'));
    image.src = dataUrl;
  });
}

function sanitizeCrop(crop: ImageCrop): ImageCrop {
  const sanitized = {
    top: clamp(crop.top, 0, 45),
    right: clamp(crop.right, 0, 45),
    bottom: clamp(crop.bottom, 0, 45),
    left: clamp(crop.left, 0, 45),
  };
  if (sanitized.left + sanitized.right >= 95) sanitized.right = 94 - sanitized.left;
  if (sanitized.top + sanitized.bottom >= 95) sanitized.bottom = 94 - sanitized.top;
  return sanitized;
}

function hexToRgb(value: string): [number, number, number] {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return [255, 255, 255];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
