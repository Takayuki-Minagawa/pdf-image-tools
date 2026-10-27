/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pdfjsAssets } from './scripts/pdfjsAssets'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  base: '/pdf-image-tools/',
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    environment: 'node',
    setupFiles: ['./src/test/pdfjsNodePolyfill.ts'],
    alias: [
      // Node には DOMMatrix が無いため、テスト実行時のみ pdfjs の legacy ビルドへ差し替える
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
    ],
  },
})
