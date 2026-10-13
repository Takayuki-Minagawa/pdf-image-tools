import { describe, expect, it } from 'vitest';
import type { ContentEdit, RecognizedItem, RecognizedPathItem, RecognizedTextItem } from '../types/contentEdit';
import type { ContentRule } from '../types/recipe';
import { contentEditToRule, describeContentRule, expandPageSelector, resolveContentRules } from './contentRules';

function text(id: string, pageIndex: number, value: string, x = 40, y = 100): RecognizedTextItem {
  return { id, kind: 'text', pageIndex, text: value, x, y, width: value.length * 6, height: 12, fontSize: 12 };
}

function rect(id: string, pageIndex: number, x0: number, y0: number, size: number, overrides: Partial<RecognizedPathItem> = {}): RecognizedPathItem {
  return {
    id,
    kind: 'path',
    pageIndex,
    shape: 'rectangle',
    points: [{ x: x0, y: y0 }, { x: x0, y: y0 + size }, { x: x0 + size, y: y0 + size }, { x: x0 + size, y: y0 }],
    closed: true,
    stroked: true,
    filled: false,
    strokeColor: '#0000ff',
    fillColor: '#000000',
    lineWidth: 2,
    bbox: { x0: x0 - 1, y0: y0 - 1, x1: x0 + size + 1, y1: y0 + size + 1 },
    ...overrides,
  };
}

const PAGES: RecognizedItem[][] = [
  [
    text('p0-text-0', 0, 'BUILDING-NAME'),
    text('p0-text-1', 0, 'ROOM-101'),
    text('p0-text-2', 0, 'Confidential draft'),
    rect('p0-path-0', 0, 60, 300, 60),
    rect('p0-path-1', 0, 220, 300, 40, { stroked: false, filled: true, fillColor: '#ff0000', lineWidth: 0 }),
  ],
  [
    text('p1-text-0', 1, 'BUILDING-NAME'),
    text('p1-text-1', 1, 'ROOM-202'),
    rect('p1-path-0', 1, 60, 300, 60),
  ],
];

async function resolve(rules: ContentRule[]) {
  const read: number[] = [];
  const result = await resolveContentRules(rules, PAGES.length, async (pageIndex) => {
    read.push(pageIndex);
    return PAGES[pageIndex];
  });
  return { ...result, read };
}

describe('expandPageSelector', () => {
  it('expands all, dedupes and drops out-of-range pages', () => {
    expect(expandPageSelector(undefined, 3)).toEqual([0, 1, 2]);
    expect(expandPageSelector('all', 2)).toEqual([0, 1]);
    expect(expandPageSelector([3, 1, 1, 9, 0], 3)).toEqual([0, 2]);
  });
});

describe('resolveContentRules', () => {
  it('matches exact text on every page and marks redaction', async () => {
    const { edits, matchCounts, unmatched } = await resolve([
      { kind: 'text', match: { text: 'BUILDING-NAME' }, action: 'redact' },
    ]);
    expect(matchCounts).toEqual([2]);
    expect(unmatched).toEqual([]);
    expect(edits.map((edit) => [edit.target.id, edit.action])).toEqual([
      ['p0-text-0', 'redact'],
      ['p1-text-0', 'redact'],
    ]);
  });

  it('replaces only the matched part in contains / regex mode and respects pages and case', async () => {
    const { edits } = await resolve([
      { kind: 'text', match: { text: 'room-(\\d+)', mode: 'regex', caseSensitive: false, pages: [1] }, action: 'replace', newText: 'UNIT-$1', fontColor: '#1d4ed8', fontSize: 14 },
      { kind: 'text', match: { text: 'draft', mode: 'contains' }, action: 'replace', newText: 'FINAL' },
    ]);
    const byId = new Map(edits.map((edit) => [edit.target.id, edit]));
    const room = byId.get('p0-text-1');
    expect(room?.kind === 'text' && room.newText).toBe('UNIT-101');
    expect(room?.kind === 'text' && room.fontColor).toBe('#1d4ed8');
    expect(room?.kind === 'text' && room.fontSize).toBe(14);
    expect(byId.has('p1-text-1')).toBe(false);
    const draft = byId.get('p0-text-2');
    expect(draft?.kind === 'text' && draft.newText).toBe('Confidential FINAL');
  });

  it('stops after the first match when occurrence is first', async () => {
    const { edits, matchCounts } = await resolve([
      { kind: 'text', match: { text: 'BUILDING-NAME', occurrence: 'first' }, action: 'delete' },
    ]);
    expect(matchCounts).toEqual([1]);
    expect(edits.map((edit) => edit.target.id)).toEqual(['p0-text-0']);
  });

  it('matches paths by id, shape, stroke/fill and bounding box', async () => {
    const { edits, matchCounts } = await resolve([
      { kind: 'path', match: { shape: 'rectangle', stroked: true, strokeColor: '#0000ff' }, action: 'restyle', strokeColor: '#9333ea', lineWidth: 4 },
      { kind: 'path', match: { id: 'p0-path-1', filled: true }, action: 'restyle', fillColor: '#f59e0b' },
      { kind: 'path', match: { within: { x0: 50, y0: 290, x1: 190, y1: 370 }, pages: [2] }, action: 'delete' },
    ]);
    expect(matchCounts).toEqual([2, 1, 1]);
    const byId = new Map(edits.map((edit) => [edit.target.id, edit]));
    const restyled = byId.get('p0-path-0');
    expect(restyled?.kind === 'path' && restyled.strokeColor).toBe('#9333ea');
    expect(restyled?.kind === 'path' && restyled.lineWidth).toBe(4);
    const filled = byId.get('p0-path-1');
    expect(filled?.kind === 'path' && filled.fillColor).toBe('#f59e0b');
    // The later rule wins for the same element on page 2.
    expect(byId.get('p1-path-0')?.action).toBe('delete');
  });

  it('reports unmatched rules and reads each page only once', async () => {
    const { unmatched, read } = await resolve([
      { kind: 'text', match: { text: 'NOT-PRESENT' }, action: 'delete' },
      { kind: 'path', match: { shape: 'polygon' }, action: 'delete' },
    ]);
    expect(unmatched).toHaveLength(2);
    expect(read).toEqual([0, 1]);
  });
});

describe('contentEditToRule', () => {
  it('converts text and path edits into document-independent rules', () => {
    const textEdit: ContentEdit = {
      kind: 'text', target: text('p2-text-3', 2, 'ROOM-101'), action: 'replace',
      newText: 'ROOM-102', fontSize: 11, fontColor: '#111111', coverColor: '#ffffff',
    };
    expect(contentEditToRule(textEdit)).toEqual({
      kind: 'text',
      match: { text: 'ROOM-101', mode: 'exact', pages: [3] },
      action: 'replace',
      newText: 'ROOM-102',
      fontSize: 11,
      fontColor: '#111111',
      coverColor: '#ffffff',
    });

    const pathEdit: ContentEdit = {
      kind: 'path', target: rect('p0-path-0', 0, 60, 300, 60), action: 'delete',
      strokeColor: '#000000', lineWidth: 1, fillColor: '#000000', coverColor: '#ffffff',
    };
    const rule = contentEditToRule(pathEdit);
    expect(rule.kind).toBe('path');
    expect(rule.match).toMatchObject({ pages: [1], shape: 'rectangle', stroked: true, filled: false, within: { x0: 59, y0: 299, x1: 121, y1: 361 } });
    expect(describeContentRule(rule)).toBe('P.1 rectangleを削除');
  });
});
