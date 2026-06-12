/**
 * PDF内の既存コンテンツ（テキスト / ベクターパス）の認識結果と、
 * それらに対する編集内容の型定義。
 *
 * 座標系はすべて PDFユーザー空間（原点 = ページ左下、単位 pt）。
 */

export interface PagePoint {
  x: number;
  y: number;
}

export interface PageBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RecognizedTextItem {
  id: string;
  kind: 'text';
  pageIndex: number; // 元PDFのページインデックス（0始まり）
  text: string;
  x: number; // ベースライン左端
  y: number; // ベースラインY
  width: number;
  height: number; // 概算の文字高（≒フォントサイズ）
  fontSize: number;
}

export type RecognizedShape = 'line' | 'polyline' | 'polygon' | 'rectangle';

export interface RecognizedPathItem {
  id: string;
  kind: 'path';
  pageIndex: number;
  shape: RecognizedShape;
  points: PagePoint[];
  closed: boolean;
  stroked: boolean;
  filled: boolean;
  strokeColor: string; // CSSカラー（pdf.jsは #rrggbb に正規化する）
  fillColor: string;
  lineWidth: number; // ページ空間でのpt
  bbox: PageBBox;
}

export type RecognizedItem = RecognizedTextItem | RecognizedPathItem;

export interface TextContentEdit {
  kind: 'text';
  target: RecognizedTextItem;
  action: 'replace' | 'delete';
  newText: string;
  fontSize: number;
  fontColor: string;
  coverColor: string; // 元要素を塗り潰す色
}

export interface PathContentEdit {
  kind: 'path';
  target: RecognizedPathItem;
  action: 'restyle' | 'delete';
  strokeColor: string;
  lineWidth: number;
  fillColor: string;
  coverColor: string;
}

export type ContentEdit = TextContentEdit | PathContentEdit;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeHexColor(color: string, fallback: string): string {
  if (HEX_COLOR_PATTERN.test(color)) return color;
  // #rgb → #rrggbb
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return fallback;
}

export function createTextEdit(target: RecognizedTextItem): TextContentEdit {
  return {
    kind: 'text',
    target,
    action: 'replace',
    newText: target.text,
    fontSize: Math.max(4, Math.round(target.fontSize)),
    fontColor: '#000000',
    coverColor: '#ffffff',
  };
}

export function createPathEdit(target: RecognizedPathItem): PathContentEdit {
  return {
    kind: 'path',
    target,
    action: 'restyle',
    strokeColor: normalizeHexColor(target.strokeColor, '#000000'),
    lineWidth: Math.max(0.1, Math.round(target.lineWidth * 10) / 10),
    fillColor: normalizeHexColor(target.fillColor, '#000000'),
    coverColor: '#ffffff',
  };
}
