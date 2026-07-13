import {
  PDFContext,
  PDFDocument,
  PDFObjectCopier,
  PDFStreamWriter,
} from 'pdf-lib';

/**
 * PDFカタログから到達できるオブジェクトだけを新しいContextへコピーして保存する。
 * 文書レベル構造を保ちつつ、差し替え・削除後の孤児オブジェクトを出力から除外する。
 */
export async function saveReachablePdfDocument(pdfDoc: PDFDocument): Promise<Uint8Array> {
  const context = PDFContext.create();
  const copier = PDFObjectCopier.for(pdfDoc.context, context);
  context.trailerInfo.Root = context.register(copier.copy(pdfDoc.catalog));

  const sourceInfo = pdfDoc.context.trailerInfo.Info;
  if (sourceInfo) {
    const info = pdfDoc.context.lookup(sourceInfo);
    if (info) context.trailerInfo.Info = context.register(copier.copy(info));
  }
  const sourceId = pdfDoc.context.trailerInfo.ID;
  if (sourceId) context.trailerInfo.ID = copier.copy(sourceId);

  return PDFStreamWriter.forContext(context, 50, true, 50).serializeToBuffer();
}
