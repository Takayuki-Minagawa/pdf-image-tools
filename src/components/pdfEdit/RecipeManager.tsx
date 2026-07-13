import { useRef, useState } from 'react';
import { Download, FileJson, Save, Trash2, Upload } from 'lucide-react';
import type {
  HeaderFooterSettings,
  PageNumberingConfig,
  PdfImageExportOptions,
  TextBoxConfig,
} from '../../types/pdfEdit';
import {
  deleteRecipe,
  exportRecipe,
  importRecipe,
  loadRecipes,
  saveRecipe,
  type PdfEditRecipe,
} from '../../utils/recipeStorage';
import { downloadBlob, sanitizeFilename } from '../../utils/download';

interface RecipeManagerProps {
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
  imageExportOptions: PdfImageExportOptions;
  onApply: (recipe: PdfEditRecipe) => void;
}

export function RecipeManager({
  textBoxes,
  headerFooter,
  pageNumbering,
  imageExportOptions,
  onApply,
}: RecipeManagerProps) {
  const [recipes, setRecipes] = useState(loadRecipes);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMessage('レシピ名を入力してください');
      return;
    }
    const existing = recipes.find((recipe) => recipe.name === trimmedName);
    const now = Date.now();
    const recipe: PdfEditRecipe = {
      version: 1,
      id: existing?.id ?? crypto.randomUUID(),
      name: trimmedName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      textBoxes: structuredClone(textBoxes),
      headerFooter: structuredClone(headerFooter),
      pageNumbering: structuredClone(pageNumbering),
      imageExportOptions: structuredClone(imageExportOptions),
    };
    setRecipes(saveRecipe(recipe));
    setName('');
    setMessage(`「${trimmedName}」を端末内に保存しました`);
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    try {
      const recipe = await importRecipe(file);
      setRecipes(saveRecipe({ ...recipe, id: crypto.randomUUID(), updatedAt: Date.now() }));
      setMessage(`「${recipe.name}」を読み込みました`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レシピを読み込めませんでした');
    }
  };

  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700">
        <FileJson className="h-4 w-4" />作業レシピ
      </summary>
      <div className="space-y-3 border-t border-gray-200 p-3">
        <p className="text-xs text-gray-500">テキストボックス、ヘッダー、ページ番号、画像出力設定を再利用できます。</p>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="recipe-name">レシピ名</label>
          <input id="recipe-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 請求書設定" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          <button type="button" onClick={handleSave} className="flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1.5 text-xs text-white"><Save className="h-3.5 w-3.5" />保存</button>
        </div>
        {recipes.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-auto">
            {recipes.map((recipe) => (
              <li key={recipe.id} className="flex items-center gap-1 rounded-md bg-white p-1.5 text-xs">
                <button type="button" onClick={() => { onApply(recipe); setMessage(`「${recipe.name}」を適用しました`); }} className="min-w-0 flex-1 truncate text-left font-medium text-blue-700 hover:underline">{recipe.name}</button>
                <button type="button" title="JSONで書き出す" aria-label={`${recipe.name}を書き出す`} onClick={() => downloadBlob(exportRecipe(recipe), `${sanitizeFilename(recipe.name, 'recipe')}.json`)} className="rounded p-1 hover:bg-gray-100"><Download className="h-3.5 w-3.5" /></button>
                <button type="button" title="削除" aria-label={`${recipe.name}を削除`} onClick={() => setRecipes(deleteRecipe(recipe.id))} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void handleImport(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><Upload className="h-3.5 w-3.5" />レシピを読み込む</button>
        {message && <p className="text-xs text-gray-600" aria-live="polite">{message}</p>}
      </div>
    </details>
  );
}
