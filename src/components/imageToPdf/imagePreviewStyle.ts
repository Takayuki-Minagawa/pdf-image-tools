import type { CSSProperties } from 'react';
import type { ImageAdjustments } from '../../utils/imagesToPdf';

/** 画像補正（回転・白黒・コントラスト・トリミング）をCSSでプレビューする。 */
export function imagePreviewStyle(adjustments: ImageAdjustments): CSSProperties {
  return {
    transform: `rotate(${adjustments.rotation}deg)`,
    filter: `grayscale(${adjustments.grayscale ? 1 : 0}) contrast(${adjustments.contrast})`,
    clipPath: `inset(${adjustments.crop.top}% ${adjustments.crop.right}% ${adjustments.crop.bottom}% ${adjustments.crop.left}%)`,
  };
}
