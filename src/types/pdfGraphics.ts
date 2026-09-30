export type PdfGraphicKind = 'image' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'highlight';

/** Coordinates are physical points from the visible, rotated page's top-left. */
export interface PdfGraphic {
  id: string;
  kind: PdfGraphicKind;
  pageIndex: number; // 0-based; -1 means all pages
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fillColor: string; // #rrggbb or 'transparent'
  lineWidth: number;
  opacity: number;
  imageDataUrl?: string;
  label: string;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number; // Counterclockwise degrees on the visible page
  pageIndex: number; // 0-based; -1 means all pages
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
  enabled: false,
  text: '社外秘',
  fontSize: 64,
  color: '#64748b',
  opacity: 0.18,
  rotation: 35,
  pageIndex: -1,
};

export function createDefaultGraphic(kind: PdfGraphicKind, pageIndex: number): PdfGraphic {
  const labels: Record<PdfGraphicKind, string> = {
    image: '画像・署名', rectangle: '四角形', ellipse: '楕円',
    line: '直線', arrow: '矢印', highlight: 'マーカー',
  };
  return {
    id: crypto.randomUUID(),
    kind,
    pageIndex,
    x: 50,
    y: 80,
    width: 160,
    height: kind === 'highlight' ? 24 : kind === 'line' || kind === 'arrow' ? 0 : 80,
    color: kind === 'highlight' ? '#facc15' : '#2563eb',
    fillColor: kind === 'highlight' ? '#facc15' : 'transparent',
    lineWidth: 2,
    opacity: kind === 'highlight' ? 0.4 : 1,
    label: labels[kind],
  };
}
