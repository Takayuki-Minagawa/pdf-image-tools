let cachedFontBytes: ArrayBuffer | null = null;

export async function loadFontBytes(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const url = `${import.meta.env.BASE_URL}fonts/NotoSansJP.ttf`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('フォントの読み込みに失敗しました');
  cachedFontBytes = await response.arrayBuffer();
  return cachedFontBytes;
}
