# PDF Image Tools

ブラウザ上で動作するPDF・画像変換ツールです。すべての処理はローカルで行われ、ファイルがサーバーにアップロードされることはありません。

## 🌟 機能

### 📄 PDF → 画像変換
- PDFファイルをPNG画像に変換
- 複数ページ対応
- PDFビューワー機能
  - ページナビゲーション
  - ズーム機能（25%〜500%、幅に合わせる、全体表示）
  - マウス座標表示（PDF座標 / 表示座標）
- ページ編集機能
  - ページの削除
  - ページの並び替え（ドラッグ＆ドロップ / 矢印ボタン）
  - 指定ページ範囲の抽出
  - 編集後のPDFを保存

### 🖼️ 画像 → PDF変換
- 複数の画像（JPG, PNG, GIF, WebP）を1つのPDFに変換
- 画像の順番を変更可能（ドラッグ＆ドロップ / 矢印ボタン）
- 各画像のサイズ情報を表示
- 個別削除機能

### 📑 PDF結合
- 複数のPDFファイルを1つに結合
- 結合順序の変更（ドラッグ＆ドロップ / 矢印ボタン）
- 各PDFのページ数とサムネイルを表示
- 合計ページ数の表示

## 🛠️ 技術スタック

- **フレームワーク**: React 19 + TypeScript
- **ビルドツール**: Vite 7
- **スタイリング**: Tailwind CSS 4
- **PDF処理**: 
  - pdfjs-dist（PDF表示・画像変換）
  - pdf-lib（PDF編集・結合）
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
│   ├── Dropzone.tsx          # ファイルドロップゾーン
│   ├── ImagePreview.tsx      # 変換後の画像プレビュー
│   ├── ImageToPdfConverter.tsx # 画像→PDF変換
│   ├── PdfMerger.tsx         # PDF結合
│   ├── PdfToImageConverter.tsx # PDF→画像変換
│   ├── PdfViewer.tsx         # PDFビューワー・編集
│   └── ProgressBar.tsx       # 進捗バー
├── hooks/
│   └── useDropzone.ts        # ドラッグ＆ドロップフック
├── utils/
│   ├── imagesToPdf.ts        # 画像→PDF変換ユーティリティ
│   ├── pdfEditor.ts          # PDF編集ユーティリティ
│   └── pdfToImages.ts        # PDF→画像変換ユーティリティ
├── App.tsx
├── main.tsx
└── index.css
```

## 🔒 プライバシー

すべての処理はブラウザ上で完結します。ファイルは外部サーバーに送信されません。

## 📝 ライセンス

MIT
