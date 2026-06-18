/**
 * コンテンツ認識 → 編集適用 → 再認識のラウンドトリップテスト。
 *
 * PDF座標系まわりは回帰しやすいため、レビュー指摘だった2点を恒久的に検証する:
 * - P1: fill演算子が開いたサブパスを暗黙に閉じる挙動（closePathなしの塗りパス）
 * - P2: viewport.transform を使った座標変換（MediaBox原点オフセット・回転ページ）
 *
 * pdf.js は Node では legacy ビルドが必要（vite.config.ts の test.alias 参照）。
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { hitTestRecognizedItems, recognizePageContent } from './contentRecognition';
import { applyContentEdits } from './contentEditOperations';
import { createTextEdit } from '../types/contentEdit';
import type {
  PathContentEdit,
  RecognizedPathItem,
  RecognizedTextItem,
} from '../types/contentEdit';

async function loadFirstPage(bytes: Uint8Array) {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  return doc.getPage(1);
}

async function recognizeFirstPage(bytes: Uint8Array) {
  return recognizePageContent(await loadFirstPage(bytes));
}

function isPath(item: { kind: string }): item is RecognizedPathItem {
  return item.kind === 'path';
}

function pathEdit(
  target: RecognizedPathItem,
  action: PathContentEdit['action'],
  overrides: Partial<Omit<PathContentEdit, 'kind' | 'target' | 'action'>> = {},
): PathContentEdit {
  return {
    kind: 'path',
    target,
    action,
    strokeColor: '#000000',
    lineWidth: 1,
    fillColor: '#000000',
    coverColor: '#ffffff',
    ...overrides,
  };
}

describe('完全削除（redact）— applyContentEdits 経由の統合', () => {
  async function createTextPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('BUILDING-NAME', { x: 40, y: 430, size: 18, font });
    page.drawText('ROOM-101', { x: 40, y: 250, size: 12, font });
    return doc.save();
  }

  async function extractStrings(bytes: Uint8Array): Promise<string[]> {
    const page = await loadFirstPage(bytes);
    const tc = await page.getTextContent();
    return (tc.items as { str?: string }[])
      .filter((i): i is { str: string } => typeof i.str === 'string' && i.str.trim() !== '')
      .map((i) => i.str);
  }

  it('redact 適用で対象文字が抽出から消え、他テキストは残る', async () => {
    const bytes = await createTextPdf();
    const target = (await recognizeFirstPage(bytes)).find(
      (i): i is RecognizedTextItem => i.kind === 'text' && i.text === 'BUILDING-NAME',
    );
    expect(target).toBeDefined();

    const out = await applyContentEdits(bytes, [{ ...createTextEdit(target!), action: 'redact' }]);
    const after = await extractStrings(out);

    expect(after).not.toContain('BUILDING-NAME');
    expect(after).toContain('ROOM-101');
  });

  it('delete（カバーのみ）では文字データが残り抽出できてしまう（対比）', async () => {
    const bytes = await createTextPdf();
    const target = (await recognizeFirstPage(bytes)).find(
      (i): i is RecognizedTextItem => i.kind === 'text' && i.text === 'BUILDING-NAME',
    );
    const out = await applyContentEdits(bytes, [{ ...createTextEdit(target!), action: 'delete' }]);
    const after = await extractStrings(out);

    // カバーは見た目だけなので、テキスト抽出では依然読める（redact との差を固定）
    expect(after).toContain('BUILDING-NAME');
  });
});

describe('暗黙に閉じられる塗りパス（closePathなしの fill）', () => {
  // M-L-L + fill のみ（closePath なし）の塗り三角形
  async function createTrianglePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawSvgPath('M 0 0 L 100 0 L 50 -80', {
      x: 60,
      y: 300,
      color: rgb(0, 0.6, 0),
    });
    return doc.save();
  }

  it('ポリゴンとして認識され、重心クリックで選択できる', async () => {
    const bytes = await createTrianglePdf();
    const items = await recognizeFirstPage(bytes);
    const paths = items.filter(isPath);

    expect(paths).toHaveLength(1);
    const tri = paths[0];
    expect(tri.filled).toBe(true);
    // closed はストロークに閉じ辺が含まれるかを表す幾何学的フラグなので false のまま
    expect(tri.closed).toBe(false);
    expect(tri.shape).toBe('polygon');

    const cx = tri.points.reduce((sum, p) => sum + p.x, 0) / tri.points.length;
    const cy = tri.points.reduce((sum, p) => sum + p.y, 0) / tri.points.length;
    expect(hitTestRecognizedItems(items, { x: cx, y: cy })?.id).toBe(tri.id);
  });

  it('削除すると塗り部分もカバー色で塗り潰される', async () => {
    const bytes = await createTrianglePdf();
    const items = await recognizeFirstPage(bytes);
    const tri = items.filter(isPath)[0];

    const deleted = await applyContentEdits(bytes, [pathEdit(tri, 'delete')]);
    const covers = (await recognizeFirstPage(deleted)).filter(
      (item) => isPath(item) && item.filled && item.fillColor.toLowerCase() === '#ffffff',
    );
    expect(covers.length).toBeGreaterThanOrEqual(1);
  });

  it('スタイル変更で塗り色が変わる', async () => {
    const bytes = await createTrianglePdf();
    const items = await recognizeFirstPage(bytes);
    const tri = items.filter(isPath)[0];

    const restyled = await applyContentEdits(bytes, [
      pathEdit(tri, 'restyle', { fillColor: '#ff0000' }),
    ]);
    const reds = (await recognizeFirstPage(restyled)).filter(
      (item) => isPath(item) && item.filled && item.fillColor.toLowerCase() === '#ff0000',
    );
    expect(reds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('MediaBox原点がずれたページの座標変換', () => {
  async function createOffsetPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.setMediaBox(50, 70, 300, 400); // 原点が (50, 70) のページ
    page.drawLine({
      start: { x: 120, y: 250 },
      end: { x: 280, y: 250 },
      thickness: 2,
      color: rgb(1, 0, 0),
    });
    return doc.save();
  }

  it('viewport変換ベースのクリック判定が命中し、旧来のY反転式は外す', async () => {
    const bytes = await createOffsetPdf();
    const page = await loadFirstPage(bytes);
    const items = await recognizePageContent(page);
    const line = items.filter(isPath).find((item) => item.shape === 'line');
    expect(line).toBeDefined();

    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    // 線の中点が描画されるキャンバス位置（= ユーザーがクリックする位置）
    const [canvasX, canvasY] = viewport.convertToViewportPoint(200, 250);
    expect(canvasX).toBeCloseTo((200 - 50) * scale, 5);
    expect(canvasY).toBeCloseTo((400 + 70 - 250) * scale, 5);

    const [px, py] = viewport.convertToPdfPoint(canvasX, canvasY);
    expect(hitTestRecognizedItems(items, { x: px, y: py })?.id).toBe(line?.id);

    // 回帰ガード: 原点オフセットを無視した単純なY反転だとずれて外れる
    const oldPoint = { x: canvasX / scale, y: viewport.height / scale - canvasY / scale };
    expect(hitTestRecognizedItems(items, oldPoint)).toBeNull();
  });
});

describe('回転ページ（/Rotate 90）の座標変換', () => {
  async function createRotatedPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.setRotation(degrees(90));
    page.drawLine({
      start: { x: 60, y: 100 },
      end: { x: 240, y: 100 },
      thickness: 2,
      color: rgb(0, 0, 1),
    });
    return doc.save();
  }

  it('表示位置のクリックをユーザー空間へ逆変換して選択できる', async () => {
    const bytes = await createRotatedPdf();
    const page = await loadFirstPage(bytes);
    const items = await recognizePageContent(page);
    const line = items.filter(isPath).find((item) => item.shape === 'line');
    expect(line).toBeDefined();

    const viewport = page.getViewport({ scale: 1 });
    // 回転が反映されて横長になる
    expect(viewport.width).toBe(400);
    expect(viewport.height).toBe(300);

    const [canvasX, canvasY] = viewport.convertToViewportPoint(150, 100);
    const [px, py] = viewport.convertToPdfPoint(canvasX, canvasY);
    expect(hitTestRecognizedItems(items, { x: px, y: py })?.id).toBe(line?.id);
  });

  it('スタイル変更してもユーザー空間の位置と線幅が保たれる', async () => {
    const bytes = await createRotatedPdf();
    const items = await recognizeFirstPage(bytes);
    const line = items.filter(isPath).find((item) => item.shape === 'line');
    expect(line).toBeDefined();

    const restyled = await applyContentEdits(bytes, [
      pathEdit(line!, 'restyle', { strokeColor: '#00ff00', lineWidth: 4 }),
    ]);
    const green = (await recognizeFirstPage(restyled))
      .filter(isPath)
      .find((item) => item.shape === 'line' && item.strokeColor.toLowerCase() === '#00ff00');

    expect(green).toBeDefined();
    expect(green!.points[0].y).toBeCloseTo(100, 1);
    expect(Math.min(green!.points[0].x, green!.points[1].x)).toBeCloseTo(60, 1);
    expect(green!.lineWidth).toBeCloseTo(4, 2);
  });
});
