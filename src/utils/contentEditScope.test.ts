import { describe, expect, it } from 'vitest';
import type { ContentEdit } from '../types/contentEdit';
import {
  contentEditsForPage,
  mergeScopedContentEdits,
  scopeContentEditsToPagePlan,
  upsertScopedContentEdit,
} from './contentEditScope';

const edit = (targetId: string, pageEntryId: string | undefined, pageIndex = 0, newText = '') =>
  ({ kind: 'text', pageEntryId, target: { id: targetId, pageIndex }, newText }) as unknown as ContentEdit;

const summary = (edits: ContentEdit[]) =>
  edits.map((item) => `${item.target.id}@${item.pageEntryId}:${'newText' in item ? item.newText : ''}`);

describe('upsertScopedContentEdit', () => {
  it('replaces an edit for the same target and page entry in place', () => {
    const edits = [edit('a', 'p1', 0, 'old'), edit('b', 'p1')];
    expect(summary(upsertScopedContentEdit(edits, edit('a', 'p1', 0, 'new')))).toEqual(['a@p1:new', 'b@p1:']);
  });

  it('keeps edits for the same target on a duplicated page separate', () => {
    expect(summary(upsertScopedContentEdit([edit('a', 'p1')], edit('a', 'p2')))).toEqual(['a@p1:', 'a@p2:']);
  });
});

describe('mergeScopedContentEdits', () => {
  it('drops superseded edits and appends incoming ones', () => {
    const merged = mergeScopedContentEdits(
      [edit('a', 'p1', 0, 'old'), edit('b', 'p1')],
      [edit('a', 'p1', 0, 'new'), edit('c', 'p2')],
    );
    expect(summary(merged)).toEqual(['b@p1:', 'a@p1:new', 'c@p2:']);
  });
});

describe('contentEditsForPage', () => {
  it('matches scoped edits by entry and legacy edits by source page', () => {
    const edits = [edit('a', 'p1', 0), edit('b', 'p2', 0), edit('c', undefined, 0), edit('d', undefined, 1)];
    expect(contentEditsForPage(edits, 'p1', 0).map((item) => item.target.id)).toEqual(['a', 'c']);
  });
});

describe('scopeContentEditsToPagePlan', () => {
  it('assigns the first entry showing the source page', () => {
    const entries = [
      { id: 'second', sourcePageIndex: 1, rotation: 0 as const },
      { id: 'first', sourcePageIndex: 0, rotation: 0 as const },
      { id: 'first-copy', sourcePageIndex: 0, rotation: 0 as const },
    ];
    const scoped = scopeContentEditsToPagePlan([edit('a', undefined, 0), edit('b', undefined, 5)], entries);
    expect(scoped.map((item) => item.pageEntryId)).toEqual(['first', undefined]);
  });
});
