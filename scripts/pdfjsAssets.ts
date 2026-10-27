import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Ship the pinned PDF.js resources and their licenses from node_modules. */
export function pdfjsAssets(): Plugin {
  const root = new URL('../node_modules/pdfjs-dist/', import.meta.url);
  const assets = new Map<string, Uint8Array>();
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(new URL(`${directory}/`, root))) {
      assets.set(`${directory}/${name}`, readFileSync(new URL(`${directory}/${name}`, root)));
    }
  }
  assets.set('LICENSE', readFileSync(new URL('LICENSE', root)));
  const manifest = JSON.stringify([...assets.keys()].filter((path) => /\.(bcmap|pfb|ttf|wasm)$/.test(path)));
  return {
    name: 'local-pdfjs-resources',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0].match(/\/(?:pdfjs-assets)\/(.+)$/)?.[1];
        if (!path) return next();
        if (path === 'manifest.json') {
          response.setHeader('Content-Type', 'application/json');
          response.end(manifest);
        } else if (assets.has(path)) {
          response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.end(assets.get(path));
        } else {
          response.statusCode = 404;
          response.end();
        }
      });
    },
    generateBundle() {
      for (const [path, bytes] of assets) {
        this.emitFile({ type: 'asset', fileName: `pdfjs-assets/${path}`, source: bytes });
      }
      this.emitFile({ type: 'asset', fileName: 'pdfjs-assets/manifest.json', source: manifest });
    },
  };
}
