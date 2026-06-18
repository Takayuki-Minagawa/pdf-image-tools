/**
 * Node 20.19 未満では pdfjs-dist の legacy ビルドが起動時に `new DOMMatrix()` 等を
 * 評価するため import 時点で ReferenceError になる（`process.getBuiltinModule` が無く
 * canvas polyfill に失敗するため）。テキスト/オペレータ抽出はキャンバス描画を行わず
 * これらの実体を使わないので、未定義時のみ最小スタブを与えて import を通す。
 *
 * いずれも globalThis に未定義の場合だけ補完するため、要件を満たす新しい Node では無害。
 */
type AnyCtor = new (...args: unknown[]) => unknown;

const g = globalThis as Record<string, unknown>;

if (typeof g.DOMMatrix === 'undefined') {
  // SCALE_MATRIX = new DOMMatrix() などモジュール初期化の評価を通すための空スタブ。
  g.DOMMatrix = class DOMMatrixStub {} as AnyCtor;
}
if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageDataStub {} as AnyCtor;
}
if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2DStub {} as AnyCtor;
}
