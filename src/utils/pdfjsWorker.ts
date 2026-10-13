import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * ブラウザで pdf.js の Worker を1度だけ設定する。
 * Node（CLI）では pdf.js 自身が同梱の worker を解決するため、vite.cli.config.ts で
 * このモジュールを no-op 実装へ差し替える。
 */
export function ensurePdfjsWorker() {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }
}
