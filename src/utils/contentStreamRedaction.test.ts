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
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  showText,
  setTextRenderingMode,
  TextRenderingMode,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist';
import { recognizePageContent } from './contentRecognition';
import { redactTextFromPage, __testing } from './contentStreamRedaction';
import { findResidualRedactions } from './redactionVerification';
import { applyContentEdits } from './contentEditOperations';
import { createTextEdit } from '../types/contentEdit';
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

describe('P2: 非等方スケールでのフォントサイズ算出（pdf.jsのhypot(c,d)準拠）', () => {
  it('横方向だけ拡大した cm でも fontSize が Tf と一致する（sqrt(det)ではずれる）', () => {
    // 横2倍の cm。pdf.js は fontSize=hypot(c,d)=10 を返す（sqrt(det)=14.1ではない）
    const content = 'q 2 0 0 1 0 0 cm BT /F1 10 Tf 1 0 0 1 50 700 Tm (X) Tj ET Q';
    const ops = __testing.collectShowOps(content);
    expect(ops).toHaveLength(1);
    expect(ops[0].fontSize).toBeCloseTo(10, 5);
    expect(ops[0].origin.x).toBeCloseTo(100, 5); // 50 × 2
    expect(ops[0].origin.y).toBeCloseTo(700, 5);
  });
});

describe('P1-328: 同一BT内で複数回 Tj するPDF（テキスト行列を前進させない）', () => {
  // pdf-lib の drawText は Tj ごとに別 BT/Tm を出すため、生オペレータで
  // 「BT ... (FOO) Tj (BAR) Tj ... ET」（再配置なしの連続Tj）を作る。
  // 連続Tjは実描画では前進して隣接表示され、pdf.js は1要素に統合して認識する。
  // エンジンは原点が重複する両Tjをまとめて除去できなければならない
  // （片方だけ消して成功扱いにする＝サイレント失敗を防ぐ）。
  async function makeMultiTjPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('SEED', { x: 10, y: 10, size: 8, font }); // フォントをページ資源に登録
    page.pushOperators(
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('FOO')),
      showText(font.encodeText('BAR')), // 直前のFOOぶん前進しているが Tm 指定なし
      endText(),
    );
    return doc.save();
  }

  it('原点が重複する連続Tjをまとめて除去し、両方が抽出から消える', async () => {
    const bytes = await makeMultiTjPdf();
    const items = await recognizeText(bytes);
    // 連続表示のため "FOOBAR" を含む1要素として認識される
    const target = items.find((t) => t.text.includes('FOO') && t.text.includes('BAR'));
    expect(target).toBeDefined();

    const doc = await PDFDocument.load(bytes);
    redactTextFromPage(doc, 0, [target!]);
    const after = await extractStrings(await doc.save());
    // FOO/BAR どちらの断片も残っていないこと（片側だけ消す失敗をしない）
    expect(after.join('|')).not.toContain('FOO');
    expect(after.join('|')).not.toContain('BAR');
    expect(after).toContain('SEED'); // 無関係なテキストは保持
  });
});

describe('P1-423: 同一位置の重複テキスト（隠しOCRレイヤー想定）', () => {
  async function makeOverlayPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('SEED', { x: 10, y: 10, size: 8, font });
    // 同じ位置・同じ文字を「可視」と「不可視(Tr 3)」で二重に描画する
    page.pushOperators(
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('SECRET')),
      endText(),
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('SECRET')),
      endText(),
    );
    return doc.save();
  }

  it('重なった複製ごとまとめて除去し、抽出から完全に消える', async () => {
    const bytes = await makeOverlayPdf();
    const items = await recognizeText(bytes);
    const secrets = items.filter((t) => t.text === 'SECRET');
    // 可視・不可視の2件が認識される（隠しレイヤーも抽出対象）
    expect(secrets.length).toBeGreaterThanOrEqual(2);

    const doc = await PDFDocument.load(bytes);
    redactTextFromPage(doc, 0, [secrets[0]]); // 1件だけ指定しても両方消える
    const after = await extractStrings(await doc.save());
    expect(after).not.toContain('SECRET');
  });
});

describe('分割OCRレイヤー（可視 SECRET ＋ 分割断片 SEC / RET）', () => {
  // 可視の "SECRET" と同じ位置に、わずかに離して "SEC" と "RET" を分割描画する。
  // pdf.js は十分な隙間があると断片を別item（SEC / RET）として抽出するため、
  // 可視 SECRET だけを消すと断片が読めるまま残る（＝サイレント成功）。
  // 断片の原点は可視 SECRET の bbox 内に収まるため、まとめて除去できねばならない。
  const GAP = 12; // pdf.js が SEC / RET を別itemに分離する隙間（pt）

  async function makeSplitOverlayPdf(): Promise<{ bytes: Uint8Array; secWidth: number }> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('SEED', { x: 10, y: 10, size: 8, font });
    const secWidth = font.widthOfTextAtSize('SEC', 16);
    page.pushOperators(
      // 可視レイヤー: SECRET を一括描画
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('SECRET')),
      endText(),
      // 分割断片レイヤー: SEC と RET を別itemに分離する隙間を空けて描画
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('SEC')),
      endText(),
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50 + secWidth + GAP, 150),
      showText(font.encodeText('RET')),
      endText(),
    );
    return { bytes: await doc.save(), secWidth };
  }

  it('pdf.js は分割断片 SEC / RET を別itemとして抽出する（前提確認）', async () => {
    const { bytes } = await makeSplitOverlayPdf();
    const strings = await extractStrings(bytes);
    // 連結で "SECRET" を作る単一itemではなく、SEC と RET が別itemで存在する
    expect(strings).toContain('SEC');
    expect(strings).toContain('RET');
  });

  it('可視SECRETを指定すると bbox 内の分割断片もまとめて除去される', async () => {
    const { bytes } = await makeSplitOverlayPdf();
    const target = (await recognizeText(bytes)).find((t) => t.text === 'SECRET');
    expect(target).toBeDefined();

    const doc = await PDFDocument.load(bytes);
    redactTextFromPage(doc, 0, [target!]);
    const after = await extractStrings(await doc.save());
    expect(after.join('|')).not.toContain('SECRET');
    expect(after).not.toContain('SEC');
    expect(after).not.toContain('RET');
    expect(after).toContain('SEED');
  });

  it('事後検証は分割断片の残存も連結比較で検知する', async () => {
    const { secWidth } = await makeSplitOverlayPdf();
    // 「可視 SECRET は消えたが分割断片 SEC / RET だけ残った」状態を最小再現する。
    // フル "SECRET" item は存在しないため、完全一致では検知できず連結比較が必要。
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.pushOperators(
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50, 150),
      showText(font.encodeText('SEC')),
      endText(),
      beginText(),
      setFontAndSize(font.name, 16),
      setTextMatrix(1, 0, 0, 1, 50 + secWidth + GAP, 150),
      showText(font.encodeText('RET')),
      endText(),
    );
    const fragmentBytes = await doc.save();

    // フル一致は無いが、bbox 内の SEC + RET を連結すると SECRET になり残存判定
    const target: RecognizedTextItem = {
      id: 't',
      kind: 'text',
      pageIndex: 0,
      text: 'SECRET',
      x: 50,
      y: 150,
      width: secWidth + GAP + secWidth,
      height: 16,
      fontSize: 16,
    };
    expect(await findResidualRedactions(fragmentBytes, [target])).toHaveLength(1);
  });

  it('redact 適用後は分割断片も消え残存なし', async () => {
    const { bytes } = await makeSplitOverlayPdf();
    const target = (await recognizeText(bytes)).find((t) => t.text === 'SECRET')!;
    const out = await applyContentEdits(bytes, [{ ...createTextEdit(target), action: 'redact' }]);
    expect(await findResidualRedactions(out, [target])).toHaveLength(0);
  });
});

describe('findResidualRedactions（redact後の事後検証）', () => {
  async function makePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('TARGET', { x: 40, y: 200, size: 16, font });
    return doc.save();
  }

  it('対象が残っていれば残存として返し、除去後は空になる', async () => {
    const bytes = await makePdf();
    const target = (await recognizeText(bytes)).find((t) => t.text === 'TARGET')!;

    // 未除去のバイト列ではまだ抽出できる → 残存
    expect(await findResidualRedactions(bytes, [target])).toHaveLength(1);

    // applyContentEdits の redact 適用後は残存なし
    const out = await applyContentEdits(bytes, [{ ...createTextEdit(target), action: 'redact' }]);
    expect(await findResidualRedactions(out, [target])).toHaveLength(0);
  });

  it('完全削除に成功した場合 onWarn は呼ばれない', async () => {
    const bytes = await makePdf();
    const target = (await recognizeText(bytes)).find((t) => t.text === 'TARGET')!;
    let warned: RecognizedTextItem[] | null = null;
    await applyContentEdits(bytes, [{ ...createTextEdit(target), action: 'redact' }], (u) => {
      warned = u;
    });
    expect(warned).toBeNull();
  });
});
