import { useEffect, useRef, useState } from 'react';
import { Combine, Image, LockKeyhole, Pencil, Trash2, X } from 'lucide-react';
import type { ToolTab } from '../App';

interface PurposeGuideProps {
  open: boolean;
  onClose: () => void;
  onSelect: (tab: ToolTab) => void;
}

const PURPOSES = [
  {
    tab: 'pdf-edit',
    title: 'PDFの内容を整える',
    description: 'ページ整理、文字の追加・置換、墨消し、ページ番号、PNG出力ができます。',
    action: 'PDF編集を始める',
    icon: Pencil,
    iconClass: 'bg-amber-100 text-amber-700',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
  },
  {
    tab: 'pdf-merge',
    title: '複数のPDFを1つにする',
    description: 'PDFの順番をプレビューで確認しながら入れ替えて、1つに結合できます。',
    action: 'PDF結合を始める',
    icon: Combine,
    iconClass: 'bg-purple-100 text-purple-700',
    buttonClass: 'bg-purple-600 hover:bg-purple-700 focus-visible:ring-purple-500',
  },
  {
    tab: 'image-to-pdf',
    title: '画像をPDFにまとめる',
    description: 'JPG、PNG、GIF、WebPを好きな順番に並べ、1つのPDFにできます。',
    action: '画像変換を始める',
    icon: Image,
    iconClass: 'bg-green-100 text-green-700',
    buttonClass: 'bg-green-600 hover:bg-green-700 focus-visible:ring-green-500',
  },
] satisfies Array<{
  tab: ToolTab;
  title: string;
  description: string;
  action: string;
  icon: typeof Pencil;
  iconClass: string;
  buttonClass: string;
}>;

export function PurposeGuide({ open, onClose, onSelect }: PurposeGuideProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cacheMessage, setCacheMessage] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const clearOfflineCache = async () => {
    if (!('caches' in window)) {
      setCacheMessage('このブラウザにはオフラインキャッシュがありません。');
      return;
    }
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('pdf-image-tools')).map((name) => caches.delete(name)));
    setCacheMessage('オフラインキャッシュを削除しました。下書きとレシピは保持されています。');
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="purpose-guide-title"
      aria-describedby="purpose-guide-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100vh-2rem)] w-[min(94vw,58rem)] overflow-y-auto rounded-2xl border-0 bg-white p-0 text-left shadow-2xl backdrop:bg-gray-950/55 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-5 sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="スタートガイドを閉じる"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="pr-10">
          <p className="mb-1 text-sm font-semibold text-blue-700">目的から選ぶ</p>
          <h2 id="purpose-guide-title" className="text-2xl font-bold text-gray-900">
            今日は何をしますか？
          </h2>
          <p id="purpose-guide-description" className="mt-2 text-sm leading-6 text-gray-600">
            やりたいことを選ぶと、対応するツールをすぐに開けます。
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {PURPOSES.map((purpose) => {
            const Icon = purpose.icon;
            return (
              <article key={purpose.tab} className="flex flex-col rounded-xl border border-gray-200 p-4">
                <div className={`mb-3 w-fit rounded-lg p-2.5 ${purpose.iconClass}`}>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="font-bold text-gray-900">{purpose.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-gray-600">{purpose.description}</p>
                <button
                  type="button"
                  onClick={() => onSelect(purpose.tab)}
                  className={`mt-4 rounded-lg px-3 py-2.5 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${purpose.buttonClass}`}
                >
                  {purpose.action}
                </button>
              </article>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl bg-blue-50 p-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-blue-950">ファイルは端末の外へ送信されません</p>
              <p className="mt-1 text-xs leading-5 text-blue-800">
                読み込みから保存まで、お使いのブラウザ内で処理します。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-blue-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            今はスキップ
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>{cacheMessage || 'オフラインキャッシュと編集下書きは別々に管理されます。'}</span>
          <button type="button" onClick={() => void clearOfflineCache()} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />オフラインキャッシュを削除
          </button>
        </div>
      </div>
    </dialog>
  );
}
