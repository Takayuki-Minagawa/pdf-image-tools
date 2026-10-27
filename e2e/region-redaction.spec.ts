import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, rgb } from 'pdf-lib';
import { syntheticDrawing } from './fixtures';

async function openPreprocessor(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pdf-image-tools.guide-seen', 'true'));
  await page.goto('#region-redact');
  await expect(page.locator('#region-source-file')).toBeEnabled({ timeout: 30_000 });
}

async function addTitleRegion(page: Page, range = 'all') {
  await page.locator('#region-x').fill('0');
  await page.locator('#region-y').fill('0');
  await page.locator('#region-width').fill('85');
  await page.locator('#region-height').fill('20');
  await page.locator('#region-pages').fill(range);
  await page.locator('#region-add').click();
  await page.locator('#region-dpi').selectOption('72');
}

test('offline local processing, every-page approval, minimal output and clean handoff', async ({ page, context }) => {
  const original = await syntheticDrawing();
  await page.addInitScript(() => localStorage.setItem('pdf-image-tools.guide-seen', 'true'));
  await page.goto('#pdf-edit');
  await expect(page.getByRole('tab', { name: 'PDF編集', exact: true })).toBeVisible();
  // A previous editor draft must disappear before confidential loading is enabled.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pdf-image-tools', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ id: 'pdf-editor-latest', savedAt: Date.now(), fileName: 'SYNTHETIC_OLD.pdf' });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.locator('#tab-region-redact').click();
  await expect(page.locator('#region-source-file')).toBeEnabled({ timeout: 30_000 });
  const network: string[] = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url())) network.push(`${request.method()} ${request.url()}`); });
  await context.setOffline(true);
  await page.locator('#region-source-file').setInputFiles({ name: 'SYNTHETIC_PRIVATE.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.locator('#region-process')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('SYNTHETIC_PRIVATE.pdf');
  await addTitleRegion(page);
  await page.locator('#region-process').click();
  await expect(page.locator('#region-review-page')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#region-save-approved')).toBeDisabled();
  await expect(page.locator('#region-approval')).toBeDisabled();
  await page.locator('#region-review-page').click();
  await page.locator('#region-page').selectOption('2');
  await expect(page.locator('#region-review-page')).toBeEnabled();
  await page.locator('#region-review-page').click();
  await page.locator('#region-approval').check();
  const colors = await page.locator('#region-save-approved').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  expect(colors[0]).not.toBe(colors[1]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#region-save-approved').click()]);
  expect(download.suggestedFilename()).toBe('approved.pdf');
  const bytes = await readFile((await download.path())!);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[400, 300], [400, 300]]);
  expect(pdf.getTitle()).toBeUndefined();
  expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  expect(pdf.catalog.has(PDFName.of('Names'))).toBe(false);
  expect(bytes.includes(Buffer.from('SYNTHETIC PRIVATE'))).toBe(false);
  const [reportDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '検証レポートを保存' }).click()]);
  const reportText = await readFile((await reportDownload.path())!, 'utf8');
  const report = JSON.parse(reportText);
  expect(report.outputSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(report.approval).toBe('human-reviewed');
  expect(reportText).not.toContain('SYNTHETIC');
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('pdf-image-tools'); r.onsuccess = () => resolve(r.result); });
    const count = await new Promise<number>((resolve) => { const r = db.transaction('drafts').objectStore('drafts').count(); r.onsuccess = () => resolve(r.result); });
    db.close(); return count;
  });
  expect(stored).toBe(0);
  expect(network).toEqual([]);
  await page.screenshot({ path: 'test-results/approved-review.png', fullPage: true });
  // Restore networking for the ordinary editor's lazy UI modules only, after the approval boundary.
  await context.setOffline(false);
  await page.locator('#region-approved-handoff').click();
  await expect(page.locator('#tab-pdf-edit')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#region-source-file')).toHaveCount(0);
  await expect(page.getByText('approved.pdf', { exact: true }).first()).toBeVisible();
  await page.locator('#tab-region-redact').click();
  await expect(page.locator('#region-source-file')).toBeEnabled();
  await expect(page.locator('#region-process')).toHaveCount(0);
});

test('mixed paper exception, explicit exclusion, Undo/Redo, and settings-only template', async ({ page }) => {
  await openPreprocessor(page);
  await page.locator('#region-source-file').setInputFiles({ name: 'mixed.pdf', mimeType: 'application/pdf', buffer: await syntheticDrawing(true) });
  await expect(page.locator('#region-process')).toBeVisible();
  await addTitleRegion(page);
  await expect(page.getByText('用紙条件が一致しない例外ページがあります。処理は停止しています。')).toBeVisible();
  await expect(page.locator('#region-process')).toBeDisabled();
  await page.getByRole('button', { name: 'この領域の対象から除外' }).click();
  await expect(page.locator('#region-process')).toBeEnabled();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#region-process')).toBeDisabled();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.locator('#region-process')).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'テンプレートを書出し' }).click()]);
  const template = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(template.version).toBe(3);
  expect(template.regionRedaction.regions[0].pages).toEqual([1, 2]);
  expect(JSON.stringify(template)).not.toContain('mixed.pdf');
  await page.locator('#region-process').click();
  await expect(page.locator('#region-review-page')).toBeEnabled({ timeout: 30_000 });
  // Editing even an uncommitted number invalidates an already verified candidate.
  await page.locator('#region-width').fill('80');
  await expect(page.locator('#region-save-approved')).toHaveCount(0);
});

test('cancellation never offers an approved file', async ({ page }) => {
  await openPreprocessor(page);
  await page.locator('#region-source-file').setInputFiles({ name: 'cancel.pdf', mimeType: 'application/pdf', buffer: await syntheticDrawing() });
  await expect(page.locator('#region-process')).toBeVisible();
  await addTitleRegion(page);
  await page.locator('#region-dpi').selectOption('600');
  await page.locator('#region-process').click();
  await page.locator('#region-cancel').click();
  await expect(page.locator('#region-status')).toContainText('処理を中止しました', { timeout: 30_000 });
  await expect(page.locator('#region-save-approved')).toHaveCount(0);
  await expect(page.locator('#region-process')).toBeEnabled();
});

test('missing preparation assets block original loading', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pdf-image-tools.guide-seen', 'true'));
  await page.route('**/pdfjs-assets/manifest.json', (route) => route.abort());
  await page.goto('#region-redact');
  await expect(page.locator('#region-status')).toContainText('失敗');
  await expect(page.locator('#region-source-file')).toBeDisabled();
});

test('production service worker caches only program assets and preprocessing works offline', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('pdf-image-tools.guide-seen', 'true'));
    await page.goto('http://127.0.0.1:4173/pdf-image-tools/#region-redact');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect(page.locator('#region-source-file')).toBeEnabled({ timeout: 30_000 });
    const requests: string[] = [];
    context.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await context.setOffline(true);
    await page.locator('#region-source-file').setInputFiles({ name: 'PRIVATE-SW.pdf', mimeType: 'application/pdf', buffer: await syntheticDrawing() });
    await expect(page.locator('#region-process')).toBeEnabled();
    await addTitleRegion(page);
    await page.locator('#region-process').click();
    await expect(page.locator('#region-review-page')).toBeEnabled({ timeout: 30_000 });
    expect(requests).toEqual([]);
    const cacheKeys = await page.evaluate(async () => {
      const result: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        result.push(...(await cache.keys()).map((request) => request.url));
      }
      return result;
    });
    expect(cacheKeys.length).toBeGreaterThan(0);
    expect(cacheKeys.every((key) => !/PRIVATE|\.pdf($|\?)/i.test(key))).toBe(true);
  } finally { await context.close(); }
});

test('pointer region selection and narrow-screen controls remain operable', async ({ page }) => {
  await openPreprocessor(page);
  await page.locator('#region-source-file').setInputFiles({ name: 'drawing.pdf', mimeType: 'application/pdf', buffer: await syntheticDrawing() });
  const overlay = page.locator('svg[aria-label^="領域指定プレビュー"]');
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator('#region-x').inputValue())).toBeCloseTo(40 * 25.4 / 72, 1);
  expect(Number(await page.locator('#region-width').inputValue())).toBeCloseTo(160 * 25.4 / 72, 1);
  await page.locator('#region-add').click();
  await expect(page.getByText('確定した除去領域（1）')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: '領域除去', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#region-width').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#region-height')).toBeFocused();
  await page.screenshot({ path: 'test-results/mobile-region.png', fullPage: true });
});

test('fractional CropBox never includes pixels from outside the visible page', async ({ page }) => {
  const pdf = await PDFDocument.create();
  const sourcePage = pdf.addPage([110, 110]);
  sourcePage.setCropBox(0, 20, 100.1, 80.1);
  sourcePage.drawRectangle({ x: 100.2, y: 20, width: 0.8, height: 80, color: rgb(0, 0, 0) });
  sourcePage.drawRectangle({ x: 0, y: 19.1, width: 100, height: 0.8, color: rgb(0, 0, 0) });
  await openPreprocessor(page);
  await page.locator('#region-source-file').setInputFiles({ name: 'crop.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('#region-process')).toBeEnabled();
  await page.locator('#region-dpi').selectOption('72');
  await page.locator('#region-process').click();
  await expect(page.locator('#region-review-page')).toBeEnabled();
  await page.locator('#region-review-page').click();
  await page.locator('#region-approval').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#region-save-approved').click()]);
  const output = await PDFDocument.load(await readFile((await download.path())!), { updateMetadata: false });
  const objects = output.getPage(0).node.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  const image = objects.lookup(objects.keys()[0], PDFRawStream);
  expect(decodePDFRawStream(image).decode().every((value) => value === 255)).toBe(true);
  expect(output.getPage(0).getSize()).toEqual({ width: 100.1, height: 80.1 });
});
