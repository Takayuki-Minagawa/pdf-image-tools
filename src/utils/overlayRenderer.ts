import type {
  TextBoxConfig,
  HeaderFooterSettings,
  PageNumberingConfig,
} from '../types/pdfEdit';
import type { ContentEdit, PagePoint, RecognizedItem } from '../types/contentEdit';
import { resolvePlaceholders, formatPageNumber, wrapTextByWidth } from './pdfEditOperations';
import { getItemBBox } from './contentRecognition';
import {
  PATH_ERASE_EXTRA_WIDTH,
  TEXT_COVER_ASCENT_RATIO,
  TEXT_COVER_DESCENT_RATIO,
} from './contentEditOperations';

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

/** ページ空間（左下原点・pt）の点をキャンバス座標へ変換する */
function toCanvasPoint(overlay: OverlayContext, point: PagePoint) {
  return {
    x: point.x * overlay.scale,
    y: overlay.canvasHeight - point.y * overlay.scale,
  };
}

function tracePath(
  overlay: OverlayContext,
  points: PagePoint[],
  closed: boolean,
) {
  const { ctx } = overlay;
  ctx.beginPath();
  points.forEach((point, index) => {
    const { x, y } = toCanvasPoint(overlay, point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed) ctx.closePath();
}

/**
 * 認識済み要素の輪郭を表示する（コンテンツ編集タブ用）。
 * 選択中の要素は強調表示する。
 */
export function drawRecognizedItemsOverlay(
  overlay: OverlayContext,
  items: RecognizedItem[],
  selectedId: string | null,
) {
  const { ctx, scale } = overlay;

  for (const item of items) {
    const bbox = getItemBBox(item);
    const isSelected = item.id === selectedId;

    const x = bbox.x0 * scale;
    const y = overlay.canvasHeight - bbox.y1 * scale;
    const width = (bbox.x1 - bbox.x0) * scale;
    const height = (bbox.y1 - bbox.y0) * scale;

    ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(59, 130, 246, 0.45)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.setLineDash(isSelected ? [] : [3, 3]);
    ctx.strokeRect(x - 1, y - 1, width + 2, height + 2);
    ctx.setLineDash([]);

    if (isSelected) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    }
  }
}

/**
 * コンテンツ編集（カバー + 再描画）の結果をプレビューする。
 * 保存時の applyContentEdits と同じ見た目になるように描く。
 */
export function drawContentEditsOverlay(overlay: OverlayContext, edits: ContentEdit[]) {
  const { ctx, scale } = overlay;

  for (const edit of edits) {
    if (edit.kind === 'text') {
      const target = edit.target;
      const pad = 1 * scale;
      const x = target.x * scale - pad;
      const top =
        overlay.canvasHeight -
        (target.y + target.fontSize * TEXT_COVER_ASCENT_RATIO) * scale -
        pad;
      const width = target.width * scale + pad * 2;
      const height =
        target.fontSize * (TEXT_COVER_DESCENT_RATIO + TEXT_COVER_ASCENT_RATIO) * scale +
        pad * 2;

      ctx.fillStyle = edit.coverColor;
      ctx.fillRect(x, top, width, height);

      if (edit.action === 'replace' && edit.newText) {
        ctx.fillStyle = edit.fontColor;
        ctx.font = `${edit.fontSize * scale}px sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        const lineHeight = edit.fontSize * 1.2 * scale;
        const base = toCanvasPoint(overlay, { x: target.x, y: target.y });
        edit.newText.split('\n').forEach((line, index) => {
          ctx.fillText(line, base.x, base.y + index * lineHeight);
        });
        ctx.textBaseline = 'top';
      }
    } else {
      const target = edit.target;

      // 消去パス: 元の図形をカバー色でなぞる
      tracePath(overlay, target.points, target.closed);
      ctx.strokeStyle = edit.coverColor;
      ctx.lineWidth = (Math.max(target.lineWidth, 0.5) + PATH_ERASE_EXTRA_WIDTH) * scale;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (target.filled && target.closed) {
        ctx.fillStyle = edit.coverColor;
        ctx.fill();
      }

      if (edit.action === 'restyle') {
        tracePath(overlay, target.points, target.closed);
        if (target.filled && target.closed) {
          ctx.fillStyle = edit.fillColor;
          ctx.fill();
        }
        if (target.stroked) {
          ctx.strokeStyle = edit.strokeColor;
          ctx.lineWidth = Math.max(edit.lineWidth, 0.1) * scale;
          ctx.stroke();
        }
      }
    }
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
