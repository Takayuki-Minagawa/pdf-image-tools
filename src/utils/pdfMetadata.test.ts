import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyPdfMetadata, isSameMetadata, readPdfInfo, EMPTY_PDF_METADATA } from './pdfMetadata';

async function pdfWithInfo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle('Old title');
  doc.setAuthor('Someone');
  doc.setKeywords(['alpha']);
  return doc.save();
}

describe('pdf metadata', () => {
  it('reads document properties', async () => {
    const info = await readPdfInfo(await pdfWithInfo());
    expect(info).toMatchObject({ title: 'Old title', author: 'Someone', keywords: 'alpha', subject: '' });
    expect(info.creationDate).toMatch(/^\d{4}-/);
  });

  it('updates, keeps and removes properties', async () => {
    const updated = await applyPdfMetadata(await pdfWithInfo(), {
      title: ' 月次報告 ',
      author: '',
      keywords: '予算, 2026 年度',
    });
    const info = await readPdfInfo(updated);
    expect(info.title).toBe('月次報告');
    expect(info.author).toBe('');
    expect(info.keywords).toBe('予算, 2026 年度');
    const doc = await PDFDocument.load(updated);
    expect(doc.getAuthor()).toBeUndefined();
  });

  it('compares metadata ignoring surrounding whitespace', () => {
    expect(isSameMetadata(EMPTY_PDF_METADATA, { ...EMPTY_PDF_METADATA, title: '  ' })).toBe(true);
    expect(isSameMetadata(EMPTY_PDF_METADATA, { ...EMPTY_PDF_METADATA, title: 'x' })).toBe(false);
  });
});
