import JSZip from 'jszip';

const MAX_ZIP_INPUT_BYTES = 300 * 1024 * 1024;

export function sanitizeFilename(value: string, fallback: string) {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
    .replace(/\.+$/g, '')
    .slice(0, 160);
  return sanitized || fallback;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function dataUrlToBytes(dataUrl: string) {
  const [metadata, encoded] = dataUrl.split(',');
  if (!metadata || encoded === undefined) throw new Error('画像データを読み取れません');
  if (metadata.includes(';base64')) {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(encoded));
}

export async function downloadDataUrlsAsZip(
  files: Array<{ filename: string; dataUrl: string }>,
  filename: string,
  onProgress?: (progress: number) => void,
) {
  const estimatedBytes = files.reduce((total, file) => total + Math.ceil(file.dataUrl.length * 0.75), 0);
  if (estimatedBytes > MAX_ZIP_INPUT_BYTES) {
    throw new Error('ZIP対象が300MBを超えます。ページ範囲または解像度を小さくしてください。');
  }
  const zip = new JSZip();
  files.forEach((file, index) => {
    zip.file(file.filename, dataUrlToBytes(file.dataUrl));
    onProgress?.(((index + 1) / Math.max(files.length, 1)) * 25);
  });

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => onProgress?.(25 + percent * 0.75),
  );
  downloadBlob(blob, filename.endsWith('.zip') ? filename : `${filename}.zip`);
  return blob.size;
}

export async function downloadBinaryFilesAsZip(
  files: Array<{ filename: string; data: Blob | ArrayBuffer | Uint8Array }>,
  filename: string,
  onProgress?: (progress: number) => void,
) {
  const totalBytes = files.reduce((total, file) => {
    if (file.data instanceof Blob) return total + file.data.size;
    return total + file.data.byteLength;
  }, 0);
  if (totalBytes > MAX_ZIP_INPUT_BYTES) {
    throw new Error('ZIP対象が300MBを超えます。ファイル数を減らして分割実行してください。');
  }
  const zip = new JSZip();
  files.forEach((file) => zip.file(file.filename, file.data));
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => onProgress?.(percent),
  );
  downloadBlob(blob, filename.endsWith('.zip') ? filename : `${filename}.zip`);
  return blob.size;
}

export function dataUrlToBlob(dataUrl: string) {
  const bytes = dataUrlToBytes(dataUrl);
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';')) || 'application/octet-stream';
  return new Blob([bytes], { type: mimeType });
}
