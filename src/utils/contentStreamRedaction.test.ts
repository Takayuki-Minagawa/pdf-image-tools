/**
 * コンテンツストリームからのテキスト物理削除（redact）の検証。
 *
 * 受け入れ基準: redact 適用後に pdf.js getTextContent で再抽出しても
 * 対象文字列が存在せず、他テキストは残ること（＝AI のテキスト抽出から消える）。
 */
import { describe, expect, it } from 'vitest';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  translate,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { recognizePageContent } from './contentRecognition';
import { redactTextFromPage, __testing } from './contentStreamRedaction';
import type { RecognizedTextItem } from '../types/contentEdit';

async function extractStrings(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  return (tc.items as { str?: string }[])
    .filter((i): i is { str: string } => typeof i.str === 'string' && i.str.trim() !== '')
    .map((i) => i.str);
}

async function recognizeText(bytes: Uint8Array): Promise<RecognizedTextItem[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(1);
  const items = await recognizePageContent(page);
  return items.filter((i): i is RecognizedTextItem => i.kind === 'text');
}

async function redactByText(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const targets = (await recognizeText(bytes)).filter((t) => t.text === text);
  expect(targets.length).toBeGreaterThan(0);
  const doc = await PDFDocument.load(bytes);
  const result = redactTextFromPage(doc, 0, targets);
  expect(result.unmatched).toHaveLength(0);
  expect(result.removed.length).toBe(targets.length);
  return doc.save();
}

describe('redactTextFromPage', () => {
  async function makePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('PROPERTY-ABC', { x: 40, y: 420, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('KEEP-ME', { x: 40, y: 200, size: 12, font });
    page.drawText('FLOOR-PLAN-2F', { x: 60, y: 120, size: 14, font });
    return doc.save();
  }

  it('対象テキストが抽出結果から消え、他は残る', async () => {
    const bytes = await makePdf();
    expect(await extractStrings(bytes)).toEqual(
      expect.arrayContaining(['PROPERTY-ABC', 'KEEP-ME', 'FLOOR-PLAN-2F']),
    );

    const out = await redactByText(bytes, 'PROPERTY-ABC');
    const after = await extractStrings(out);

    expect(after).not.toContain('PROPERTY-ABC');
    expect(after).toContain('KEEP-ME');
    expect(after).toContain('FLOOR-PLAN-2F');
  });

  it('元の文字バイト列がファイルから消える（生バイト走査）', async () => {
    const bytes = await makePdf();
    const out = await redactByText(bytes, 'PROPERTY-ABC');
    // 復号後のストリームを再パースして対象文字が残っていないことを確認
    const after = await extractStrings(out);
    expect(after.join('|')).not.toContain('PROPERTY-ABC');
  });

  it('マッチしない対象は unmatched として返す', async () => {
    const bytes = await makePdf();
    const fake: RecognizedTextItem = {
      id: 'fake',
      kind: 'text',
      pageIndex: 0,
      text: 'NOPE',
      x: 9999,
      y: 9999,
      width: 10,
      height: 10,
      fontSize: 10,
    };
    const doc = await PDFDocument.load(bytes);
    const result = redactTextFromPage(doc, 0, [fake]);
    expect(result.removed).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('cm変換が掛かったテキストでも原点が一致して除去できる', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // 平行移動した座標系の中に物件名を描画（CAD図面に多いパターン）
    page.pushOperators(pushGraphicsState(), translate(120, 90));
    page.drawText('SECRET-PROP', { x: 0, y: 0, size: 16, font });
    page.pushOperators(popGraphicsState());
    page.drawText('VISIBLE', { x: 40, y: 300, size: 12, font });
    const bytes = await doc.save();

    // pdf.js が報告する原点が (120,90) 付近であることを確認
    const recognized = (await recognizeText(bytes)).find((t) => t.text === 'SECRET-PROP');
    expect(recognized).toBeDefined();
    expect(recognized!.x).toBeCloseTo(120, 0);
    expect(recognized!.y).toBeCloseTo(90, 0);

    const out = await redactByText(bytes, 'SECRET-PROP');
    const after = await extractStrings(out);
    expect(after).not.toContain('SECRET-PROP');
    expect(after).toContain('VISIBLE');
  });

  it('TJ配列の描画オペランドを検出し範囲を特定できる（tokenizer/collectShowOps）', () => {
    const content =
      'BT /F1 20 Tf 1 0 0 1 50 700 Tm [(Hel) -120 (lo) 50 (World)] TJ ET';
    const ops = __testing.collectShowOps(content);
    expect(ops).toHaveLength(1);
    expect(ops[0].empty).toBe('[]');
    expect(ops[0].origin.x).toBeCloseTo(50, 5);
    expect(ops[0].origin.y).toBeCloseTo(700, 5);
    expect(ops[0].fontSize).toBeCloseTo(20, 5);
    // 検出範囲が配列全体（'[' から ']'）であること
    const span = content.slice(ops[0].operandStart, ops[0].operandEnd);
    expect(span.startsWith('[')).toBe(true);
    expect(span.endsWith(']')).toBe(true);
    expect(span).toContain('World');
  });

  it('複数対象を同時に除去できる', async () => {
    const bytes = await makePdf();
    const targets = (await recognizeText(bytes)).filter(
      (t) => t.text === 'PROPERTY-ABC' || t.text === 'FLOOR-PLAN-2F',
    );
    const doc = await PDFDocument.load(bytes);
    const result = redactTextFromPage(doc, 0, targets);
    expect(result.removed).toHaveLength(2);
    const after = await extractStrings(await doc.save());
    expect(after).not.toContain('PROPERTY-ABC');
    expect(after).not.toContain('FLOOR-PLAN-2F');
    expect(after).toContain('KEEP-ME');
  });
});
