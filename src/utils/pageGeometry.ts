import {
  PDFName,
  PDFNumber,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
} from 'pdf-lib';

export type PageRotation = 0 | 90 | 180 | 270;

/**
 * 表示されるページの幾何情報。
 * PDF.js（プレビュー）と同じく CropBox∩MediaBox と /UserUnit を考慮する。
 */
export interface VisiblePageGeometry {
  /** 可視領域の左下（PDFユーザー空間） */
  x: number;
  y: number;
  /** 可視領域の大きさ（回転前、ユーザー空間pt） */
  width: number;
  height: number;
  rotation: PageRotation;
  userUnit: number;
  /** 回転後に見える大きさ（物理pt） */
  visualWidth: number;
  visualHeight: number;
}

type Box = { x: number; y: number; width: number; height: number };

function normalizeBox(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

/** Matches PDF.js's visible page bounds, including cropped and scaled PDFs. */
export function getVisiblePageGeometry(page: PDFPage): VisiblePageGeometry {
  const media = normalizeBox(page.getMediaBox());
  const crop = normalizeBox(page.getCropBox());
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  // PDF.js falls back to MediaBox when the two boxes have no area in common.
  const bounds = right > left && top > bottom
    ? { x: left, y: bottom, width: right - left, height: top - bottom }
    : media;
  const rawRotation = ((page.getRotation().angle % 360) + 360) % 360;
  const rotation = (rawRotation % 90 === 0 ? rawRotation : 0) as PageRotation;
  const unitObject = page.node.lookup(PDFName.of('UserUnit'));
  const rawUnit = unitObject instanceof PDFNumber ? unitObject.asNumber() : 1;
  const userUnit = Number.isFinite(rawUnit) && rawUnit > 0 ? rawUnit : 1;
  const swapped = rotation === 90 || rotation === 270;
  return {
    ...bounds,
    rotation,
    userUnit,
    visualWidth: (swapped ? bounds.height : bounds.width) * userUnit,
    visualHeight: (swapped ? bounds.width : bounds.height) * userUnit,
  };
}

/** Visible top-left coordinates (PDF.js scale 1) to unrotated PDF user space. */
export function visualToPdf(page: PDFPage, visualX: number, visualY: number) {
  const g = getVisiblePageGeometry(page);
  const x = visualX / g.userUnit;
  const y = visualY / g.userUnit;
  switch (g.rotation) {
    case 90: return { x: g.x + y, y: g.y + x };
    case 180: return { x: g.x + g.width - x, y: g.y + y };
    case 270: return { x: g.x + g.width - y, y: g.y + g.height - x };
    default: return { x: g.x + x, y: g.y + g.height - y };
  }
}

/**
 * 表示と一致する「左下原点・物理pt」の描画空間を一時的に確立し、その中で draw を実行する。
 * 回転・CropBox 原点・UserUnit を CTM に畳み込むため、呼び出し側は
 * (x, visualHeight - y) の単純な座標で描画できる。
 */
export function withVisualSpace<T>(
  page: PDFPage,
  draw: (space: { width: number; height: number }) => T,
): T {
  const { visualWidth, visualHeight, userUnit, rotation } = getVisiblePageGeometry(page);
  const origin = visualToPdf(page, 0, visualHeight);
  const scale = 1 / userUnit;
  const matrices = {
    0: [scale, 0, 0, scale],
    90: [0, scale, -scale, 0],
    180: [-scale, 0, 0, -scale],
    270: [0, -scale, scale, 0],
  } as const;
  const [a, b, c, d] = matrices[rotation];
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, origin.x, origin.y));
  try {
    return draw({ width: visualWidth, height: visualHeight });
  } finally {
    page.pushOperators(popGraphicsState());
  }
}
