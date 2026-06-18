/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/pdf-image-tools/',
  test: {
    environment: 'node',
    setupFiles: ['./src/test/pdfjsNodePolyfill.ts'],
    alias: [
      // Node には DOMMatrix が無いため、テスト実行時のみ pdfjs の legacy ビルドへ差し替える
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
    ],
  },
})
