/**
 * pdf.js の getDocument に共通で渡す追加オプション。
 * Node（CLI）では標準14フォントのメトリクスを読むために standardFontDataUrl を指定する。
 */
export interface PdfjsDocumentOptions {
  standardFontDataUrl?: string;
}

let documentOptions: PdfjsDocumentOptions = {};

export function setPdfjsDocumentOptions(options: PdfjsDocumentOptions) {
  documentOptions = { ...options };
}

export function getPdfjsDocumentOptions(): PdfjsDocumentOptions {
  return { ...documentOptions };
}
