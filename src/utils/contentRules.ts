/**
 * 文書に依存しない「コンテンツ編集ルール」を、実際に認識した要素への編集（ContentEdit）へ解決する。
 *
 * ルールはレシピ・CLI・バッチ処理で共有され、文字列一致 / 要素ID / 形状・位置で
 * 既存のテキスト・ベクターパスを指定する。
 */
import type {
  ContentEdit,
  PathContentEdit,
  RecognizedItem,
  RecognizedPathItem,
  RecognizedTextItem,
  TextContentEdit,
} from '../types/contentEdit';
import { createPathEdit, createTextEdit, normalizeHexColor } from '../types/contentEdit';
import type { ContentRule, PageSelector, PathContentRule, TextContentRule } from '../types/recipe';

export interface ResolvedContentRules {
  edits: ContentEdit[];
  /** ルールごとの一致件数（rules と同じ順） */
  matchCounts: number[];
  /** 1件も一致しなかったルール */
  unmatched: ContentRule[];
}

export type PageReader = (pageIndex: number) => Promise<RecognizedItem[]>;

/** PageSelector（1始まり）を 0 始まりのページインデックス配列へ展開する。範囲外は無視。 */
export function expandPageSelector(selector: PageSelector | undefined, pageCount: number): number[] {
  if (!selector || selector === 'all') return Array.from({ length: pageCount }, (_, index) => index);
  const indices = selector
    .map((page) => page - 1)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount);
  return [...new Set(indices)].sort((a, b) => a - b);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTextPattern(rule: TextContentRule): RegExp | null {
  const { text, mode = 'exact', caseSensitive = true } = rule.match;
  if (text === undefined) return null;
  const flags = caseSensitive ? 'g' : 'gi';
  if (mode === 'regex') return new RegExp(text, flags);
  const source = escapeRegExp(text);
  return new RegExp(mode === 'exact' ? `^${source}$` : source, flags);
}

function matchesText(item: RecognizedTextItem, rule: TextContentRule, pattern: RegExp | null): boolean {
  if (rule.match.id !== undefined && item.id !== rule.match.id) return false;
  if (!pattern) return true;
  pattern.lastIndex = 0;
  return pattern.test(item.text);
}

function replacementText(item: RecognizedTextItem, rule: TextContentRule, pattern: RegExp | null): string {
  const newText = rule.newText ?? '';
  if (!pattern || (rule.match.mode ?? 'exact') === 'exact') return newText;
  pattern.lastIndex = 0;
  return item.text.replace(pattern, newText);
}

function resolveTextRule(item: RecognizedTextItem, rule: TextContentRule, pattern: RegExp | null): TextContentEdit {
  const edit = createTextEdit(item);
  edit.action = rule.action;
  edit.newText = rule.action === 'replace' ? replacementText(item, rule, pattern) : '';
  if (rule.fontSize !== undefined && rule.fontSize > 0) edit.fontSize = rule.fontSize;
  if (rule.fontColor) edit.fontColor = normalizeHexColor(rule.fontColor, edit.fontColor);
  if (rule.coverColor) edit.coverColor = normalizeHexColor(rule.coverColor, edit.coverColor);
  return edit;
}

function matchesPath(item: RecognizedPathItem, rule: PathContentRule): boolean {
  const match = rule.match;
  if (match.id !== undefined && item.id !== match.id) return false;
  if (match.shape !== undefined) {
    const shapes = Array.isArray(match.shape) ? match.shape : [match.shape];
    if (!shapes.includes(item.shape)) return false;
  }
  if (match.stroked !== undefined && item.stroked !== match.stroked) return false;
  if (match.filled !== undefined && item.filled !== match.filled) return false;
  if (match.strokeColor !== undefined &&
      normalizeHexColor(item.strokeColor, '').toLowerCase() !== match.strokeColor.toLowerCase()) return false;
  if (match.fillColor !== undefined &&
      normalizeHexColor(item.fillColor, '').toLowerCase() !== match.fillColor.toLowerCase()) return false;
  if (match.within) {
    const tolerance = match.tolerance ?? 1;
    const { bbox } = item;
    if (
      bbox.x0 < match.within.x0 - tolerance ||
      bbox.y0 < match.within.y0 - tolerance ||
      bbox.x1 > match.within.x1 + tolerance ||
      bbox.y1 > match.within.y1 + tolerance
    ) return false;
  }
  return true;
}

function resolvePathRule(item: RecognizedPathItem, rule: PathContentRule): PathContentEdit {
  const edit = createPathEdit(item);
  edit.action = rule.action;
  if (rule.strokeColor) edit.strokeColor = normalizeHexColor(rule.strokeColor, edit.strokeColor);
  if (rule.fillColor) edit.fillColor = normalizeHexColor(rule.fillColor, edit.fillColor);
  if (rule.coverColor) edit.coverColor = normalizeHexColor(rule.coverColor, edit.coverColor);
  if (rule.lineWidth !== undefined && rule.lineWidth > 0) edit.lineWidth = rule.lineWidth;
  return edit;
}

/**
 * ルールを認識結果へ解決する。同じ要素に複数のルールが一致した場合は後のルールが優先される。
 * readPage は元PDFのページインデックス（0始まり）を受け取り、認識済み要素を返す。
 */
export async function resolveContentRules(
  rules: ContentRule[],
  pageCount: number,
  readPage: PageReader,
): Promise<ResolvedContentRules> {
  const cache = new Map<number, Promise<RecognizedItem[]>>();
  const read = (pageIndex: number) => {
    let pending = cache.get(pageIndex);
    if (!pending) {
      pending = readPage(pageIndex);
      cache.set(pageIndex, pending);
    }
    return pending;
  };

  const editsByTarget = new Map<string, ContentEdit>();
  const matchCounts: number[] = [];
  const unmatched: ContentRule[] = [];

  for (const rule of rules) {
    let count = 0;
    const first = rule.match.occurrence === 'first';
    const pattern = rule.kind === 'text' ? buildTextPattern(rule) : null;

    pages: for (const pageIndex of expandPageSelector(rule.match.pages, pageCount)) {
      for (const item of await read(pageIndex)) {
        let edit: ContentEdit | null = null;
        if (rule.kind === 'text' && item.kind === 'text' && matchesText(item, rule, pattern)) {
          edit = resolveTextRule(item, rule, pattern);
        } else if (rule.kind === 'path' && item.kind === 'path' && matchesPath(item, rule)) {
          edit = resolvePathRule(item, rule);
        }
        if (!edit) continue;
        editsByTarget.set(`${pageIndex}:${item.id}`, edit);
        count++;
        if (first) break pages;
      }
    }

    matchCounts.push(count);
    if (count === 0) unmatched.push(rule);
  }

  return { edits: [...editsByTarget.values()], matchCounts, unmatched };
}

/**
 * 編集画面で作成した ContentEdit を、他の文書にも適用できるルールへ変換する。
 * テキストは文字列の完全一致、図形は形状・線/塗り・位置（bbox）で指定する。
 */
export function contentEditToRule(edit: ContentEdit): ContentRule {
  const pages: PageSelector = [edit.target.pageIndex + 1];
  if (edit.kind === 'text') {
    return {
      kind: 'text',
      match: { text: edit.target.text, mode: 'exact', pages },
      action: edit.action,
      newText: edit.action === 'replace' ? edit.newText : undefined,
      fontSize: edit.fontSize,
      fontColor: edit.fontColor,
      coverColor: edit.coverColor,
    };
  }
  const { bbox } = edit.target;
  return {
    kind: 'path',
    match: {
      pages,
      shape: edit.target.shape,
      stroked: edit.target.stroked,
      filled: edit.target.filled,
      within: {
        x0: Math.round(bbox.x0 * 100) / 100,
        y0: Math.round(bbox.y0 * 100) / 100,
        x1: Math.round(bbox.x1 * 100) / 100,
        y1: Math.round(bbox.y1 * 100) / 100,
      },
      tolerance: 1,
    },
    action: edit.action,
    strokeColor: edit.strokeColor,
    lineWidth: edit.lineWidth,
    fillColor: edit.fillColor,
    coverColor: edit.coverColor,
  };
}

/** ルールを人が読める1行に要約する（UI・CLIのログ用） */
export function describeContentRule(rule: ContentRule): string {
  const pages = !rule.match.pages || rule.match.pages === 'all' ? '全ページ' : `P.${rule.match.pages.join(',')}`;
  if (rule.kind === 'text') {
    const target = rule.match.id ?? `「${rule.match.text ?? ''}」`;
    const action = rule.action === 'replace' ? `→「${rule.newText ?? ''}」` : rule.action === 'redact' ? 'を完全削除' : 'を隠す';
    return `${pages} ${target}${action}`;
  }
  const target = rule.match.id ?? (Array.isArray(rule.match.shape) ? rule.match.shape.join('/') : rule.match.shape ?? '図形');
  return `${pages} ${target}${rule.action === 'delete' ? 'を削除' : 'のスタイル変更'}`;
}
