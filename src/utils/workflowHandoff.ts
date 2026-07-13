const OPEN_EDITOR_EVENT = 'pdf-image-tools:open-editor';
let pendingFile: File | null = null;

export function sendPdfToEditor(data: Blob | Uint8Array | ArrayBuffer, filename: string) {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: 'application/pdf' });
  pendingFile = new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_EVENT));
}

export function consumePendingPdf() {
  const file = pendingFile;
  pendingFile = null;
  return file;
}

export function subscribePdfEditorHandoff(callback: () => void) {
  window.addEventListener(OPEN_EDITOR_EVENT, callback);
  return () => window.removeEventListener(OPEN_EDITOR_EVENT, callback);
}
