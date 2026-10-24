export function throwIfAborted(signal: AbortSignal | undefined, message = 'Operation cancelled'): void {
  if (signal?.aborted) throw new DOMException(message, 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** 次の描画フレームまで待ち、重い逐次処理の間にUIを更新させる。 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
