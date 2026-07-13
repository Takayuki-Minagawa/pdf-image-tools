import {
  PDFContext,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFStreamWriter,
} from 'pdf-lib';

function pruneOrphanedAcroFormWidgets(pdfDoc: PDFDocument) {
  if (!pdfDoc.catalog.has(PDFName.of('AcroForm'))) return;

  const pageRefs = new Set(pdfDoc.getPages().map((page) => page.ref.toString()));
  const form = pdfDoc.getForm();
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    for (let index = widgets.length - 1; index >= 0; index--) {
      const pageRef = widgets[index].P();
      if (pageRef && !pageRefs.has(pageRef.toString())) {
        field.acroField.removeWidget(index);
      }
    }
    if (field.acroField.getWidgets().length === 0) {
      form.acroForm.removeField(field.acroField);
    }
  }
}

/**
 * PDFカタログから到達できるオブジェクトだけを新しいContextへコピーして保存する。
 * 文書レベル構造を保ちつつ、差し替え・削除後の孤児オブジェクトを出力から除外する。
 */
export async function saveReachablePdfDocument(pdfDoc: PDFDocument): Promise<Uint8Array> {
  pruneOrphanedAcroFormWidgets(pdfDoc);
  await pdfDoc.flush();

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
