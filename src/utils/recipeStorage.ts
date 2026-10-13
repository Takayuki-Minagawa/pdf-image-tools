import { parseRecipe, type PdfEditRecipe } from '../types/recipe';

export type { PdfEditRecipe } from '../types/recipe';

const STORAGE_KEY = 'pdf-image-tools:recipes:v1';
const CHANGE_EVENT = 'pdf-image-tools:recipes-changed';

function notifyRecipeChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function parseStoredRecipe(value: unknown): PdfEditRecipe | null {
  try {
    return parseRecipe(value);
  } catch {
    return null;
  }
}

/** 端末内に保存したレシピを読み込む。旧形式（version 1）は読み込み時に現行形式へ移行する。 */
export function loadRecipes(): PdfEditRecipe[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const recipe = parseStoredRecipe(item);
      return recipe ? [recipe] : [];
    });
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  return parseRecipe(parsed);
}
