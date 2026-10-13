/**
 * CLI コマンドの本体。ファイル入出力は main.ts が担当し、ここはバイト列と設定だけを扱う
 * （ブラウザ版と同じユーティリティを共有し、vitest から直接テストできる）。
 */
import { PDFDocument } from 'pdf-lib';
import type { TextBoxConfig } from '../types/pdfEdit';
import type { PdfEditRecipe, RecipeGraphic } from '../types/recipe';
import { createDefaultTextBox } from '../types/pdfEdit';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from '../types/pdfEdit';
import { applyPdfEdits } from '../utils/pdfEditOperations';
import { applyRecipeToPdf, type ApplyRecipeResult } from '../utils/recipeApply';
import { inspectPdf, type PdfInspection } from '../utils/pdfInspection';
import { buildPdfFromPagePlan, extractPdfPageIndices } from '../utils/pdfEditor';

/** `1-3,5,8` 形式（1始まり）を 0 始まりのページインデックス配列へ変換する。 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const result: number[] = [];
  for (const part of spec.split(',').map((value) => value.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new Error(`ページ指定が不正です: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`ページ範囲 ${part} は 1〜${pageCount} の外です`);
    }
    for (let page = start; page <= end; page++) result.push(page - 1);
  }
  if (result.length === 0) throw new Error('ページを1つ以上指定してください');
  return result;
}

/** `--key value` / `--flag` 形式の引数を解析する。位置引数は positional に入る。 */
export function parseArgs(args: string[]): { positional: string[]; options: Record<string, string | true> } {
  const positional: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const equals = body.indexOf('=');
      if (equals !== -1) {
        options[body.slice(0, equals)] = body.slice(equals + 1);
      } else if (index + 1 < args.length && !args[index + 1].startsWith('--')) {
        options[body] = args[++index];
      } else {
        options[body] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function numberOption(options: Record<string, string | true>, key: string, fallback: number): number {
  const value = options[key];
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} には数値を指定してください`);
  return parsed;
}

function stringOption(options: Record<string, string | true>, key: string, fallback: string): string {
  const value = options[key];
  return value === undefined || value === true ? fallback : value;
}

export async function mergePdfs(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (inputs.length < 2) throw new Error('merge には入力PDFが2つ以上必要です');
  const target = await PDFDocument.create();
  for (const input of inputs) {
    const source = await PDFDocument.load(input);
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
  return target.save();
}

export async function extractPages(input: Uint8Array, spec: string): Promise<Uint8Array> {
  const pageCount = (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
  return extractPdfPageIndices(input, parsePageSpec(spec, pageCount));
}

/** 指定した順序でページを並べ替える（同じページを複数回指定すると複製される）。 */
export async function reorderPages(input: Uint8Array, spec: string): Promise<Uint8Array> {
  const pageCount = (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
  const order = parsePageSpec(spec, pageCount);
  return buildPdfFromPagePlan(input, order.map((sourcePageIndex, index) => ({
    id: `cli-${index}`,
    sourcePageIndex,
    rotation: 0,
  })));
}

export async function rotatePages(input: Uint8Array, spec: string | undefined, degrees: number): Promise<Uint8Array> {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized % 90 !== 0) throw new Error('回転角度は 90 の倍数を指定してください');
  const pageCount = (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
  const targets = new Set(spec ? parsePageSpec(spec, pageCount) : Array.from({ length: pageCount }, (_, index) => index));
  return buildPdfFromPagePlan(input, Array.from({ length: pageCount }, (_, index) => ({
    id: `cli-${index}`,
    sourcePageIndex: index,
    rotation: (targets.has(index) ? normalized : 0) as 0 | 90 | 180 | 270,
  })));
}

export interface AddTextOptions {
  text: string;
  /** 1 始まり。'all' で全ページ */
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  borderStyle: TextBoxConfig['borderStyle'];
  borderWidth: number;
  borderColor: string;
  fileName: string;
}

export function addTextOptionsFromArgs(
  text: string,
  options: Record<string, string | true>,
  fileName: string,
): AddTextOptions {
  const borderStyle = stringOption(options, 'border', 'none');
  if (!['solid', 'dashed', 'dotted', 'none'].includes(borderStyle)) {
    throw new Error('--border には solid / dashed / dotted / none を指定してください');
  }
  const defaults = createDefaultTextBox(0);
  return {
    text,
    page: stringOption(options, 'page', '1'),
    x: numberOption(options, 'x', defaults.x),
    y: numberOption(options, 'y', defaults.y),
    width: numberOption(options, 'width', defaults.width),
    height: numberOption(options, 'height', defaults.height),
    fontSize: numberOption(options, 'size', defaults.fontSize),
    fontColor: stringOption(options, 'color', '#000000'),
    backgroundColor: stringOption(options, 'background', 'transparent'),
    borderStyle: borderStyle as TextBoxConfig['borderStyle'],
    borderWidth: numberOption(options, 'border-width', 1),
    borderColor: stringOption(options, 'border-color', '#000000'),
    fileName,
  };
}

/** テキストボックスを1つ追加する（位置は表示ページ左上基準・pt）。 */
export async function addText(input: Uint8Array, options: AddTextOptions): Promise<Uint8Array> {
  const pageCount = (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
  const pages = options.page === 'all' ? [-1] : parsePageSpec(options.page, pageCount);
  const textBoxes: TextBoxConfig[] = pages.map((pageIndex) => ({
    id: crypto.randomUUID(),
    text: options.text,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    fontSize: options.fontSize,
    fontColor: options.fontColor,
    backgroundColor: options.backgroundColor,
    borderStyle: options.borderStyle,
    borderWidth: options.borderWidth,
    borderColor: options.borderColor,
    pageIndex,
  }));
  return applyPdfEdits(input, {
    textBoxes,
    headerFooter: DEFAULT_HEADER_FOOTER,
    pageNumbering: DEFAULT_PAGE_NUMBERING,
  }, options.fileName);
}

export interface InspectOptions {
  pages?: string;
  /** 'text' | 'paths' | 'all' */
  kinds?: string;
}

export interface InspectOutput {
  file: string;
  pageCount: number;
  coordinateSystem: string;
  pages: PdfInspection['pages'];
}

/** テキスト・ベクター要素を JSON 向けに整形して返す。 */
export async function inspect(input: Uint8Array, fileName: string, options: InspectOptions = {}): Promise<InspectOutput> {
  const pageCount = (await PDFDocument.load(input, { updateMetadata: false })).getPageCount();
  const pageIndices = options.pages ? parsePageSpec(options.pages, pageCount) : undefined;
  const kinds = options.kinds ?? 'all';
  if (!['all', 'text', 'paths'].includes(kinds)) throw new Error('--kinds には all / text / paths を指定してください');
  const inspection = await inspectPdf(input, pageIndices);
  return {
    file: fileName,
    pageCount: inspection.pageCount,
    coordinateSystem: 'PDF user space: origin bottom-left, unit pt, before /Rotate',
    pages: inspection.pages.map((page) => ({
      ...page,
      items: page.items
        .filter((item) => kinds === 'all' || (kinds === 'text' ? item.kind === 'text' : item.kind === 'path'))
        .map((item) => (item.kind === 'text'
          ? { ...item, x: round(item.x), y: round(item.y), width: round(item.width), height: round(item.height), fontSize: round(item.fontSize) }
          : {
            ...item,
            points: item.points.map((point) => ({ x: round(point.x), y: round(point.y) })),
            lineWidth: round(item.lineWidth),
            bbox: { x0: round(item.bbox.x0), y0: round(item.bbox.y0), x1: round(item.bbox.x1), y1: round(item.bbox.y1) },
          })),
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ApplyRecipeCommandOptions {
  fileName: string;
  allowCoverOnly?: boolean;
  resolveImage?: (graphic: RecipeGraphic) => Promise<string>;
}

export async function applyRecipe(
  input: Uint8Array,
  recipe: PdfEditRecipe,
  options: ApplyRecipeCommandOptions,
): Promise<ApplyRecipeResult> {
  return applyRecipeToPdf(input, recipe, options);
}
