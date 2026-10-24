import { describe, expect, it } from 'vitest';
import { DEFAULT_WATERMARK, createDefaultGraphic } from '../types/pdfGraphics';
import type { RecipeGraphic } from '../types/recipe';
import { prepareRecipeGraphicsForEditor } from './recipeEditor';

describe('prepareRecipeGraphicsForEditor', () => {
  it('re-ids graphics and drops out-of-range pages and path-only images', () => {
    const rectangle = { ...createDefaultGraphic('rectangle', 0), id: 'rect' } as RecipeGraphic;
    const outOfRange = { ...createDefaultGraphic('ellipse', 5), id: 'far' } as RecipeGraphic;
    const pathOnly = { ...createDefaultGraphic('image', 0), id: 'logo', imagePath: 'logo.png' } as RecipeGraphic;
    const embedded = {
      ...createDefaultGraphic('image', -1),
      id: 'stamp',
      imageDataUrl: 'data:image/png;base64,AA==',
      imagePath: 'stamp.png',
    } as RecipeGraphic;

    let counter = 0;
    const result = prepareRecipeGraphicsForEditor(
      [rectangle, outOfRange, pathOnly, embedded],
      DEFAULT_WATERMARK,
      2,
      () => `new-${++counter}`,
    );

    expect(result.graphics.map((graphic) => [graphic.id, graphic.kind])).toEqual([
      ['new-1', 'rectangle'],
      ['new-3', 'image'],
    ]);
    expect(result.graphics.some((graphic) => 'imagePath' in graphic)).toBe(false);
    expect(result.skippedImageCount).toBe(1);
    expect(rectangle.id).toBe('rect');
  });

  it('applies an out-of-range watermark to all pages', () => {
    const result = prepareRecipeGraphicsForEditor([], { ...DEFAULT_WATERMARK, pageIndex: 4 }, 3);
    expect(result.watermark.pageIndex).toBe(-1);
    expect(prepareRecipeGraphicsForEditor([], { ...DEFAULT_WATERMARK, pageIndex: 2 }, 3).watermark.pageIndex).toBe(2);
  });
});
