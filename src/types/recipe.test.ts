import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE_NUMBERING } from './pdfEdit';
import { DEFAULT_WATERMARK } from './pdfGraphics';
import { RECIPE_VERSION, RecipeValidationError, isRecipe, parseContentRule, parseRecipe } from './recipe';

describe('parseRecipe', () => {
  it('migrates a version 1 recipe and fills the new sections with defaults', () => {
    const recipe = parseRecipe({
      version: 1,
      id: 'legacy',
      name: '請求書',
      createdAt: 1,
      updatedAt: 2,
      textBoxes: [{ id: 't1', text: 'hello', x: 1, y: 2, width: 100, height: 40, fontSize: 10, fontColor: '#111111', backgroundColor: 'transparent', borderStyle: 'none', borderWidth: 0, borderColor: '#000000', pageIndex: 0 }],
      headerFooter: { header: { ...DEFAULT_HEADER_FOOTER.header, enabled: true, left: 'L' }, footer: DEFAULT_HEADER_FOOTER.footer },
      pageNumbering: { ...DEFAULT_PAGE_NUMBERING, enabled: true },
      imageExportOptions: { filename: 'x', format: 'png', scale: 2, quality: 0.9, pageMode: 'all', rangeStart: 1, rangeEnd: 1, zip: true },
    });
    expect(recipe.version).toBe(RECIPE_VERSION);
    expect(recipe.id).toBe('legacy');
    expect(recipe.textBoxes).toHaveLength(1);
    expect(recipe.headerFooter.header.left).toBe('L');
    expect(recipe.pageNumbering.enabled).toBe(true);
    expect(recipe.graphics).toEqual([]);
    expect(recipe.watermark).toEqual(DEFAULT_WATERMARK);
    expect(recipe.contentRules).toEqual([]);
  });

  it('accepts a hand-written minimal version 2 recipe and generates ids', () => {
    const recipe = parseRecipe({
      version: 2,
      graphics: [{ kind: 'rectangle', pageIndex: 0, x: 10, y: 20, width: 100, height: 50 }],
      watermark: { enabled: true, text: 'DRAFT' },
      contentRules: [{ kind: 'text', match: { text: 'A' }, action: 'delete' }],
    });
    expect(recipe.name).toBe('recipe');
    expect(recipe.id).toMatch(/[0-9a-f-]{36}/);
    expect(recipe.graphics[0]).toMatchObject({ kind: 'rectangle', color: '#2563eb', fillColor: 'transparent', lineWidth: 2, opacity: 1 });
    expect(recipe.watermark).toMatchObject({ enabled: true, text: 'DRAFT', fontSize: DEFAULT_WATERMARK.fontSize });
    expect(recipe.headerFooter).toEqual(DEFAULT_HEADER_FOOTER);
  });

  it('rejects values that are not recipes', () => {
    expect(() => parseRecipe(null)).toThrow(RecipeValidationError);
    expect(() => parseRecipe({ version: 3 })).toThrow(/version/);
    expect(() => parseRecipe({ version: 2, graphics: [{ kind: 'image', pageIndex: 0 }] })).toThrow(/imageDataUrl/);
    expect(() => parseRecipe({ version: 2, graphics: [{ kind: 'triangle' }] })).toThrow(/graphics\[0\]\.kind/);
    expect(() => parseRecipe({ version: 2, textBoxes: [{ fontColor: 'red' }] })).toThrow(/fontColor/);
    expect(isRecipe({ version: 2 })).toBe(true);
    expect(isRecipe({ version: 2, contentRules: [{ kind: 'text' }] })).toBe(false);
  });
});

describe('parseContentRule', () => {
  it('validates text rules', () => {
    expect(parseContentRule({ kind: 'text', match: { text: 'x', mode: 'contains', pages: [1, 2] }, action: 'replace', newText: 'y' }))
      .toMatchObject({ kind: 'text', match: { text: 'x', mode: 'contains', pages: [1, 2] }, action: 'replace', newText: 'y' });
    expect(() => parseContentRule({ kind: 'text', match: {}, action: 'delete' })).toThrow(/id または text/);
    expect(() => parseContentRule({ kind: 'text', match: { text: 'x' }, action: 'replace' })).toThrow(/newText/);
    expect(() => parseContentRule({ kind: 'text', match: { text: '(', mode: 'regex' }, action: 'delete' })).toThrow(/正規表現/);
    expect(() => parseContentRule({ kind: 'text', match: { text: 'x', pages: [0] }, action: 'delete' })).toThrow(/pages/);
    expect(() => parseContentRule({ kind: 'text', match: { text: 'x' }, action: 'explode' })).toThrow(/action/);
  });

  it('validates path rules and normalizes the within box', () => {
    const rule = parseContentRule({
      kind: 'path',
      match: { shape: ['line', 'rectangle'], within: { x0: 100, y0: 50, x1: 10, y1: 5 }, stroked: true },
      action: 'restyle',
      strokeColor: '#ff0000',
      lineWidth: 2,
    });
    expect(rule).toMatchObject({ kind: 'path', match: { shape: ['line', 'rectangle'], within: { x0: 10, y0: 5, x1: 100, y1: 50 }, stroked: true } });
    expect(() => parseContentRule({ kind: 'path', match: { shape: 'circle' }, action: 'delete' })).toThrow(/shape/);
    expect(() => parseContentRule({ kind: 'path', match: { within: { x0: 1 } }, action: 'delete' })).toThrow(/within/);
    expect(() => parseContentRule({ kind: 'shape', match: {}, action: 'delete' })).toThrow(/kind/);
  });
});
