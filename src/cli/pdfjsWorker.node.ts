/**
 * Node（CLI バンドル）向けの差し替え実装。pdf.js の legacy ビルドは Node では
 * 同梱の worker を自動的に読み込むため、ブラウザ用の workerSrc 設定は不要。
 * vite.cli.config.ts の alias で src/utils/pdfjsWorker.ts の代わりに使われる。
 */
export function ensurePdfjsWorker() {
  // no-op
}
