import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBinaryFilesAsZip, downloadDataUrlsAsZip } from './download';

afterEach(() => vi.unstubAllGlobals());

describe('ZIP cancellation before downloads', () => {
  it('does not download a binary ZIP when its session ends during compression', async () => {
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    const controller = new AbortController();
    await expect(downloadBinaryFilesAsZip([{ filename: 'synthetic.pdf', data: new Uint8Array(100_000).fill(42) }], 'synthetic', () => controller.abort(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(createElement).not.toHaveBeenCalled();
  });

  it('does not download an image ZIP when its session ends during preparation', async () => {
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    const controller = new AbortController();
    await expect(downloadDataUrlsAsZip([{ filename: 'synthetic.png', dataUrl: 'data:image/png;base64,AQID' }], 'synthetic', () => controller.abort(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(createElement).not.toHaveBeenCalled();
  });
});
