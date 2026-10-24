export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function getErrorMessage(error: unknown, fallback = '不明なエラー'): string {
  return error instanceof Error ? error.message : fallback;
}
