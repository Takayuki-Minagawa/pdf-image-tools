import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

/** Entirely synthetic: never use customer PDFs in automated or computer-use tests. */
export async function syntheticDrawing(mixed = false) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('SYNTHETIC PRIVATE TITLE');
  pdf.setAuthor('SYNTHETIC PRIVATE AUTHOR');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < (mixed ? 3 : 2); index++) {
    const page = pdf.addPage([400, 300]);
    page.drawRectangle({ x: 10, y: 10, width: 380, height: 280, borderColor: rgb(0, 0, 0), borderWidth: 0.4 });
    page.drawText('SYNTHETIC TITLE BLOCK', { x: 20, y: 265, size: 12, font });
    page.drawText(`KEEP DRAWING ${index + 1}`, { x: 100, y: 120, size: 16, font });
    page.drawRectangle({ x: 20, y: 245, width: 40, height: 10, color: rgb(0.8, 0.1, 0.1) });
    page.drawLine({ start: { x: 20, y: 265 }, end: { x: 220, y: 265 }, thickness: 0.5, color: rgb(0, 0, 1) });
    if (mixed && index === 2) page.setRotation(degrees(90));
  }
  const field = pdf.getForm().createTextField('SYNTHETIC PRIVATE FIELD');
  field.setText('FORM VALUE');
  field.addToPage(pdf.getPages()[0], { x: 250, y: 50, width: 100, height: 20 });
  const note = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('PRIVATE NOTE') });
  pdf.getPages()[1].node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(note)]));
  await pdf.attach(new TextEncoder().encode('SYNTHETIC ATTACHMENT'), 'private.txt');
  return Buffer.from(await pdf.save());
}
