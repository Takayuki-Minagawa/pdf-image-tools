/**
 * 作業レシピ（PDF編集設定の再利用単位）の型定義と検証。
 *
 * ブラウザ（レシピ保存・バッチ処理）と CLI（apply-recipe）で同じ JSON を使うため、
 * window や DOM に依存しない純粋なモジュールにしている。
 *
 * - version 1: テキストボックス / ヘッダー・フッター / ページ番号 / 画像出力設定
 * - version 2: 上記 + 図形・画像 / 透かし / 既存コンテンツ編集ルール（contentRules）
 */
import type { PdfGraphic, PdfGraphicKind, WatermarkConfig } from './pdfGraphics';
import { DEFAULT_WATERMARK } from './pdfGraphics';
import type {
  HeaderFooterSettings,
  PageNumberingConfig,
  PdfImageExportOptions,
  TextBoxConfig,
} from './pdfEdit';
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_IMAGE_EXPORT_OPTIONS,
  DEFAULT_PAGE_NUMBERING,
} from './pdfEdit';
import type { RecognizedShape } from './contentEdit';

export const RECIPE_VERSION = 2;

/** 対象ページ。'all' または 1 始まりのページ番号の配列。 */
export type PageSelector = 'all' | number[];

export interface TextMatch {
  /** `inspect` が出力する要素ID（例: p0-text-3）。同じPDFに対して確実に指定できる。 */
  id?: string;
  /** 一致させる文字列（mode に従って解釈） */
  text?: string;
  /** exact: 要素全体が一致 / contains: 部分一致 / regex: 正規表現。既定 exact */
  mode?: 'exact' | 'contains' | 'regex';
  /** 既定 true */
  caseSensitive?: boolean;
  /** 既定 'all'。元PDFのページ番号（1始まり） */
  pages?: PageSelector;
  /** 既定 'all'。'first' は最初に見つかった1件だけ */
  occurrence?: 'all' | 'first';
}

export interface TextContentRule {
  kind: 'text';
  match: TextMatch;
  /** replace: 置換 / delete: カバーで隠す / redact: 文字データを物理削除 */
  action: 'replace' | 'delete' | 'redact';
  /** replace 時の新しい文字列。contains / regex では一致部分だけを置き換える */
  newText?: string;
  /** 省略時は認識したサイズ */
  fontSize?: number;
  /** 既定 #000000 */
  fontColor?: string;
  /** 元要素を塗り潰す色。既定 #ffffff */
  coverColor?: string;
}

export interface PathMatch {
  id?: string;
  pages?: PageSelector;
  shape?: RecognizedShape | RecognizedShape[];
  stroked?: boolean;
  filled?: boolean;
  /** 認識した線色（#rrggbb）と一致 */
  strokeColor?: string;
  fillColor?: string;
  /** PDFユーザー空間（左下原点・pt）の矩形。要素の bbox がこの範囲に収まるものを対象にする */
  within?: { x0: number; y0: number; x1: number; y1: number };
  /** within の許容誤差（pt）。既定 1 */
  tolerance?: number;
  occurrence?: 'all' | 'first';
}

export interface PathContentRule {
  kind: 'path';
  match: PathMatch;
  /** restyle: 線色・線幅・塗り色を変更 / delete: カバーで消す */
  action: 'restyle' | 'delete';
  strokeColor?: string;
  lineWidth?: number;
  fillColor?: string;
  coverColor?: string;
}

export type ContentRule = TextContentRule | PathContentRule;

/** レシピ内の図形。CLI では imagePath（レシピファイルからの相対パス）で画像を指定できる。 */
export interface RecipeGraphic extends PdfGraphic {
  imagePath?: string;
}

export interface PdfEditRecipe {
  version: typeof RECIPE_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
  imageExportOptions: PdfImageExportOptions;
  graphics: RecipeGraphic[];
  watermark: WatermarkConfig;
  contentRules: ContentRule[];
}

export class RecipeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeValidationError';
  }
}

const GRAPHIC_KINDS: readonly PdfGraphicKind[] = ['image', 'rectangle', 'ellipse', 'line', 'arrow', 'highlight'];
const SHAPES: readonly RecognizedShape[] = ['line', 'polyline', 'polygon', 'rectangle'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new RecipeValidationError(`${path}: ${message}`);
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '数値を指定してください');
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(path, '文字列を指定してください');
  return value;
}

function optionalColor(value: unknown, path: string): string | undefined {
  const text = optionalString(value, path);
  if (text !== undefined && !HEX_COLOR.test(text)) fail(path, '#rrggbb 形式の色を指定してください');
  return text;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(path, 'true / false を指定してください');
  return value;
}

function parsePages(value: unknown, path: string): PageSelector | undefined {
  if (value === undefined || value === 'all') return value as PageSelector | undefined;
  if (!Array.isArray(value) || value.some((page) => !Number.isInteger(page) || page < 1)) {
    fail(path, "'all' または 1 以上のページ番号の配列を指定してください");
  }
  return value as number[];
}

function parseOccurrence(value: unknown, path: string): 'all' | 'first' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'all' && value !== 'first') fail(path, "'all' または 'first' を指定してください");
  return value;
}

export function parseContentRule(value: unknown, path = 'contentRules'): ContentRule {
  if (!isRecord(value)) fail(path, 'オブジェクトを指定してください');
  if (!isRecord(value.match)) fail(`${path}.match`, '一致条件を指定してください');
  const match = value.match;

  if (value.kind === 'text') {
    if (value.action !== 'replace' && value.action !== 'delete' && value.action !== 'redact') {
      fail(`${path}.action`, "'replace' / 'delete' / 'redact' のいずれかを指定してください");
    }
    const mode = match.mode;
    if (mode !== undefined && mode !== 'exact' && mode !== 'contains' && mode !== 'regex') {
      fail(`${path}.match.mode`, "'exact' / 'contains' / 'regex' のいずれかを指定してください");
    }
    const id = optionalString(match.id, `${path}.match.id`);
    const text = optionalString(match.text, `${path}.match.text`);
    if (id === undefined && text === undefined) fail(`${path}.match`, 'id または text を指定してください');
    if (mode === 'regex' && text !== undefined) {
      try {
        new RegExp(text);
      } catch {
        fail(`${path}.match.text`, '正規表現として解釈できません');
      }
    }
    const rule: TextContentRule = {
      kind: 'text',
      match: {
        id,
        text,
        mode: mode as TextMatch['mode'],
        caseSensitive: optionalBoolean(match.caseSensitive, `${path}.match.caseSensitive`),
        pages: parsePages(match.pages, `${path}.match.pages`),
        occurrence: parseOccurrence(match.occurrence, `${path}.match.occurrence`),
      },
      action: value.action,
      newText: optionalString(value.newText, `${path}.newText`),
      fontSize: optionalNumber(value.fontSize, `${path}.fontSize`),
      fontColor: optionalColor(value.fontColor, `${path}.fontColor`),
      coverColor: optionalColor(value.coverColor, `${path}.coverColor`),
    };
    if (rule.action === 'replace' && rule.newText === undefined) {
      fail(`${path}.newText`, 'replace には newText が必要です');
    }
    return rule;
  }

  if (value.kind === 'path') {
    if (value.action !== 'restyle' && value.action !== 'delete') {
      fail(`${path}.action`, "'restyle' / 'delete' のいずれかを指定してください");
    }
    const shapes = match.shape === undefined ? undefined : Array.isArray(match.shape) ? match.shape : [match.shape];
    if (shapes?.some((shape) => !SHAPES.includes(shape as RecognizedShape))) {
      fail(`${path}.match.shape`, `${SHAPES.join(' / ')} のいずれかを指定してください`);
    }
    let within: PathMatch['within'];
    if (match.within !== undefined) {
      if (!isRecord(match.within)) fail(`${path}.match.within`, '{ x0, y0, x1, y1 } を指定してください');
      const box = match.within;
      const values = ['x0', 'y0', 'x1', 'y1'].map((key) => optionalNumber(box[key], `${path}.match.within.${key}`));
      if (values.some((entry) => entry === undefined)) fail(`${path}.match.within`, '{ x0, y0, x1, y1 } を指定してください');
      const [x0, y0, x1, y1] = values as number[];
      within = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    }
    return {
      kind: 'path',
      match: {
        id: optionalString(match.id, `${path}.match.id`),
        pages: parsePages(match.pages, `${path}.match.pages`),
        shape: shapes as RecognizedShape[] | undefined,
        stroked: optionalBoolean(match.stroked, `${path}.match.stroked`),
        filled: optionalBoolean(match.filled, `${path}.match.filled`),
        strokeColor: optionalColor(match.strokeColor, `${path}.match.strokeColor`),
        fillColor: optionalColor(match.fillColor, `${path}.match.fillColor`),
        within,
        tolerance: optionalNumber(match.tolerance, `${path}.match.tolerance`),
        occurrence: parseOccurrence(match.occurrence, `${path}.match.occurrence`),
      },
      action: value.action,
      strokeColor: optionalColor(value.strokeColor, `${path}.strokeColor`),
      lineWidth: optionalNumber(value.lineWidth, `${path}.lineWidth`),
      fillColor: optionalColor(value.fillColor, `${path}.fillColor`),
      coverColor: optionalColor(value.coverColor, `${path}.coverColor`),
    };
  }

  return fail(`${path}.kind`, "'text' または 'path' を指定してください");
}

function parseGraphic(value: unknown, path: string): RecipeGraphic {
  if (!isRecord(value)) fail(path, 'オブジェクトを指定してください');
  if (!GRAPHIC_KINDS.includes(value.kind as PdfGraphicKind)) {
    fail(`${path}.kind`, `${GRAPHIC_KINDS.join(' / ')} のいずれかを指定してください`);
  }
  const kind = value.kind as PdfGraphicKind;
  const number = (key: string, fallback: number) => optionalNumber(value[key], `${path}.${key}`) ?? fallback;
  const pageIndex = number('pageIndex', -1);
  if (!Number.isInteger(pageIndex) || pageIndex < -1) fail(`${path}.pageIndex`, '-1（全ページ）または 0 以上の整数を指定してください');
  const isLine = kind === 'line' || kind === 'arrow';
  const graphic: RecipeGraphic = {
    id: optionalString(value.id, `${path}.id`) ?? crypto.randomUUID(),
    kind,
    pageIndex,
    x: number('x', 0),
    y: number('y', 0),
    width: number('width', isLine ? 100 : 100),
    height: number('height', isLine ? 0 : 50),
    color: optionalColor(value.color, `${path}.color`) ?? (kind === 'highlight' ? '#facc15' : '#2563eb'),
    fillColor: value.fillColor === 'transparent' ? 'transparent'
      : optionalColor(value.fillColor, `${path}.fillColor`) ?? (kind === 'highlight' ? '#facc15' : 'transparent'),
    lineWidth: number('lineWidth', 2),
    opacity: number('opacity', kind === 'highlight' ? 0.4 : 1),
    label: optionalString(value.label, `${path}.label`) ?? kind,
  };
  const imageDataUrl = optionalString(value.imageDataUrl, `${path}.imageDataUrl`);
  const imagePath = optionalString(value.imagePath, `${path}.imagePath`);
  if (imageDataUrl) graphic.imageDataUrl = imageDataUrl;
  if (imagePath) graphic.imagePath = imagePath;
  if (kind === 'image' && !imageDataUrl && !imagePath) {
    fail(path, '画像には imageDataUrl（data:image/png;base64,...）または imagePath が必要です');
  }
  return graphic;
}

function parseTextBox(value: unknown, path: string): TextBoxConfig {
  if (!isRecord(value)) fail(path, 'オブジェクトを指定してください');
  const number = (key: string, fallback: number) => optionalNumber(value[key], `${path}.${key}`) ?? fallback;
  const borderStyle = value.borderStyle ?? 'solid';
  if (!['solid', 'dashed', 'dotted', 'none'].includes(borderStyle as string)) {
    fail(`${path}.borderStyle`, "'solid' / 'dashed' / 'dotted' / 'none' のいずれかを指定してください");
  }
  const pageIndex = number('pageIndex', -1);
  if (!Number.isInteger(pageIndex) || pageIndex < -1) fail(`${path}.pageIndex`, '-1（全ページ）または 0 以上の整数を指定してください');
  return {
    id: optionalString(value.id, `${path}.id`) ?? crypto.randomUUID(),
    text: optionalString(value.text, `${path}.text`) ?? '',
    x: number('x', 50),
    y: number('y', 50),
    width: number('width', 200),
    height: number('height', 60),
    fontSize: number('fontSize', 12),
    fontColor: optionalColor(value.fontColor, `${path}.fontColor`) ?? '#000000',
    backgroundColor: value.backgroundColor === 'transparent' ? 'transparent'
      : optionalColor(value.backgroundColor, `${path}.backgroundColor`) ?? 'transparent',
    borderStyle: borderStyle as TextBoxConfig['borderStyle'],
    borderWidth: number('borderWidth', 1),
    borderColor: optionalColor(value.borderColor, `${path}.borderColor`) ?? '#000000',
    pageIndex,
  };
}

function mergeDefaults<T extends object>(defaults: T, value: unknown): T {
  return isRecord(value) ? { ...defaults, ...(value as Partial<T>) } : { ...defaults };
}

/**
 * JSON から読み込んだ値をレシピとして検証・正規化する。version 1 は 2 へ移行する。
 * CLI 向けの手書き JSON を想定し、id / 日時 / 省略項目は既定値で補う。
 */
export function parseRecipe(value: unknown): PdfEditRecipe {
  if (!isRecord(value)) throw new RecipeValidationError('レシピは JSON オブジェクトである必要があります');
  if (value.version !== 1 && value.version !== 2) {
    throw new RecipeValidationError('このファイルは PDF Image Tools のレシピではありません（version が 1 または 2 ではありません）');
  }
  const now = Date.now();
  const headerFooterSource = isRecord(value.headerFooter) ? value.headerFooter : {};
  return {
    version: RECIPE_VERSION,
    id: optionalString(value.id, 'id') ?? crypto.randomUUID(),
    name: optionalString(value.name, 'name') ?? 'recipe',
    createdAt: optionalNumber(value.createdAt, 'createdAt') ?? now,
    updatedAt: optionalNumber(value.updatedAt, 'updatedAt') ?? now,
    textBoxes: Array.isArray(value.textBoxes)
      ? value.textBoxes.map((box, index) => parseTextBox(box, `textBoxes[${index}]`))
      : [],
    headerFooter: {
      header: mergeDefaults(DEFAULT_HEADER_FOOTER.header, headerFooterSource.header),
      footer: mergeDefaults(DEFAULT_HEADER_FOOTER.footer, headerFooterSource.footer),
    },
    pageNumbering: mergeDefaults(DEFAULT_PAGE_NUMBERING, value.pageNumbering),
    imageExportOptions: mergeDefaults(DEFAULT_IMAGE_EXPORT_OPTIONS, value.imageExportOptions),
    graphics: Array.isArray(value.graphics)
      ? value.graphics.map((graphic, index) => parseGraphic(graphic, `graphics[${index}]`))
      : [],
    watermark: mergeDefaults(DEFAULT_WATERMARK, value.watermark),
    contentRules: Array.isArray(value.contentRules)
      ? value.contentRules.map((rule, index) => parseContentRule(rule, `contentRules[${index}]`))
      : [],
  };
}

export function isRecipe(value: unknown): value is PdfEditRecipe {
  try {
    parseRecipe(value);
    return true;
  } catch {
    return false;
  }
}
