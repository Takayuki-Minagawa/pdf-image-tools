import fontkit, { type Font } from '@pdf-lib/fontkit';

// The bundled fontkit supports variable instances but omits them from its types.
interface VariableFont extends Font {
  variationAxes?: Record<string, { min: number; default: number; max: number }>;
  getVariation?: (settings: Record<string, number>) => Font;
}

/**
 * Instantiate the bundled variable Noto Sans JP before PDF subsetting. Directly
 * subsetting its default face produces corrupt glyf/loca offsets in fontkit;
 * ToUnicode still extracts correctly while PDF readers omit visible glyphs.
 * A regular-weight instance rebuilds the outlines and matches the browser font.
 */
export const pdfFontkit = {
  create(bytes: Uint8Array, postscriptName?: string): Font {
    const font = fontkit.create(bytes, postscriptName) as VariableFont;
    return font.variationAxes?.wght && font.getVariation
      ? font.getVariation({ wght: 400 })
      : font;
  },
};
