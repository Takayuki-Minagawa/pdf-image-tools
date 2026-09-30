# PDF Image Tools

ブラウザ上で動作するPDF・画像変換ツールです。すべての処理はローカルで行われ、ファイルがサーバーにアップロードされることはありません。

## 🔗 デモ

**https://takayuki-minagawa.github.io/pdf-image-tools/**

## 🌟 機能

### 🖼️ 画像 → PDF変換
- 複数の画像（JPG, PNG, GIF, WebP）を1つのPDFに変換
- 画像の順番を変更可能（ドラッグ＆ドロップ / 矢印ボタン / 番号直接指定）
- 順序の一括逆転
- 各画像のサイズ情報を表示
- 個別削除機能

### 📑 PDF結合
- 複数のPDFファイルを1つに結合
- 結合順序の変更（ドラッグ＆ドロップ / 矢印ボタン / 番号直接指定）
- 順序の一括逆転
- 各PDFのページ数とサムネイルを表示
- 合計ページ数の表示

### PDF編集
- **画像・図形・サイン**
  - PNG/JPEG画像・ロゴ・印影を挿入（画像は20 MB・4,000万画素まで、長辺4,096 pxへ最適化）
  - マウスや指で手書きサインを作成し、透明画像として配置
  - 四角形・楕円・直線・矢印・半透明の蛍光マーカーを追加
  - プレビュー上で選択・ドラッグ移動・右下ハンドルでサイズ変更
  - 位置・サイズ・色・線幅・不透明度・対象ページ、複製・削除・重なり順を設定
  - 画像のドラッグ拡縮は縦横比を維持（Shiftで解除）。選択した図形は矢印キーで移動、Shiftで10 pt、Deleteで削除
  - ページ並び替え・削除・複製、Undo/Redo、下書き復元、PDF保存・ページ抽出・画像出力に対応
- **透かし**
  - 「社外秘」「DRAFT」などの文字をページ中央へ追加
  - 日本語、色、文字サイズ、回転角度、不透明度、全ページ／指定ページを設定
- **元PDFのテキスト検索**
  - 現在のページ構成を検索し、結果から該当ページと既存テキストの編集へ移動
  - 大文字小文字を区別しない部分一致、検索中止、先頭200件の表示
  - 追加・置換した文字、画像内の文字、複数のテキスト要素にまたがる語句は検索対象外
- **コンテンツ編集（既存要素の編集）**
  - PDF内の既存テキスト・ライン・ポリライン・ポリゴン・矩形を自動認識
  - プレビュー上でクリックして要素を選択
  - テキスト：内容の置き換え、フォントサイズ・文字色の変更、削除
  - 図形：線色・線幅・塗り色の変更、削除
  - 元の要素をカバー色で塗り潰して上書きする方式（背景が単色でない箇所では塗り潰し跡が残る場合あり）
  - 回転ページ・CropBox原点がずれたページにも対応（曲線を含むパスは対象外）
- **ページ編集**
  - ページの削除
  - ページの並び替え（ドラッグ＆ドロップ）
  - 現在の並び順・編集内容を反映したページ抽出
  - 編集済みPDFを保存
  - 同じ編集結果をオプションでPNG出力
  - 元のPDFをそのままPNG出力する用途にも対応
- **テキストボックス挿入**
  - 枠線スタイル（実線 / 破線 / 点線 / なし）、太さ、色を設定可能
  - 背景色（透明対応）、文字色、フォントサイズ
  - 特定ページまたは全ページに適用
  - プレビュー上クリックで位置を直接指定
  - 日本語テキスト対応（Noto Sans JP フォント埋め込み）
- **ヘッダー / フッター**
  - 左・中央・右の3箇所に配置
  - プレースホルダー対応：ページ番号、総ページ数、日付、ファイル名
  - フォントサイズ、文字色、余白の調整
- **ページ番号**
  - 開始ページの指定（例：3ページ目から番号を振り、1〜2ページは番号なし）
  - 開始番号の指定（例：3ページ目を「1」として開始）
  - 表示形式：数字 / ローマ数字（大文字・小文字） / ダッシュ付き（- 1 -）
  - 6箇所の配置位置（左上・中央上・右上・左下・中央下・右下）
  - 接頭辞・接尾辞のカスタマイズ
- リアルタイムプレビュー
- フォントサブセット埋め込みによる出力サイズ最適化

### 使いやすさ・安全性

- PDF編集のUndo / Redo、操作履歴、未保存警告
- IndexedDBへのローカル下書き自動保存と再開（無効化・削除可能）
- ページの回転、複製、空白ページ挿入、奇数/偶数/範囲選択、任意ページ抽出
- 完全削除に失敗した場合は保存を停止し、残存文字とページを表示
- PNG/JPEG/WebP、解像度、ページ範囲、ZIP一括保存を選べる画像出力
- ファイル単位の読込結果、部分成功、再試行、処理キャンセル
- 大規模PDF向けの遅延サムネイル生成
- 作業レシピの保存・JSON入出力と複数PDFへのバッチ適用
- 変換・結合結果をダウンロードせずPDF編集へ引き渡し
- キーボード操作、スクリーンリーダー、タッチ操作への配慮
- インストール可能なPWAとオフライン起動、更新通知

## 🛠️ 技術スタック

- **フレームワーク**: React 19 + TypeScript
- **ビルドツール**: Vite 7
- **スタイリング**: Tailwind CSS 4
- **PDF処理**:
  - pdfjs-dist（PDF表示・画像変換）
  - pdf-lib（PDF編集・結合）
  - @pdf-lib/fontkit（カスタムフォント埋め込み）
  - jsPDF（画像からPDF作成）
- **アイコン**: Lucide React

## 🚀 セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ビルド
npm run build

# テスト（コンテンツ認識・編集のラウンドトリップ検証）
npm test

# プレビュー
npm run preview

# CLIのヘルプ
npm run cli -- --help
```

## ⌨️ CLI / バッチ処理

ブラウザの「バッチ」タブでは、PDF編集画面で保存したレシピを複数のPDFへ適用し、結果をZIPで保存できます。基本的な変換・ページ操作はCLIからも実行できます。

```bash
npm run cli -- merge combined.pdf cover.pdf body.pdf
npm run cli -- extract report.pdf summary.pdf 1-3,8
npm run cli -- reorder scan.pdf sorted.pdf 3,1,2
npm run cli -- images-to-pdf photos.pdf 001.jpg 002.png
npm run cli -- apply-recipe report.pdf stamped.pdf company-recipe.json
```

ページ指定は1始まりで、`1-3,5,8` のように範囲と個別ページを組み合わせられます。

## 対応環境と注意点

- Node.jsで開発・CLI実行する場合は、Vite 7の要件に合わせてNode.js 20.19以上または22.12以上を推奨します。
- ブラウザ版の処理能力は端末のメモリとCPUに依存します。大容量PDFでは、他のタブを閉じてから処理してください。
- パスワード保護されたPDFは入力したパスワードで開き、編集可能な画像PDFへ端末内で変換します。テキスト層、画質、容量は元PDFと異なる場合があります。
- 完全削除は保存前に文字抽出を再検証します。検証できない場合、既定では保存を停止します。
- 背景が単色でない箇所の置換・削除では、カバーの跡が見える場合があります。
- 下書きとレシピは端末内だけに保存され、外部へ送信されません。共有端末では自動保存を無効にできます。
- 図形・画像・サイン・透かしはページへ描画して保存します。コメント注釈や電子証明書によるデジタル署名ではありません。マーカーや図形で隠した元データは削除されません。
- 追加した図形・画像は表示ページの左上を基準に配置します。全ページ指定ではページサイズごとの自動縮小は行いません。追加後にページを回転した場合、図形・画像・サインも元の内容と一緒に回転します。全ページ対象の図形は、その時点の各ページに個別配置へ切り替わります。
- レシピとCLIの対象は既存のテキストボックス・ヘッダー/フッター・ページ番号です。画像・サイン・図形・透かしは編集画面とローカル下書きで扱います。
- 透かしはページ中央に配置する文書設定です。指定ページの透かしはそのページを追跡し、複製先には自動追加しません。複製先にも表示する場合は「全ページ」を選択してください。
- OCRや本文の段落再レイアウトには対応していません。

## 開発・公開

検証はローカルで `npm test`、`npm run lint`、`npm run build` を実行します。GitHub Actionsの自動CI・自動デプロイは停止し、レビュー後のPages公開だけ `Deploy to GitHub Pages` をmainブランチから手動実行します。

機能設計では [Acrobatの画像追加](https://helpx.adobe.com/acrobat/desktop/edit-documents/edit-images-or-objects/add-image.html)、[図形・描画](https://helpx.adobe.com/ca/acrobat/desktop/share-and-review-documents/review-documents/add-shapes-drawings.html)、[透かし](https://helpx.adobe.com/acrobat/desktop/edit-documents/add-backgrounds-and-watermarks/add-watermarks.html)を参考にし、[pdf-libの描画API](https://pdf-lib.js.org/docs/api/classes/pdfpage)で実装しています。[pdf-lib](https://github.com/Hopding/pdf-lib)・[BentoPDF](https://github.com/Alam00000/bentopdf)などのGitHubプロジェクトも比較し、他製品のコードを流用せず既存の依存関係で実現しました。

## 📁 プロジェクト構成

```
src/
├── components/
│   ├── Dropzone.tsx            # ファイルドロップゾーン
│   ├── ImagePreview.tsx        # 変換後の画像プレビュー
│   ├── ImageToPdfConverter.tsx # 画像→PDF変換
│   ├── PdfEditor.tsx           # PDF編集（ページ管理・テキストボックス・ヘッダー/フッター・ページ番号・PNG出力）
│   ├── PdfMerger.tsx           # PDF結合
│   ├── ProgressBar.tsx         # 進捗バー
│   └── pdfEdit/
│       ├── ContentEditPanel.tsx    # 既存コンテンツ編集パネル
│       ├── TextBoxEditor.tsx       # テキストボックス設定パネル
│       ├── HeaderFooterEditor.tsx  # ヘッダー/フッター設定パネル
│       ├── PageNumberEditor.tsx    # ページ番号設定パネル
│       ├── PageManagementPanel.tsx # ページ削除・並び替え・抽出パネル
│       ├── PdfEditorSidebar.tsx    # PDF編集サイドバー
│       └── PdfEditorPreview.tsx    # PDF編集プレビュー
├── hooks/
│   ├── useDropzone.ts          # ドラッグ＆ドロップフック
│   └── usePdfDocument.ts       # PDF読み込み・サムネイル生成フック
├── types/
│   ├── contentEdit.ts          # 既存コンテンツ認識・編集の型定義
│   └── pdfEdit.ts              # PDF編集の型定義
├── utils/
│   ├── contentEditOperations.ts # 既存コンテンツ編集の適用（カバー+再描画）
│   ├── contentRecognition.ts   # テキスト・パス認識（pdf.jsオペレータ解析）
│   ├── fontLoader.ts           # 日本語フォント遅延読み込み
│   ├── imagesToPdf.ts          # 画像→PDF変換ユーティリティ
│   ├── overlayRenderer.ts      # プレビューオーバーレイ描画
│   ├── pageOrderUtils.ts       # ページ並び替えユーティリティ
│   ├── pdfEditOperations.ts    # PDF編集操作（テキスト描画・ヘッダー/フッター・ページ番号）
│   ├── pdfEditor.ts            # PDFページ編集ユーティリティ
│   └── pdfToImages.ts          # PDF→画像変換ユーティリティ
├── App.tsx
├── main.tsx
└── index.css
```

## 🔒 プライバシー

すべての処理はブラウザ上で完結します。ファイルは外部サーバーに送信されません。

## 📝 ライセンス

MIT
