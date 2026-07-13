import type {
  HeaderFooterSettings,
  PageNumberingConfig,
  PdfImageExportOptions,
  TextBoxConfig,
} from '../types/pdfEdit';

const STORAGE_KEY = 'pdf-image-tools:recipes:v1';
const CHANGE_EVENT = 'pdf-image-tools:recipes-changed';

function notifyRecipeChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export interface PdfEditRecipe {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
  imageExportOptions: PdfImageExportOptions;
}

function isRecipe(value: unknown): value is PdfEditRecipe {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PdfEditRecipe>;
  return candidate.version === 1 && typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' && Array.isArray(candidate.textBoxes) &&
    Boolean(candidate.headerFooter) && Boolean(candidate.pageNumbering) &&
    Boolean(candidate.imageExportOptions);
}

export function loadRecipes(): PdfEditRecipe[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecipe) : [];
  } catch {
    return [];
  }
}

export function saveRecipe(recipe: PdfEditRecipe) {
  const recipes = loadRecipes();
  const next = [...recipes.filter((item) => item.id !== recipe.id), recipe]
    .sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notifyRecipeChange();
  return next;
}

export function deleteRecipe(id: string) {
  const next = loadRecipes().filter((recipe) => recipe.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notifyRecipeChange();
  return next;
}

export function subscribeRecipeChanges(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function exportRecipe(recipe: PdfEditRecipe) {
  return new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
}

export async function importRecipe(file: File) {
  const parsed = JSON.parse(await file.text()) as unknown;
  if (!isRecipe(parsed)) throw new Error('このファイルはPDF Image Toolsのレシピではありません');
  return parsed;
}
