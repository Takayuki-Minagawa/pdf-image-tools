import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PdfGraphic, WatermarkConfig } from '../../types/pdfGraphics';

interface Props {
  graphics: PdfGraphic[];
  watermark: WatermarkConfig;
  currentPageIndex: number;
  pageSize: { width: number; height: number };
  scale: number;
  interactive: boolean;
  activeGraphicId: string | null;
  onActiveChange: (id: string | null) => void;
  onChange: (graphic: PdfGraphic) => void;
  onDelete: (id: string) => void;
}

interface DragState {
  graphic: PdfGraphic;
  startX: number;
  startY: number;
  resize: boolean;
  pointerId: number;
}

/** Coordinates stay in displayed-page points, independent of browser zoom and PDF rotation. */
export function GraphicsOverlay({ graphics, watermark, currentPageIndex, pageSize, scale, interactive, activeGraphicId, onActiveChange, onChange, onDelete }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<PdfGraphic | null>(null);
  const previewRef = useRef<PdfGraphic | null>(null);
  const visible = graphics.filter((graphic) => graphic.pageIndex === -1 || graphic.pageIndex === currentPageIndex);
  const active = visible.find((graphic) => graphic.id === activeGraphicId);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * pageSize.width / rect.width, y: (event.clientY - rect.top) * pageSize.height / rect.height };
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!interactive || event.button !== 0) return;
    const target = (event.target as Element).closest('[data-graphic-id]');
    const graphic = visible.find((item) => item.id === target?.getAttribute('data-graphic-id'));
    onActiveChange(graphic?.id ?? null);
    if (!graphic) return;
    event.preventDefault();
    svgRef.current?.focus();
    const start = point(event);
    dragRef.current = { graphic, startX: start.x, startY: start.y, resize: target?.getAttribute('data-resize') === 'true', pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const clampPosition = (graphic: PdfGraphic, x: number, y: number) => ({
    x: Math.max(Math.max(0, -graphic.width), Math.min(Math.max(0, pageSize.width - Math.max(0, graphic.width)), x)),
    y: Math.max(Math.max(0, -graphic.height), Math.min(Math.max(0, pageSize.height - Math.max(0, graphic.height)), y)),
  });
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = point(event);
    const dx = position.x - drag.startX;
    const dy = position.y - drag.startY;
    const graphic = drag.graphic;
    let next: PdfGraphic;
    if (drag.resize) {
      const isLine = graphic.kind === 'line' || graphic.kind === 'arrow';
      let width = Math.max(isLine ? -graphic.x : 1, Math.min(pageSize.width - graphic.x, graphic.width + dx));
      let height = Math.max(isLine ? -graphic.y : 1, Math.min(pageSize.height - graphic.y, graphic.height + dy));
      if (graphic.kind === 'image' && !event.shiftKey) {
        const ratio = graphic.width / graphic.height;
        const factor = Math.max(width / graphic.width, height / graphic.height);
        width = Math.max(1, Math.min(graphic.width * factor, pageSize.width - graphic.x, (pageSize.height - graphic.y) * ratio));
        height = width / ratio;
      }
      next = { ...graphic, width, height };
    } else {
      next = { ...graphic, ...clampPosition(graphic, graphic.x + dx, graphic.y + dy) };
    }
    previewRef.current = next;
    setPreview(next);
  };
  const finish = (event: PointerEvent<SVGSVGElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (commit && previewRef.current) onChange(previewRef.current);
    dragRef.current = null;
    previewRef.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!active || !interactive) return;
    if (event.key === 'Escape') {
      dragRef.current = null;
      previewRef.current = null;
      setPreview(null);
      onActiveChange(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDelete(active.id);
      return;
    }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    onChange({ ...active, ...clampPosition(active, active.x + direction[0] * step, active.y + direction[1] * step) });
  };
  if (!pageSize.width || !pageSize.height) return null;
  return (
    <svg
      ref={svgRef}
      width={pageSize.width * scale}
      height={pageSize.height * scale}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      className={`absolute inset-0 ${interactive ? 'touch-none outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : 'pointer-events-none'}`}
      tabIndex={interactive ? 0 : undefined}
      role="img"
      aria-label="追加した画像・図形。選択後は矢印キーで移動、Deleteで削除"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
      onKeyDown={keyDown}
    >
      {visible.map((item) => {
        const graphic = preview?.id === item.id ? preview : item;
        const { x, y, width, height } = graphic;
        const fill = graphic.fillColor === 'transparent' ? 'none' : graphic.fillColor;
        const endX = x + width;
        const endY = y + height;
        const angle = Math.atan2(height, width);
        const head = Math.min(Math.hypot(width, height) / 2, Math.max(8, graphic.lineWidth * 4));
        return (
          <g key={graphic.id} data-graphic-id={graphic.id} style={{ cursor: interactive ? 'move' : undefined }}>
            <title>{graphic.label}</title>
            <g opacity={graphic.opacity} style={{ mixBlendMode: graphic.kind === 'highlight' ? 'multiply' : 'normal' }}>
              {graphic.kind === 'image' && <image href={graphic.imageDataUrl} x={x} y={y} width={width} height={height} preserveAspectRatio="none" />}
              {(graphic.kind === 'rectangle' || graphic.kind === 'highlight') && <rect x={x} y={y} width={width} height={height} fill={graphic.kind === 'highlight' ? (graphic.fillColor === 'transparent' ? graphic.color : graphic.fillColor) : fill} stroke={graphic.kind === 'highlight' ? 'none' : graphic.color} strokeWidth={graphic.lineWidth} />}
              {graphic.kind === 'ellipse' && <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={graphic.color} strokeWidth={graphic.lineWidth} />}
              {(graphic.kind === 'line' || graphic.kind === 'arrow') && <line x1={x} y1={y} x2={endX} y2={endY} stroke={graphic.color} strokeWidth={graphic.lineWidth} />}
              {graphic.kind === 'arrow' && <path d={`M ${endX - head * Math.cos(angle - Math.PI / 6)} ${endY - head * Math.sin(angle - Math.PI / 6)} L ${endX} ${endY} L ${endX - head * Math.cos(angle + Math.PI / 6)} ${endY - head * Math.sin(angle + Math.PI / 6)}`} fill="none" stroke={graphic.color} strokeWidth={graphic.lineWidth} />}
            </g>
            {interactive && <rect x={Math.min(x, endX)} y={Math.min(y, endY) - (height === 0 ? 4 / scale : 0)} width={Math.max(8 / scale, Math.abs(width))} height={Math.max(8 / scale, Math.abs(height))} fill="transparent" stroke="none" />}
          </g>
        );
      })}
      {watermark.enabled && (watermark.pageIndex === -1 || watermark.pageIndex === currentPageIndex) && (
        <text x={pageSize.width / 2} y={pageSize.height / 2} textAnchor="middle" dominantBaseline="central" fontFamily={/[^\x20-\x7e]/.test(watermark.text) ? "'Noto Sans JP', sans-serif" : "Arial, sans-serif"} fontWeight={/[^\x20-\x7e]/.test(watermark.text) ? 400 : 700} fontSize={watermark.fontSize} fill={watermark.color} opacity={watermark.opacity} transform={`rotate(${-watermark.rotation}, ${pageSize.width / 2}, ${pageSize.height / 2})`} pointerEvents="none">{watermark.text.replace(/\s+/g, ' ').trim()}</text>
      )}
      {interactive && active && (() => {
        const item = preview?.id === active.id ? preview : active;
        const handleSize = 10 / scale;
        return <g>
          <rect x={Math.min(item.x, item.x + item.width) - 2 / scale} y={Math.min(item.y, item.y + item.height) - 2 / scale} width={Math.abs(item.width) + 4 / scale} height={Math.abs(item.height) + 4 / scale} fill="none" stroke="#2563eb" strokeWidth={1.5 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} pointerEvents="none" />
          <rect data-graphic-id={item.id} data-resize="true" x={item.x + item.width - handleSize / 2} y={item.y + item.height - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="#2563eb" strokeWidth={1.5 / scale} style={{ cursor: 'nwse-resize' }} />
        </g>;
      })()}
    </svg>
  );
}
