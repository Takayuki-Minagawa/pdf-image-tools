import { describe, expect, it, vi } from 'vitest';
import { createDefaultGraphic, type PdfGraphic } from '../types/pdfGraphics';
import { rotateGraphicsClockwise } from './rotateGraphics';

const pageSizes = new Map([
  [0, { width: 300, height: 500 }],
  [1, { width: 600, height: 400 }],
]);

describe('rotateGraphicsClockwise', () => {
  it.each(['rectangle', 'ellipse', 'highlight'] as const)('rotates the visible %s bounds clockwise', async (kind) => {
    const graphic = { ...createDefaultGraphic(kind, 0), x: 20, y: 70, width: 120, height: 40 };
    const rotateImage = vi.fn(async (source: string) => source);
    const [result] = await rotateGraphicsClockwise([graphic], new Set([0]), pageSizes, 2, rotateImage);
    expect(result).toEqual({ ...graphic, x: 390, y: 20, width: 40, height: 120 });
    expect(rotateImage).not.toHaveBeenCalled();
    expect(graphic).toMatchObject({ x: 20, y: 70, width: 120, height: 40 });
  });

  it.each([
    ['line', 120, 0], ['arrow', -120, -40], ['arrow', 0, 80], ['line', 80, -90],
  ] as const)('preserves the directed endpoints of %s (%i, %i)', async (kind, width, height) => {
    const graphic = { ...createDefaultGraphic(kind, 0), x: 160, y: 130, width, height };
    const [result] = await rotateGraphicsClockwise([graphic], new Set([0]), pageSizes, 2, async (source) => source);
    expect(result.x).toBe(500 - graphic.y);
    expect(result.y).toBe(graphic.x);
    expect(result.x + result.width).toBe(500 - (graphic.y + graphic.height));
    expect(result.y + result.height).toBe(graphic.x + graphic.width);
  });

  it('uses each selected page size and leaves unselected marks untouched', async () => {
    const first = { ...createDefaultGraphic('rectangle', 0), x: 10, y: 20, width: 100, height: 80 };
    const second = { ...createDefaultGraphic('rectangle', 1), x: 10, y: 20, width: 100, height: 80 };
    const results = await rotateGraphicsClockwise([first, second], new Set([1]), pageSizes, 2, async (source) => source);
    expect(results[0]).toBe(first);
    expect(results[1]).toMatchObject({ x: 300, y: 10, width: 80, height: 100 });
  });

  it('expands all-page marks without changing the layer order on either page', async () => {
    const first = { ...createDefaultGraphic('rectangle', 0), label: 'first' };
    const global = { ...createDefaultGraphic('highlight', -1), label: 'global' };
    const second = { ...createDefaultGraphic('ellipse', 1), label: 'second' };
    const top = { ...createDefaultGraphic('rectangle', -1), label: 'top' };
    const results = await rotateGraphicsClockwise([first, global, second, top], new Set([1]), pageSizes, 2, async (source) => source);
    expect(results.filter((graphic) => graphic.pageIndex === 0).map((graphic) => graphic.label)).toEqual(['first', 'global', 'top']);
    expect(results.filter((graphic) => graphic.pageIndex === 1).map((graphic) => graphic.label)).toEqual(['global', 'second', 'top']);
    expect(results.every((graphic) => graphic.pageIndex !== -1)).toBe(true);
    expect(new Set(results.map((graphic) => graphic.id)).size).toBe(results.length);
    expect(results.find((graphic) => graphic.label === 'global' && graphic.pageIndex === 0)).toEqual({ ...global, pageIndex: 0 });
    expect(results.find((graphic) => graphic.label === 'global' && graphic.pageIndex === 1)?.id).not.toBe(global.id);
  });

  it('rotates only selected image instances and memoizes each distinct image source', async () => {
    const shared = { ...createDefaultGraphic('image', -1), imageDataUrl: 'shared-png', width: 180, height: 60 };
    const selectedCopy = { ...createDefaultGraphic('image', 1), imageDataUrl: 'shared-png' };
    const unselected = { ...createDefaultGraphic('image', 0), imageDataUrl: 'unselected-png' };
    const selectedOther = { ...createDefaultGraphic('image', 1), imageDataUrl: 'other-png' };
    const rotateImage = vi.fn(async (source: string) => `${source}-clockwise`);
    const results = await rotateGraphicsClockwise([shared, selectedCopy, unselected, selectedOther], new Set([1]), pageSizes, 2, rotateImage);
    expect(rotateImage.mock.calls).toEqual([['shared-png'], ['other-png']]);
    expect(results.find((graphic) => graphic.id === shared.id)).toMatchObject({ pageIndex: 0, imageDataUrl: 'shared-png', width: 180, height: 60 });
    expect(results.find((graphic) => graphic.pageIndex === 1 && graphic.width === 60)).toMatchObject({ imageDataUrl: 'shared-png-clockwise', width: 60, height: 180 });
    expect(results.find((graphic) => graphic.id === selectedCopy.id)?.imageDataUrl).toBe('shared-png-clockwise');
    expect(results.find((graphic) => graphic.id === unselected.id)).toBe(unselected);
  });

  it('restores vector geometry after four clockwise rotations', async () => {
    const graphics: PdfGraphic[] = [
      { ...createDefaultGraphic('rectangle', 0), x: 20, y: 80, width: 90, height: 40 },
      { ...createDefaultGraphic('arrow', 0), x: 160, y: 130, width: -110, height: -80 },
    ];
    let rotated = graphics;
    for (let turn = 0; turn < 4; turn++) {
      const sizes = new Map([[0, turn % 2 === 0 ? { width: 300, height: 500 } : { width: 500, height: 300 }]]);
      rotated = await rotateGraphicsClockwise(rotated, new Set([0]), sizes, 1, async (source) => source);
    }
    expect(rotated).toEqual(graphics);
  });

  it('does not expand global marks when no existing page is selected', async () => {
    const graphics = [createDefaultGraphic('highlight', -1)];
    const result = await rotateGraphicsClockwise(graphics, new Set([-1, 2, 0.5]), pageSizes, 2, async (source) => source);
    expect(result).toBe(graphics);
  });

  it('rejects missing page geometry or failed image conversion without changing input', async () => {
    const graphic = { ...createDefaultGraphic('image', 0), imageDataUrl: 'original-png' };
    const snapshot = { ...graphic };
    const rotateImage = vi.fn(async () => { throw new Error('Image rotation failed'); });
    await expect(rotateGraphicsClockwise([graphic], new Set([0]), new Map(), 2, rotateImage)).rejects.toThrow('大きさ');
    expect(rotateImage).not.toHaveBeenCalled();
    await expect(rotateGraphicsClockwise([graphic], new Set([0]), pageSizes, 2, rotateImage)).rejects.toThrow('Image rotation failed');
    expect(graphic).toEqual(snapshot);
  });
});
