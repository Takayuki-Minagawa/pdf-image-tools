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

# プレビュー
npm run preview
```

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
