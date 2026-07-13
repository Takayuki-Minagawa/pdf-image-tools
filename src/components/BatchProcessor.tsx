import { useEffect, useMemo, useRef, useState } from 'react';
import { Files, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { applyPdfEdits } from '../utils/pdfEditOperations';
import { loadRecipes, subscribeRecipeChanges } from '../utils/recipeStorage';
import { downloadBinaryFilesAsZip, sanitizeFilename } from '../utils/download';

interface BatchFile {
  id: string;
  file: File;
  status: 'ready' | 'processing' | 'done' | 'error';
  error?: string;
}

export default function BatchProcessor() {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [recipes, setRecipes] = useState(loadRecipes);
  const [recipeId, setRecipeId] = useState(() => recipes[0]?.id ?? '');
  const [outputName, setOutputName] = useState('pdf-batch-results');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const cancelledRef = useRef(false);
  const selectedRecipe = useMemo(() => recipes.find((recipe) => recipe.id === recipeId), [recipeId, recipes]);

  useEffect(() => subscribeRecipeChanges(() => {
    const next = loadRecipes();
    setRecipes(next);
    setRecipeId((current) => next.some((recipe) => recipe.id === current) ? current : (next[0]?.id ?? ''));
  }), []);

  const addFiles = (nextFiles: File[]) => {
    setMessage('');
    setFiles((current) => {
      const signatures = new Set(current.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`));
      return current.concat(nextFiles.flatMap((file) => {
        const signature = `${file.name}:${file.size}:${file.lastModified}`;
        if (signatures.has(signature)) return [];
        signatures.add(signature);
        return [{ id: crypto.randomUUID(), file, status: 'ready' as const }];
      }));
    });
  };

  const processFiles = async () => {
    if (!selectedRecipe || files.length === 0) return;
    cancelledRef.current = false;
    setIsProcessing(true);
    setProgress(0);
    setMessage('');
    const results: Array<{ filename: string; data: Uint8Array }> = [];
    const usedNames = new Set<string>();
    try {
      for (let index = 0; index < files.length; index++) {
        if (cancelledRef.current) break;
        const item = files[index];
        setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'processing', error: undefined } : entry));
        try {
          const source = await item.file.arrayBuffer();
          const edited = await applyPdfEdits(source, {
            textBoxes: selectedRecipe.textBoxes,
            headerFooter: selectedRecipe.headerFooter,
            pageNumbering: selectedRecipe.pageNumbering,
          }, item.file.name);
          const baseName = `${sanitizeFilename(item.file.name.replace(/\.pdf$/i, ''), 'document')}_edited`;
          let filename = `${baseName}.pdf`;
          let suffix = 2;
          while (usedNames.has(filename.toLocaleLowerCase())) filename = `${baseName} (${suffix++}).pdf`;
          usedNames.add(filename.toLocaleLowerCase());
          results.push({ filename, data: edited });
          setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'done' } : entry));
        } catch (error) {
          const reason = error instanceof Error ? error.message : '処理できませんでした';
          setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'error', error: reason } : entry));
        }
        setProgress(((index + 1) / files.length) * 85);
      }

      if (!cancelledRef.current && results.length > 0) {
        const size = await downloadBinaryFilesAsZip(results, sanitizeFilename(outputName, 'pdf-batch-results'), (zipProgress) => setProgress(85 + zipProgress * 0.15));
        setMessage(`${results.length}件を処理し、${(size / 1024 / 1024).toFixed(1)} MBのZIPを保存しました`);
      } else if (cancelledRef.current) {
        setMessage('バッチ処理をキャンセルしました');
      }
    } catch (error) {
      setMessage(error instanceof Error ? `ZIPを作成できませんでした: ${error.message}` : 'ZIPを作成できませんでした');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-cyan-100 p-3"><Files className="h-6 w-6 text-cyan-700" /></div>
        <div><h2 className="text-xl font-bold text-gray-800">バッチ処理</h2><p className="text-sm text-gray-500">保存した作業レシピを複数のPDFへ適用します</p></div>
      </div>

      {recipes.length === 0 ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">先にPDF編集画面の「作業レシピ」で設定を保存してください。</div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
          <label className="text-sm text-gray-700">使用するレシピ<select value={recipeId} onChange={(event) => setRecipeId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
          <label className="text-sm text-gray-700">ZIPファイル名<input value={outputName} onChange={(event) => setOutputName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
        </div>
      )}

      <Dropzone accept={['.pdf', 'application/pdf']} onDrop={addFiles} title="処理するPDFをまとめてドロップ" description="同じファイルは自動的に除外されます" disabled={isProcessing} />

      {files.length > 0 && (
        <section className="rounded-lg border border-gray-200" aria-label="バッチ処理ファイル一覧">
          <div className="flex items-center justify-between border-b border-gray-200 p-3"><span className="text-sm font-semibold">{files.length}件</span><button type="button" disabled={isProcessing} onClick={() => setFiles([])} className="flex items-center gap-1 text-sm text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" />クリア</button></div>
          <ul className="max-h-64 divide-y divide-gray-100 overflow-auto">
            {files.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 truncate">{item.file.name}</span><span className={item.status === 'error' ? 'text-red-600' : item.status === 'done' ? 'text-green-600' : 'text-gray-500'} title={item.error}>{item.status === 'ready' ? '待機' : item.status === 'processing' ? '処理中' : item.status === 'done' ? '完了' : `失敗: ${item.error}`}</span></li>)}
          </ul>
        </section>
      )}

      {isProcessing && <ProgressBar progress={progress} label="レシピを適用中..." />}
      <div className="flex gap-2">
        <button type="button" onClick={() => void processFiles()} disabled={!selectedRecipe || files.length === 0 || isProcessing} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-3 font-medium text-white hover:bg-cyan-800 disabled:opacity-40"><Play className="h-5 w-5" />バッチ処理を開始</button>
        {isProcessing ? <button type="button" onClick={() => { cancelledRef.current = true; }} className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-3 text-red-700"><Square className="h-4 w-4" />停止</button> : <button type="button" onClick={() => { setFiles((current) => current.map((item) => ({ ...item, status: 'ready', error: undefined }))); setProgress(0); setMessage(''); }} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-gray-700"><RotateCcw className="h-4 w-4" />状態をリセット</button>}
      </div>
      {message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700" role="status">{message}</p>}
    </div>
  );
}
