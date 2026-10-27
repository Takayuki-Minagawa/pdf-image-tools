/** Real Canvas primitives are needed for PDF.js raster verification as well as inspection. */
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
const globals = globalThis as Record<string, unknown>;
for (const [name, value] of Object.entries({ DOMMatrix, ImageData, Path2D })) {
  if (typeof globals[name] === 'undefined') globals[name] = value;
}
