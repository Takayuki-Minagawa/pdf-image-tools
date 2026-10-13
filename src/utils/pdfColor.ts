import { rgb, type RGB } from 'pdf-lib';

const HEX6 = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;
const HEX3 = /^#?([\da-f])([\da-f])([\da-f])$/i;

/** #rrggbb / #rgb を pdf-lib の RGB に変換する。解釈できない値は黒。 */
export function toRgb(hex: string): RGB {
  const full = HEX6.exec(hex);
  if (full) {
    return rgb(parseInt(full[1], 16) / 255, parseInt(full[2], 16) / 255, parseInt(full[3], 16) / 255);
  }
  const short = HEX3.exec(hex);
  if (short) {
    return rgb(parseInt(short[1] + short[1], 16) / 255, parseInt(short[2] + short[2], 16) / 255, parseInt(short[3] + short[3], 16) / 255);
  }
  return rgb(0, 0, 0);
}

/** 'transparent' / 空文字は塗りなしとして undefined を返す。 */
export function toOptionalRgb(hex: string | undefined): RGB | undefined {
  if (!hex || hex === 'transparent') return undefined;
  return toRgb(hex);
}

export function clampOpacity(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
