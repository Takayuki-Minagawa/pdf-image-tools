/**
 * PDFページのコンテンツストリームから、指定したテキスト要素の描画オペランドを
 * 物理的に除去（空文字列化）するエンジン。
 *
 * カバー塗り（drawRectangle で上から隠す）と違い、元の文字バイト列をファイルから
 * 取り除くため、テキスト抽出（pdf.js getTextContent 等）でも復元できなくなる。
 *
 * マッチングはフォント非依存にするため「テキスト原点（CTM∘Tm の平行移動成分）＋
 * 概算フォントサイズ」の幾何一致で行う。pdf.js の getTextContent が返す
 * transform[e,f] / hypot(c,d) と同じ空間・同じ尺度になるよう、認識側
 * (contentRecognition.ts) と同一の行列規約を用いる。
 *
 * 座標系はすべて PDF ユーザー空間（CTM 適用後・MediaBox/回転の適用前）で、
 * これは RecognizedTextItem.x/y/fontSize と一致する。
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import type { RecognizedTextItem } from '../types/contentEdit';

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// 行ベクトル規約: 合成後 = 既存行列に後置で args を適用（contentRecognition と同一）
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

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// ---- トークナイザ ----------------------------------------------------------

type TokenType = 'num' | 'name' | 'string' | 'array' | 'dictDelim' | 'op';

interface Token {
  type: TokenType;
  start: number; // バイト（=latin1文字）オフセット
  end: number; // 終端の次（排他）
  value?: number; // num のみ
  text?: string; // op / name の識別子
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([
  0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25,
]); // ( ) < > [ ] { } / %

function isWhitespace(c: number): boolean {
  return WHITESPACE.has(c);
}
function isDelimiter(c: number): boolean {
  return DELIMITERS.has(c);
}
function isRegular(c: number): boolean {
  return !isWhitespace(c) && !isDelimiter(c);
}

/**
 * latin1 文字列としてのコンテンツストリームをトークン列へ分解する。
 * インラインイメージ（BI...ID<binary>EI）はバイナリ部を読み飛ばす。
 */
function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  const len = s.length;
  let i = 0;

  const readLiteralString = (): number => {
    // s[i] === '(' を前提。バランスした括弧と \ エスケープを処理。
    let depth = 0;
    let j = i;
    while (j < len) {
      const c = s.charCodeAt(j);
      if (c === 0x5c) {
        j += 2; // バックスラッシュエスケープ（次の1文字を消費）
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return len;
  };

  while (i < len) {
    const c = s.charCodeAt(i);

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    // コメント
    if (c === 0x25) {
      while (i < len && s.charCodeAt(i) !== 0x0a && s.charCodeAt(i) !== 0x0d) i++;
      continue;
    }

    // リテラル文字列
    if (c === 0x28) {
      const start = i;
      const end = readLiteralString();
      tokens.push({ type: 'string', start, end });
      i = end;
      continue;
    }

    // 16進文字列 or 辞書デリミタ
    if (c === 0x3c) {
      if (i + 1 < len && s.charCodeAt(i + 1) === 0x3c) {
        tokens.push({ type: 'dictDelim', start: i, end: i + 2, text: '<<' });
        i += 2;
        continue;
      }
      const start = i;
      let j = i + 1;
      while (j < len && s.charCodeAt(j) !== 0x3e) j++;
      const end = j + 1; // '>' を含む
      tokens.push({ type: 'string', start, end });
      i = end;
      continue;
    }
    if (c === 0x3e) {
      if (i + 1 < len && s.charCodeAt(i + 1) === 0x3e) {
        tokens.push({ type: 'dictDelim', start: i, end: i + 2, text: '>>' });
        i += 2;
        continue;
      }
      i++; // 単独の '>' は不正だがスキップ
      continue;
    }

    // 配列
    if (c === 0x5b) {
      tokens.push({ type: 'op', start: i, end: i + 1, text: '[' });
      i++;
      continue;
    }
    if (c === 0x5d) {
      tokens.push({ type: 'op', start: i, end: i + 1, text: ']' });
      i++;
      continue;
    }

    // 名前 /Foo
    if (c === 0x2f) {
      const start = i;
      i++;
      while (i < len && isRegular(s.charCodeAt(i))) i++;
      tokens.push({ type: 'name', start, end: i, text: s.slice(start, i) });
      continue;
    }

    // 数値
    if (
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2b ||
      c === 0x2d ||
      c === 0x2e
    ) {
      const start = i;
      i++;
      while (i < len) {
        const cc = s.charCodeAt(i);
        if ((cc >= 0x30 && cc <= 0x39) || cc === 0x2e || cc === 0x2b || cc === 0x2d || cc === 0x65 || cc === 0x45) i++;
        else break;
      }
      const value = parseFloat(s.slice(start, i));
      tokens.push({ type: 'num', start, end: i, value: Number.isNaN(value) ? 0 : value });
      continue;
    }

    // それ以外は演算子キーワード
    {
      const start = i;
      i++;
      while (i < len && isRegular(s.charCodeAt(i))) i++;
      const text = s.slice(start, i);
      tokens.push({ type: 'op', start, end: i, text });

      // インラインイメージ: ID 以降のバイナリを EI までスキップ
      if (text === 'ID') {
        let j = i + 1; // ID 直後の空白1文字をスキップした位置から
        while (j < len) {
          if (
            s.charCodeAt(j) === 0x45 && // 'E'
            s.charCodeAt(j + 1) === 0x49 && // 'I'
            (j + 2 >= len || isWhitespace(s.charCodeAt(j + 2))) &&
            isWhitespace(s.charCodeAt(j - 1))
          ) {
            tokens.push({ type: 'op', start: j, end: j + 2, text: 'EI' });
            i = j + 2;
            break;
          }
          j++;
        }
        if (j >= len) i = len;
      }
    }
  }

  return tokens;
}

// ---- ストリーム解析（テキスト原点の特定） ---------------------------------

interface GfxState {
  ctm: Matrix;
  fontSize: number;
  leading: number;
}

interface ShowOp {
  /** 除去対象となるテキストオペランドのバイト範囲（[start,end)） */
  operandStart: number;
  operandEnd: number;
  /** 空にする際の置換文字列（'()' or '[]'） */
  empty: string;
  origin: { x: number; y: number };
  fontSize: number;
  /**
   * オペランドから復元した文字列。簡易フォント（WinAnsi等）では target.text と
   * 比較できる。CID/埋め込みサブセットフォントでは正しく復元できないため null 同然
   * （その場合は幾何マッチにフォールバックし、最終的に pdf.js 再抽出で検証する）。
   */
  decodedText: string | null;
}

// ---- テキストオペランドの復号（簡易フォント用・ベストエフォート） -----------

const OCTAL = /[0-7]/;

/** リテラル文字列 (...) の中身 [from,to) を復号する。 */
function decodeLiteral(content: string, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const c = content[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = content[i + 1];
    i++;
    switch (n) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '(': out += '('; break;
      case ')': out += ')'; break;
      case '\\': out += '\\'; break;
      case '\n': break; // 行継続
      case '\r': if (content[i + 1] === '\n') i++; break;
      default:
        if (n && OCTAL.test(n)) {
          let oct = n;
          while (oct.length < 3 && OCTAL.test(content[i + 1] ?? '')) oct += content[++i];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n !== undefined) {
          out += n;
        }
    }
  }
  return out;
}

/** 16進文字列 <...> の中身 [from,to) を復号する。 */
function decodeHex(content: string, from: number, to: number): string {
  let hex = '';
  for (let i = from; i < to; i++) {
    const c = content[i];
    if (!/\s/.test(c)) hex += c;
  }
  if (hex.length % 2 === 1) hex += '0';
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) & 0xff);
  }
  return out;
}

/** リテラル文字列の終端 ')'(の次) を返す。エスケープと括弧の入れ子を考慮。 */
function scanLiteralEnd(content: string, openIdx: number, limit: number): number {
  let depth = 0;
  for (let j = openIdx; j < limit; j++) {
    const c = content[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return limit;
}

/**
 * show-op のテキストオペランド [start,end) を文字列へ復号する。
 * Tj/'/" は文字列トークン、TJ は配列。復号できない場合は空文字を返す。
 */
function decodeOperandText(content: string, start: number, end: number): string {
  const first = content[start];
  if (first === '(') return decodeLiteral(content, start + 1, end - 1);
  if (first === '<') return decodeHex(content, start + 1, end - 1);
  if (first === '[') {
    let out = '';
    let i = start + 1;
    while (i < end - 1) {
      const c = content[i];
      if (c === '(') {
        const j = scanLiteralEnd(content, i, end - 1);
        out += decodeLiteral(content, i + 1, j - 1);
        i = j;
      } else if (c === '<') {
        let j = content.indexOf('>', i);
        if (j < 0 || j >= end - 1) j = end - 2;
        out += decodeHex(content, i + 1, j);
        i = j + 1;
      } else {
        i++;
      }
    }
    return out;
  }
  return '';
}

/** 配列オペランド（[ ... ]）の範囲を直近の '[' まで遡って求める */
function findArraySpan(tokens: Token[], closeIdx: number): { start: number; end: number } | null {
  let depth = 0;
  for (let k = closeIdx; k >= 0; k--) {
    const t = tokens[k];
    if (t.type === 'op' && t.text === ']') depth++;
    else if (t.type === 'op' && t.text === '[') {
      depth--;
      if (depth === 0) return { start: t.start, end: tokens[closeIdx].end };
    }
  }
  return null;
}

/** テキストを描画する全 show-op を、原点・フォントサイズ付きで列挙する。 */
function collectShowOps(content: string): ShowOp[] {
  const tokens = tokenize(content);
  const ops: ShowOp[] = [];

  let ctm: Matrix = IDENTITY;
  let fontSize = 0;
  let leading = 0;
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  const stack: GfxState[] = [];

  // 直近のオペランドトークン（配列要素やネストは [ ] で簡易処理）
  const operands: Token[] = [];

  const num = (idx: number): number => {
    const t = operands[operands.length + idx];
    return t && t.type === 'num' ? (t.value ?? 0) : 0;
  };

  const computeShow = (operandStart: number, operandEnd: number, empty: string) => {
    const combined = multiplyMatrix(ctm, tm);
    const origin = applyMatrix(combined, 0, 0);
    // pdf.js の getTextContent は fontSize = hypot(transform.c, transform.d) として返す。
    // テキスト描画行列の縦方向列 = fontSize × combined の (c,d) なので同じ尺度で算出する
    // （sqrt(det) では非等方スケールやシアーで pdf.js とずれてマッチ失敗するため）。
    const size = Math.abs(fontSize) * Math.hypot(combined[2], combined[3]);
    const decoded = decodeOperandText(content, operandStart, operandEnd);
    ops.push({ operandStart, operandEnd, empty, origin, fontSize: size, decodedText: decoded || null });
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];

    if (t.type !== 'op') {
      operands.push(t);
      continue;
    }
    if (t.text === '[' || t.text === ']') {
      operands.push(t);
      continue;
    }

    switch (t.text) {
      case 'q':
        stack.push({ ctm, fontSize, leading });
        break;
      case 'Q': {
        const s = stack.pop();
        if (s) {
          ctm = s.ctm;
          fontSize = s.fontSize;
          leading = s.leading;
        }
        break;
      }
      case 'cm':
        ctm = multiplyMatrix(ctm, [num(-6), num(-5), num(-4), num(-3), num(-2), num(-1)]);
        break;
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tf':
        fontSize = num(-1);
        break;
      case 'TL':
        leading = num(-1);
        break;
      case 'Td': {
        tlm = multiplyMatrix(tlm, [1, 0, 0, 1, num(-2), num(-1)]);
        tm = tlm;
        break;
      }
      case 'TD': {
        leading = -num(-1);
        tlm = multiplyMatrix(tlm, [1, 0, 0, 1, num(-2), num(-1)]);
        tm = tlm;
        break;
      }
      case 'Tm':
        tm = [num(-6), num(-5), num(-4), num(-3), num(-2), num(-1)];
        tlm = tm;
        break;
      case 'T*':
        tlm = multiplyMatrix(tlm, [1, 0, 0, 1, 0, -leading]);
        tm = tlm;
        break;
      // 注: show-op 後のテキスト行列前進（グリフ幅ぶんの移動）は行っていない。
      // 同一 BT 内で複数回 Tj するPDFでは後続要素の原点が重複するが、文字列一致
      // （selectOpsForTarget）で正しい要素を選び、最終的に pdf.js 再抽出で検証する。
      case 'Tj':
      case "'": {
        if (t.text === "'") {
          // 改行してから表示
          tlm = multiplyMatrix(tlm, [1, 0, 0, 1, 0, -leading]);
          tm = tlm;
        }
        const str = operands[operands.length - 1];
        if (str && str.type === 'string') computeShow(str.start, str.end, '()');
        break;
      }
      case '"': {
        // aw ac string " : 改行してから表示
        tlm = multiplyMatrix(tlm, [1, 0, 0, 1, 0, -leading]);
        tm = tlm;
        const str = operands[operands.length - 1];
        if (str && str.type === 'string') computeShow(str.start, str.end, '()');
        break;
      }
      case 'TJ': {
        // TJ 直前の ']' トークンを基点に配列範囲を求める
        let closeIdx = idx - 1;
        while (closeIdx >= 0 && !(tokens[closeIdx].type === 'op' && tokens[closeIdx].text === ']')) {
          closeIdx--;
        }
        const span = closeIdx >= 0 ? findArraySpan(tokens, closeIdx) : null;
        if (span) computeShow(span.start, span.end, '[]');
        break;
      }
      default:
        break;
    }

    operands.length = 0;
  }

  return ops;
}

// ---- ページ書き戻し --------------------------------------------------------

const LATIN1 = new TextDecoder('latin1');

function latin1ToBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

function decodeStream(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  const anyStream = stream as unknown as { getUnencodedContents?: () => Uint8Array };
  if (typeof anyStream.getUnencodedContents === 'function') return anyStream.getUnencodedContents();
  return new Uint8Array();
}

/** ページの全コンテンツストリームを 1 本の latin1 文字列へ連結して返す。 */
function readPageContent(pdfDoc: PDFDocument, pageIndex: number): string {
  const page = pdfDoc.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return '';

  if (contents instanceof PDFArray) {
    const parts: string[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const looked = pdfDoc.context.lookup(contents.get(i));
      if (looked instanceof PDFStream) parts.push(LATIN1.decode(decodeStream(looked)));
    }
    return parts.join('\n');
  }
  if (contents instanceof PDFStream) return LATIN1.decode(decodeStream(contents));
  return '';
}

/** 連結済みの新コンテンツでページの Contents を 1 本のストリームに置き換える。 */
function writePageContent(pdfDoc: PDFDocument, pageIndex: number, content: string): void {
  const page = pdfDoc.getPage(pageIndex);
  const stream = pdfDoc.context.flateStream(latin1ToBytes(content));
  const ref: PDFRef = pdfDoc.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}

export interface RedactionResult {
  /** ストリームから除去できた対象 */
  removed: RecognizedTextItem[];
  /** マッチできず除去を保証できなかった対象 */
  unmatched: RecognizedTextItem[];
}

/** テスト用の内部関数公開（本番コードからは使用しない）。 */
export const __testing = { tokenize, collectShowOps };

// マッチング許容値（ページ空間 pt）
const ORIGIN_TOLERANCE = 2;
const FONT_SIZE_TOLERANCE_RATIO = 0.25;
const FONT_SIZE_TOLERANCE_MIN = 1.5;

function normalizeText(s: string): string {
  return s.trim();
}

function originDistance(op: ShowOp, target: RecognizedTextItem): number {
  return Math.hypot(op.origin.x - target.x, op.origin.y - target.y);
}

function geometryScore(op: ShowOp, target: RecognizedTextItem): number | null {
  const d = originDistance(op, target);
  if (d > ORIGIN_TOLERANCE) return null;
  const sizeTol = Math.max(FONT_SIZE_TOLERANCE_MIN, target.fontSize * FONT_SIZE_TOLERANCE_RATIO);
  if (Math.abs(op.fontSize - target.fontSize) > sizeTol) return null;
  return d;
}

/**
 * 対象テキストのバウンディングボックス内に原点を持つ show-op か判定する。
 * 同一ベースライン上で対象の横幅に収まる断片（分割OCRレイヤー等）を拾うために使う。
 */
function withinTargetBox(op: ShowOp, target: RecognizedTextItem): boolean {
  const xMin = target.x - ORIGIN_TOLERANCE;
  const xMax = target.x + target.width + ORIGIN_TOLERANCE;
  const yTol = Math.max(FONT_SIZE_TOLERANCE_MIN, target.fontSize * 0.5);
  return (
    op.origin.x >= xMin &&
    op.origin.x <= xMax &&
    Math.abs(op.origin.y - target.y) <= yTol
  );
}

/**
 * 対象テキストに対応する show-op 群を選ぶ。
 *
 * 1. 文字列一致（簡易フォントで復号可能な場合）を最優先する。これにより
 *    同一 BT 内で複数回 Tj するPDF（テキスト行列を前進させていないため原点が
 *    重複する）でも、別要素を誤って消すことなく目的の文字列を選べる。
 * 2. 復号できない（CID等）場合は原点＋サイズの幾何一致にフォールバックする。
 * 3. さらに、対象 bbox 内に収まり対象文字列の部分文字列となる断片オペランドを
 *    まとめて対象にする。これにより「可視 SECRET ＋ 不可視レイヤーで SEC / RET と
 *    分割描画」のような分割OCRレイヤーでも、断片を取り残さず除去できる。
 * いずれも、同じ位置に重なる複製（隠しOCRレイヤー等）をまとめて対象にする。
 */
function selectOpsForTarget(
  showOps: ShowOp[],
  used: Set<ShowOp>,
  target: RecognizedTextItem,
): ShowOp[] {
  const available = showOps.filter((op) => !used.has(op));
  const wanted = normalizeText(target.text);

  let primary: ShowOp[];
  const textMatches = available.filter(
    (op) => op.decodedText !== null && normalizeText(op.decodedText) === wanted,
  );
  if (textMatches.length > 0) {
    // 文字列が一致する候補のうち、対象原点に最も近いものと、それと同じ位置に
    // 重なる複製（原点差が許容値以内）をまとめて返す。
    const minDist = Math.min(...textMatches.map((op) => originDistance(op, target)));
    primary = textMatches.filter((op) => originDistance(op, target) <= minDist + ORIGIN_TOLERANCE);
  } else {
    const geo = available
      .map((op) => ({ op, score: geometryScore(op, target) }))
      .filter((x): x is { op: ShowOp; score: number } => x.score !== null);
    if (geo.length === 0) return [];
    const minScore = Math.min(...geo.map((x) => x.score));
    primary = geo.filter((x) => x.score <= minScore + 0.5).map((x) => x.op);
  }

  if (primary.length === 0) return primary;

  // 対象 bbox 内の断片（部分文字列）を追加で回収する。同一ベースライン・対象の
  // 横幅内に限定し、対象文字列の部分文字列である復号可能オペランドのみを対象とする
  // ため、隣接する無関係な語を巻き込まない。
  if (wanted.length === 0) return primary;
  const primarySet = new Set(primary);
  const fragments = available.filter(
    (op) =>
      !primarySet.has(op) &&
      op.decodedText !== null &&
      normalizeText(op.decodedText).length > 0 &&
      wanted.includes(normalizeText(op.decodedText)) &&
      withinTargetBox(op, target),
  );

  return fragments.length > 0 ? [...primary, ...fragments] : primary;
}

/**
 * 指定ページのコンテンツストリームから対象テキストの描画オペランドを除去する。
 * pdfDoc を直接変更し、どれを除去できたか / できなかったかを返す。
 * pageIndex は元PDF基準（ページ並び替え前に適用すること）。
 */
export function redactTextFromPage(
  pdfDoc: PDFDocument,
  pageIndex: number,
  targets: RecognizedTextItem[],
): RedactionResult {
  const removed: RecognizedTextItem[] = [];
  const unmatched: RecognizedTextItem[] = [];
  if (targets.length === 0) return { removed, unmatched };

  const content = readPageContent(pdfDoc, pageIndex);
  if (!content) {
    return { removed, unmatched: [...targets] };
  }

  const showOps = collectShowOps(content);
  const usedOps = new Set<ShowOp>();
  // 置換範囲（重複しない範囲を後ろから適用）
  const edits: { start: number; end: number; replacement: string }[] = [];

  for (const target of targets) {
    const selected = selectOpsForTarget(showOps, usedOps, target);
    if (selected.length > 0) {
      for (const op of selected) {
        usedOps.add(op);
        edits.push({ start: op.operandStart, end: op.operandEnd, replacement: op.empty });
      }
      removed.push(target);
    } else {
      unmatched.push(target);
    }
  }

  if (edits.length === 0) return { removed, unmatched };

  edits.sort((a, b) => b.start - a.start);
  let next = content;
  for (const e of edits) {
    next = next.slice(0, e.start) + e.replacement + next.slice(e.end);
  }

  writePageContent(pdfDoc, pageIndex, next);
  return { removed, unmatched };
}
