/**
 * redact（完全削除）の事後検証。
 *
 * コンテンツストリームからの除去は「原点＋サイズ／文字列」によるマッチングのため、
 * 隠しOCRレイヤーや重複テキスト等で別オペランドを空にしてしまい、対象文字列が
 * 抽出可能なまま残るサイレント失敗があり得る。そこで redact 後の最終バイト列を
 * pdf.js で再抽出し、対象位置に同じ文字列が残っていないかを実測で確認する。
 * 残っていれば「除去を保証できなかった対象」として呼び出し側へ返す。
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RecognizedTextItem } from '../types/contentEdit';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

// 元の認識位置（ベースライン原点）と再抽出位置の許容差（pt）
const POSITION_TOLERANCE = 4;

function normalize(s: string): string {
  return s.trim();
}

interface TextContentLike {
  str?: string;
  transform?: number[];
}

/**
 * redact 適用後のバイト列を再抽出し、まだ抽出できてしまう対象を返す。
 * 検証自体に失敗した場合は安全側に倒し、全対象を「保証できなかった」として返す。
 */
export async function findResidualRedactions(
  bytes: Uint8Array,
  targets: RecognizedTextItem[],
): Promise<RecognizedTextItem[]> {
  if (targets.length === 0) return [];

  let doc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
  try {
    doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  } catch {
    return [...targets];
  }

  try {
    const byPage = new Map<number, RecognizedTextItem[]>();
    for (const t of targets) {
      const list = byPage.get(t.pageIndex) ?? [];
      list.push(t);
      byPage.set(t.pageIndex, list);
    }

    const residual: RecognizedTextItem[] = [];
    for (const [pageIndex, pageTargets] of byPage) {
      if (pageIndex < 0 || pageIndex >= doc.numPages) {
        residual.push(...pageTargets);
        continue;
      }
      const page = await doc.getPage(pageIndex + 1);
      const tc = await page.getTextContent();
      const items = (tc.items as TextContentLike[]).filter(
        (i): i is { str: string; transform: number[] } =>
          typeof i.str === 'string' && i.str.trim() !== '' && Array.isArray(i.transform),
      );

      for (const target of pageTargets) {
        const wanted = normalize(target.text);
        const stillThere = items.some((it) => {
          if (normalize(it.str) !== wanted) return false;
          const e = it.transform[4];
          const f = it.transform[5];
          return Math.hypot(e - target.x, f - target.y) <= POSITION_TOLERANCE;
        });
        if (stillThere) residual.push(target);
      }
    }
    return residual;
  } catch {
    return [...targets];
  } finally {
    await doc.destroy();
  }
}
