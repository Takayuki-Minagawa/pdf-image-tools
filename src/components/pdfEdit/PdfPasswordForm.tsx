import { useState } from 'react';

interface PdfPasswordFormProps {
  /** パスワードを受け付けた場合に true を返す */
  onSubmit: (password: string) => boolean;
  onCancel: () => void;
}

export function PdfPasswordForm({ onSubmit, onCancel }: PdfPasswordFormProps) {
  const [password, setPassword] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (onSubmit(password)) setPassword('');
      }}
      className="mx-auto max-w-md rounded-xl border border-blue-200 bg-blue-50 p-6"
    >
      <h2 className="font-semibold text-blue-950">パスワード付きPDF</h2>
      <p className="mt-1 text-sm text-blue-800">このファイルを開くためのパスワードを入力してください。パスワードは保存されません。</p>
      <label className="mt-4 block text-sm text-blue-900">PDFパスワード<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2" /></label>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={!password} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">開く</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm text-blue-800">別のファイル</button>
      </div>
    </form>
  );
}
