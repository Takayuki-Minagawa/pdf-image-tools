import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type {
  PageBBox,
  PagePoint,
  RecognizedItem,
  RecognizedPathItem,
  RecognizedShape,
  RecognizedTextItem,
} from '../types/contentEdit';

/**
 * pdf.js 内部の DrawOPS 定数（公開APIには含まれないため自前定義）。
 * constructPath オペレータの引数 data[0] に格納されるパスコマンドの種別。
 * 参照: pdfjs-dist/build/pdf.mjs の `const DrawOPS`
 */
const DRAW_OPS = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// PDFの行ベクトル規約: 合成後 = 既存CTM に args の変換を後置適用
function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): PagePoint {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

interface GfxState {
  ctm: Matrix;
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
}

interface DecodedSubpath {
  points: PagePoint[]; // パスコマンド座標（CTM適用前）
  closed: boolean;
  hasCurve: boolean;
}

function decodeSubpaths(data: ArrayLike<number>): DecodedSubpath[] {
  const subpaths: DecodedSubpath[] = [];
  let current: DecodedSubpath | null = null;
  let i = 0;

  while (i < data.length) {
    const op = data[i++];
    switch (op) {
      case DRAW_OPS.moveTo:
        current = { points: [{ x: data[i], y: data[i + 1] }], closed: false, hasCurve: false };
        subpaths.push(current);
        i += 2;
        break;
      case DRAW_OPS.lineTo:
        current?.points.push({ x: data[i], y: data[i + 1] });
        i += 2;
        break;
      case DRAW_OPS.curveTo:
        if (current) {
          current.hasCurve = true;
          current.points.push({ x: data[i + 4], y: data[i + 5] });
        }
        i += 6;
        break;
      case DRAW_OPS.quadraticCurveTo:
        if (current) {
          current.hasCurve = true;
          current.points.push({ x: data[i + 2], y: data[i + 3] });
        }
        i += 4;
        break;
      case DRAW_OPS.closePath:
        if (current) current.closed = true;
        break;
      default:
        // 未知のコマンドが来たら以降の解釈を諦める
        return subpaths;
    }
  }

  return subpaths;
}

function isAxisAlignedRectangle(points: PagePoint[]): boolean {
  if (points.length !== 4) return false;
  const eps = 0.01;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const sameX = Math.abs(a.x - b.x) < eps;
    const sameY = Math.abs(a.y - b.y) < eps;
    if (!sameX && !sameY) return false;
  }
  return true;
}

function classifyShape(points: PagePoint[], closed: boolean): RecognizedShape | null {
  if (closed && points.length >= 3) {
    return points.length === 4 && isAxisAlignedRectangle(points) ? 'rectangle' : 'polygon';
  }
  if (points.length === 2) return 'line';
  if (points.length > 2) return 'polyline';
  return null;
}

function computeBBox(points: PagePoint[], pad: number): PageBBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke]);
const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill]);
const FILL_STROKE_OPS = new Set<number>([
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const MAX_PATH_ITEMS_PER_PAGE = 1000;

async function recognizeTextItems(page: PDFPageProxy): Promise<RecognizedTextItem[]> {
  const pageIndex = page.pageNumber - 1;
  const textContent = await page.getTextContent();
  const items: RecognizedTextItem[] = [];

  let index = 0;
  for (const item of textContent.items) {
    if (!('str' in item) || item.str.trim() === '') continue;

    const [, , c, d, e, f] = item.transform as number[];
    const fontSize = Math.hypot(c, d);
    if (fontSize <= 0 || item.width <= 0) continue;

    items.push({
      id: `p${pageIndex}-text-${index++}`,
      kind: 'text',
      pageIndex,
      text: item.str,
      x: e,
      y: f,
      width: item.width,
      height: item.height || fontSize,
      fontSize,
    });
  }

  return items;
}

async function recognizePathItems(page: PDFPageProxy): Promise<RecognizedPathItem[]> {
  const pageIndex = page.pageNumber - 1;
  // intent: 'print' を指定して描画用（display）とは別のオペレータリストを取得する。
  // display用はキャンバス描画時にパスデータが Path2D へ差し替えられるため復元できない。
  const opList = await page.getOperatorList({ intent: 'print' });

  const items: RecognizedPathItem[] = [];
  const stateStack: GfxState[] = [];
  let state: GfxState = {
    ctm: IDENTITY,
    strokeColor: '#000000',
    fillColor: '#000000',
    lineWidth: 1,
  };
  let pathCounter = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save:
        stateStack.push({ ...state });
        break;
      case OPS.restore:
        state = stateStack.pop() ?? state;
        break;
      case OPS.transform:
        state.ctm = multiplyMatrix(state.ctm, args as Matrix);
        break;
      case OPS.setLineWidth:
        state.lineWidth = args[0] as number;
        break;
      case OPS.setStrokeRGBColor:
        if (typeof args[0] === 'string') state.strokeColor = args[0];
        break;
      case OPS.setFillRGBColor:
        if (typeof args[0] === 'string') state.fillColor = args[0];
        break;
      case OPS.setStrokeTransparent:
        state.strokeColor = 'transparent';
        break;
      case OPS.setFillTransparent:
        state.fillColor = 'transparent';
        break;
      case OPS.paintFormXObjectBegin: {
        stateStack.push({ ...state });
        const matrix = args?.[0] as Matrix | null;
        if (matrix) state.ctm = multiplyMatrix(state.ctm, matrix);
        break;
      }
      case OPS.paintFormXObjectEnd:
        state = stateStack.pop() ?? state;
        break;
      case OPS.constructPath: {
        if (items.length >= MAX_PATH_ITEMS_PER_PAGE) break;

        const [paintOp, data] = args as [number, unknown[]];
        const stroked = STROKE_OPS.has(paintOp) || FILL_STROKE_OPS.has(paintOp);
        const filled = FILL_OPS.has(paintOp) || FILL_STROKE_OPS.has(paintOp);
        if (!stroked && !filled) break;

        const pathData = data?.[0];
        if (
          !pathData ||
          (typeof Path2D !== 'undefined' && pathData instanceof Path2D) ||
          typeof (pathData as ArrayLike<number>).length !== 'number'
        ) {
          break;
        }

        for (const subpath of decodeSubpaths(pathData as ArrayLike<number>)) {
          if (subpath.hasCurve) continue; // 曲線を含むパスは対象外

          // CTMでページ空間へ変換し、連続する重複点を除去
          const transformed: PagePoint[] = [];
          for (const p of subpath.points) {
            const tp = applyMatrix(state.ctm, p.x, p.y);
            const prev = transformed[transformed.length - 1];
            if (prev && Math.abs(prev.x - tp.x) < 0.01 && Math.abs(prev.y - tp.y) < 0.01) {
              continue;
            }
            transformed.push(tp);
          }

          // 終点が始点と一致する場合は閉パスとして正規化
          let closed = subpath.closed;
          if (transformed.length >= 3) {
            const first = transformed[0];
            const last = transformed[transformed.length - 1];
            if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) {
              transformed.pop();
              closed = true;
            }
          }

          // PDFのfill演算子は開いたサブパスを暗黙に閉じるため、塗りありは閉図形として分類する。
          // closed自体はストロークに閉じ辺が含まれるかを表すので幾何学的な値のまま保持する。
          const shape = classifyShape(transformed, closed || filled);
          if (!shape) continue;

          const lineWidth = stroked
            ? Math.max(state.lineWidth * matrixScale(state.ctm), 0.1)
            : 0;

          items.push({
            id: `p${pageIndex}-path-${pathCounter++}`,
            kind: 'path',
            pageIndex,
            shape,
            points: transformed,
            closed,
            stroked,
            filled,
            strokeColor: state.strokeColor,
            fillColor: state.fillColor,
            lineWidth,
            bbox: computeBBox(transformed, lineWidth / 2),
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return items;
}

/**
 * 1ページ分のテキストとベクターパス（ライン / ポリライン / ポリゴン / 矩形）を認識する。
 */
export async function recognizePageContent(page: PDFPageProxy): Promise<RecognizedItem[]> {
  const [textItems, pathItems] = await Promise.all([
    recognizeTextItems(page),
    recognizePathItems(page),
  ]);
  return [...textItems, ...pathItems];
}

const TEXT_DESCENT_RATIO = 0.25;

export function getItemBBox(item: RecognizedItem): PageBBox {
  if (item.kind === 'text') {
    return {
      x0: item.x,
      y0: item.y - item.fontSize * TEXT_DESCENT_RATIO,
      x1: item.x + item.width,
      y1: item.y + item.height,
    };
  }
  return item.bbox;
}

function distanceToSegment(p: PagePoint, a: PagePoint, b: PagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function isPointInPolygon(p: PagePoint, points: PagePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    if (
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function hitTestItem(item: RecognizedItem, point: PagePoint, tolerance: number): boolean {
  const bbox = getItemBBox(item);
  if (
    point.x < bbox.x0 - tolerance ||
    point.x > bbox.x1 + tolerance ||
    point.y < bbox.y0 - tolerance ||
    point.y > bbox.y1 + tolerance
  ) {
    return false;
  }

  if (item.kind === 'text') return true;

  // fillは開いたサブパスも暗黙に閉じて塗るため、closedに関わらず内包判定する
  if (item.filled && isPointInPolygon(point, item.points)) return true;

  const hitWidth = Math.max(item.lineWidth / 2, tolerance);
  const count = item.points.length;
  const segmentCount = item.closed ? count : count - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = item.points[i];
    const b = item.points[(i + 1) % count];
    if (distanceToSegment(point, a, b) <= hitWidth) return true;
  }
  return false;
}

/**
 * クリック位置（ページ空間）に最も適合する認識要素を返す。
 * 複数ヒットした場合はバウンディングボックス面積が最小のものを優先する。
 */
export function hitTestRecognizedItems(
  items: RecognizedItem[],
  point: PagePoint,
  tolerance = 3,
): RecognizedItem | null {
  let best: RecognizedItem | null = null;
  let bestArea = Infinity;

  for (const item of items) {
    if (!hitTestItem(item, point, tolerance)) continue;
    const bbox = getItemBBox(item);
    const area = Math.max(bbox.x1 - bbox.x0, 1) * Math.max(bbox.y1 - bbox.y0, 1);
    if (area < bestArea) {
      best = item;
      bestArea = area;
    }
  }

  return best;
}
