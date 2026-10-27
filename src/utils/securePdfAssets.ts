import { PDFWorker } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { ensurePdfjsWorker } from './pdfjsWorker';

let preparation: Promise<Partial<DocumentInitParameters>> | undefined;

/** All network work happens before a confidential file can be selected. */
export function prepareSecurePdfAssets(): Promise<Partial<DocumentInitParameters>> {
  if (preparation) return preparation;
  preparation = prepare().catch(() => {
    preparation = undefined;
    throw new Error('処理用データを準備できません。通信を確認して画面を開き直してください。');
  });
  return preparation;
}

async function prepare(): Promise<Partial<DocumentInitParameters>> {
  const base = `${import.meta.env.BASE_URL}pdfjs-assets/`;
  const response = await fetch(`${base}manifest.json`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('asset manifest unavailable');
  const manifest: unknown = await response.json();
  if (!Array.isArray(manifest) || manifest.length === 0 || manifest.some((path) =>
    typeof path !== 'string' || !/^(cmaps|standard_fonts|wasm)\/[\w.-]+$/.test(path))) {
    throw new Error('invalid asset manifest');
  }
  const assets = new Map<string, Uint8Array>();
  // Bound concurrency; resources are public program assets, never user input.
  let index = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (index < manifest.length) {
      const path = manifest[index++] as string;
      const resource = await fetch(`${base}${path}`, { credentials: 'same-origin' });
      if (!resource.ok) throw new Error('asset unavailable');
      assets.set(path, new Uint8Array(await resource.arrayBuffer()));
    }
  }));
  const read = (path: string) => {
    const value = assets.get(path);
    if (!value) throw new Error('必要な描画データがありません。処理を中止しました。');
    // Worker transfers must not detach the cached copy.
    return value.slice();
  };
  class MemoryCMaps {
    async fetch({ name }: { name: string }) {
      return { cMapData: read(`cmaps/${name}.bcmap`), isCompressed: true };
    }
  }
  class MemoryFonts {
    async fetch({ filename }: { filename: string }) { return read(`standard_fonts/${filename}`); }
  }
  class MemoryWasm {
    async fetch({ filename }: { filename: string }) { return read(`wasm/${filename}`); }
  }
  ensurePdfjsWorker();
  const worker = new PDFWorker();
  await worker.promise;
  return {
    worker,
    CMapReaderFactory: MemoryCMaps,
    StandardFontDataFactory: MemoryFonts,
    WasmFactory: MemoryWasm,
    useWorkerFetch: false,
    cMapPacked: true,
    useSystemFonts: false,
    isEvalSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  };
}
