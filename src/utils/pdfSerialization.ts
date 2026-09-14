import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  PDFStreamWriter,
} from 'pdf-lib';

function pruneOrphanedAcroFormWidgets(pdfDoc: PDFDocument) {
  if (!pdfDoc.catalog.has(PDFName.of('AcroForm'))) return;

  // PDFDocument#getPages() is cached by pdf-lib and is not invalidated by
  // removePage(). Traverse the active page tree instead so a deleted page's
  // widgets are reliably removed from the form.
  const pageRefs = new Set<string>();
  pdfDoc.catalog.Pages().traverse((_node, pageRef) => pageRefs.add(pageRef.toString()));
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
 *
 * PDFObjectCopier はページ単体コピー向けに /Parent を除去するため、カタログ全体の
 * コピー後に出力ページツリーの親参照を復元する。これを行わないと Acrobat は
 * ページツリーを破損として扱うことがある。
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

  restorePageTreeParents(context);
  return PDFStreamWriter.forContext(context, 50, true, 50).serializeToBuffer();
}

function restorePageTreeParents(context: PDFContext) {
  const catalog = context.lookup(context.trailerInfo.Root, PDFDict);
  const pageTreeRef = catalog.get(PDFName.of('Pages'));
  if (!(pageTreeRef instanceof PDFRef)) return;

  const restoreChildren = (parentRef: PDFRef) => {
    const parent = context.lookup(parentRef, PDFDict);
    const kids = parent.lookup(PDFName.of('Kids'), PDFArray);

    for (let index = 0; index < kids.size(); index++) {
      const childRef = kids.get(index);
      if (!(childRef instanceof PDFRef)) continue;

      const child = context.lookup(childRef, PDFDict);
      child.set(PDFName.of('Parent'), parentRef);
      if (child.has(PDFName.of('Kids'))) restoreChildren(childRef);
    }
  };

  restoreChildren(pageTreeRef);
}
