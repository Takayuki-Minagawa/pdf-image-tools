import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
} from '../types/pdfEdit';
import { resolvePlaceholders, formatPageNumber, wrapTextByWidth } from './pdfEditOperations';

/**
 * プレビュー用オーバーレイ描画の共有コンテキスト。
 * 座標はキャンバスピクセル基準（ページpt × scale）。
 */
export interface OverlayContext {
  ctx: CanvasRenderingContext2D;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
}

export function drawTextBoxesOverlay(
  overlay: OverlayContext,
  textBoxes: TextBoxConfig[],
  currentPageIndex: number,
  activeTextBoxId: string | null,
) {
  const { ctx, scale } = overlay;

  for (const box of textBoxes) {
    if (box.pageIndex !== -1 && box.pageIndex !== currentPageIndex) continue;

    const x = box.x * scale;
    const y = box.y * scale;
    const width = box.width * scale;
    const height = box.height * scale;

    if (box.backgroundColor !== 'transparent' && box.backgroundColor !== '') {
      ctx.fillStyle = box.backgroundColor;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }

    if (box.borderStyle !== 'none' && box.borderWidth > 0) {
      ctx.strokeStyle = box.borderColor;
      ctx.lineWidth = box.borderWidth * scale;
      if (box.borderStyle === 'dashed') ctx.setLineDash([5 * scale, 5 * scale]);
      else if (box.borderStyle === 'dotted') ctx.setLineDash([2 * scale, 2 * scale]);
      else ctx.setLineDash([]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    }

    if (box.id === activeTextBoxId) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
      ctx.setLineDash([]);
    }

    if (box.text) {
      ctx.fillStyle = box.fontColor;
      ctx.font = `${box.fontSize * scale}px sans-serif`;
      ctx.textBaseline = 'top';
      const padding = 4 * scale;
      const maxTextWidth = width - padding * 2;
      const lines = wrapTextByWidth(
        box.text,
        (text) => ctx.measureText(text).width,
        maxTextWidth,
      );
      const lineHeight = box.fontSize * 1.3 * scale;

      for (let index = 0; index < lines.length; index++) {
        const textY = y + padding + index * lineHeight;
        if (textY + lineHeight > y + height) break;
        ctx.fillText(lines[index], x + padding, textY);
      }
    }
  }
}

export function drawHeaderFooterOverlay(
  overlay: OverlayContext,
  settings: HeaderFooterSettings,
  currentPage: number,
  totalPages: number,
  fileName: string,
) {
  const { ctx, scale, canvasWidth, canvasHeight } = overlay;

  const resolve = (text: string) =>
    resolvePlaceholders(text, currentPage, totalPages, fileName);

  const drawSection = (
    config: HeaderFooterSettings['header'],
    baseline: 'top' | 'bottom',
    y: number,
  ) => {
    ctx.fillStyle = config.fontColor;
    ctx.font = `${config.fontSize * scale}px sans-serif`;
    ctx.textBaseline = baseline;

    if (config.left) {
      ctx.textAlign = 'left';
      ctx.fillText(resolve(config.left), config.marginHorizontal * scale, y);
    }
    if (config.center) {
      ctx.textAlign = 'center';
      ctx.fillText(resolve(config.center), canvasWidth / 2, y);
    }
    if (config.right) {
      ctx.textAlign = 'right';
      ctx.fillText(resolve(config.right), canvasWidth - config.marginHorizontal * scale, y);
    }
    ctx.textAlign = 'left';
  };

  if (settings.header.enabled) {
    drawSection(settings.header, 'top', settings.header.margin * scale);
  }

  if (settings.footer.enabled) {
    drawSection(settings.footer, 'bottom', canvasHeight - settings.footer.margin * scale);
  }
}

export function drawPageNumberOverlay(
  overlay: OverlayContext,
  config: PageNumberingConfig,
  currentPage: number,
) {
  if (!config.enabled || currentPage < config.startPage) return;

  const { ctx, scale, canvasWidth, canvasHeight } = overlay;

  const displayNumber = config.startNumber + (currentPage - config.startPage);
  const text = formatPageNumber(displayNumber, config.format, config.prefix, config.suffix);

  ctx.fillStyle = config.fontColor;
  ctx.font = `${config.fontSize * scale}px sans-serif`;

  let x: number;
  if (config.position.includes('left')) {
    ctx.textAlign = 'left';
    x = config.margin * scale;
  } else if (config.position.includes('right')) {
    ctx.textAlign = 'right';
    x = canvasWidth - config.margin * scale;
  } else {
    ctx.textAlign = 'center';
    x = canvasWidth / 2;
  }

  let y: number;
  if (config.position.startsWith('top')) {
    ctx.textBaseline = 'top';
    y = config.margin * scale;
  } else {
    ctx.textBaseline = 'bottom';
    y = canvasHeight - config.margin * scale;
  }

  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
