import { expect, test } from '@playwright/test';
import { syntheticDrawing } from './fixtures';

test('leaving an old tool cancels its pending output permanently and a new batch still succeeds', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pdf-image-tools.guide-seen', 'true');
    localStorage.setItem('pdf-image-tools:recipes:v1', JSON.stringify([{
      version: 2, id: 'boundary', name: 'boundary', textBoxes: [{ text: 'TEST', x: 10, y: 10, pageIndex: 0 }],
    }]));
  });
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let fontRequested!: () => void;
  const requested = new Promise<void>((resolve) => { fontRequested = resolve; });
  let first = true;
  await page.route('**/fonts/NotoSansJP.ttf', async (route) => {
    if (first) { first = false; fontRequested(); await paused; }
    await route.continue();
  });
  await page.goto('#batch');
  const input = { name: 'synthetic-previous-session.pdf', mimeType: 'application/pdf', buffer: await syntheticDrawing() };
  await page.locator('input[type=file]').setInputFiles(input);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'バッチ処理を開始' }).click();
  await requested;
  await page.locator('#tab-region-redact').click();
  await expect(page.locator('#region-source-file')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#panel-batch')).toHaveCount(0);
  // Return before the old operation finishes: a global mode flag alone is insufficient.
  await page.locator('#tab-batch').click();
  await expect(page.getByRole('button', { name: 'バッチ処理を開始' })).toBeDisabled();
  release();
  await page.waitForTimeout(1500);
  expect(downloads).toEqual([]);

  await page.locator('input[type=file]').setInputFiles(input);
  const completed = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バッチ処理を開始' }).click();
  await completed;
  await expect(page.getByRole('status')).toContainText('ZIPを保存しました');
  expect(downloads).toEqual(['pdf-batch-results.zip']);
});
