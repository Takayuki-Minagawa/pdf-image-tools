import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// CLI（Node）向けバンドル。ブラウザ版と同じ src/utils を共有し、dist-cli/ へ出力する。
// 依存パッケージ（pdf-lib, pdfjs-dist, jspdf など）は外部参照のまま残す。
export default defineConfig({
  // public/（PWA 用アセット）は CLI には不要
  publicDir: false,
  resolve: {
    alias: [
      // Node には DOMMatrix / Canvas が無いため、テストと同じく legacy ビルドを使う
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      // ブラウザ用 Worker 設定（?url import）を Node では no-op に差し替える
      { find: /^.*\/pdfjsWorker$/, replacement: fileURLToPath(new URL('./src/cli/pdfjsWorker.node.ts', import.meta.url)) },
    ],
  },
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: 'pdf-image-tools.mjs', format: 'es' },
    },
  },
  ssr: {
    target: 'node',
  },
})
