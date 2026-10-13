export type FontBytes = ArrayBuffer | Uint8Array;
export type FontBytesSource = () => Promise<FontBytes>;

/** ブラウザ既定: public/fonts から Noto Sans JP を取得する。 */
const browserFontSource: FontBytesSource = async () => {
  const url = `${import.meta.env.BASE_URL}fonts/NotoSansJP.ttf`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('フォントの読み込みに失敗しました');
  return response.arrayBuffer();
};

let fontSource: FontBytesSource = browserFontSource;
let cachedFontBytes: FontBytes | null = null;

/**
 * フォントの取得方法を差し替える（Node / CLI などブラウザ外から利用する場合）。
 * null を渡すとブラウザ既定へ戻す。
 */
export function setFontBytesSource(source: FontBytesSource | null) {
  fontSource = source ?? browserFontSource;
  cachedFontBytes = null;
}

export async function loadFontBytes(): Promise<FontBytes> {
  if (cachedFontBytes) return cachedFontBytes;
  cachedFontBytes = await fontSource();
  return cachedFontBytes;
}
