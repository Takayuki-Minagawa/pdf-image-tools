/**
 * PDF Image Tools CLI エントリ。ファイル入出力と引数解析を担当し、処理はブラウザ版と
 * 同じユーティリティ（src/utils）を使う。vite.cli.config.ts で dist-cli/ へバンドルし、
 * scripts/pdf-image-tools.mjs から起動する。
 */
import { mkdir, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { jsPDF } from 'jspdf';
import { imageSize } from 'image-size';
import { setFontBytesSource } from '../utils/fontLoader';
import { setPdfjsDocumentOptions } from '../utils/pdfjsDocumentOptions';
import { parseRecipe, RecipeValidationError, requireRegionOnlyRecipe, type RecipeGraphic } from '../types/recipe';
import { rasterizeAndVerify, type RasterCanvasFactory } from '../utils/regionRedaction';
import { describeContentRule } from '../utils/contentRules';
import { RedactionVerificationError } from '../utils/contentEditOperations';
import {
  addText,
  addTextOptionsFromArgs,
  applyRecipe,
  extractPages,
  inspect,
  mergePdfs,
  parseArgs,
  reorderPages,
  rotatePages,
} from './commands';

export const HELP = `PDF Image Tools CLI

Usage:
  pdf-image-tools merge <output.pdf> <input1.pdf> <input2.pdf> [...]
  pdf-image-tools extract <input.pdf> <output.pdf> <pages>
  pdf-image-tools reorder <input.pdf> <output.pdf> <pages>
  pdf-image-tools rotate <input.pdf> <output.pdf> <degrees> [--pages <pages>]
  pdf-image-tools images-to-pdf <output.pdf> <image1> <image2> [...]
  pdf-image-tools add-text <input.pdf> <output.pdf> <text> [options]
  pdf-image-tools inspect <input.pdf> [--pages <pages>] [--kinds all|text|paths] [--out result.json]
  pdf-image-tools apply-recipe <input.pdf> <output.pdf> <recipe.json> [--allow-cover-only]
  pdf-image-tools redact-regions <input.pdf> <candidate.pdf> <recipe.json> [--report candidate-report.json]

Page syntax:
  1-3,5,8    Ranges and individual pages are 1-based.

add-text options (coordinates are pt from the top-left of the displayed page):
  --page <n|all>  target page (default 1)      --x <pt> --y <pt>          position (default 50, 50)
  --width <pt> --height <pt>                   box size (default 200 x 60)
  --size <pt>     font size (default 12)       --color <#rrggbb>          text color
  --background <#rrggbb|transparent>           --border <none|solid|dashed|dotted>
  --border-width <pt> --border-color <#rrggbb>

inspect:
  Prints text runs and vector paths (line / polyline / polygon / rectangle) as JSON.
  Coordinates are PDF user space (origin bottom-left, pt). Element ids (e.g. p0-text-3)
  can be used in recipe contentRules to target an element precisely.

apply-recipe:
  Applies an ordinary recipe JSON exported from the editor (version 1 / 2 / 3):
  textBoxes, headerFooter, pageNumbering, graphics (imagePath relative to the recipe),
  watermark and contentRules (replace / delete / redact text, restyle / delete paths).

redact-regions:
  Uses a version 3 regionRedaction recipe to rebuild every page as a new image PDF.
  Rectangles use displayed top-left coordinates in physical pt; paper sizes must match.
  Annotations and forms are excluded. Vector content and searchable text are lost.
  Writes a verified CANDIDATE and a minimal JSON report; never approves or shares it.
  Open every candidate page locally and confirm removal before copying only the checked
  output into a separate approved workspace. Original access is not restricted by this CLI.
  Neither output may already exist. Default report: <candidate.pdf>.report.json.

Examples:
  pdf-image-tools merge combined.pdf cover.pdf body.pdf
  pdf-image-tools extract report.pdf summary.pdf 1-3,8
  pdf-image-tools rotate scan.pdf fixed.pdf 90 --pages 2,4
  pdf-image-tools add-text report.pdf stamped.pdf "承認済" --page all --x 400 --y 40 --size 16 --color #dc2626
  pdf-image-tools inspect report.pdf --pages 1 --kinds paths
  pdf-image-tools apply-recipe report.pdf edited.pdf company-recipe.json
`;

export interface CliEnvironment {
  /** Noto Sans JP のパス（日本語テキスト・透かしの埋め込みに使う） */
  fontPath: string;
  /** pdfjs-dist/standard_fonts/ のディレクトリ（末尾区切り付き）。標準14フォントのメトリクス取得に使う */
  standardFontDataUrl?: string;
  cMapUrl?: string;
  wasmUrl?: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function installNodePolyfills() {
  // pdf.js legacy ビルドはモジュール初期化時に DOM 型を参照する。Node に無い場合だけ補う。
  const g = globalThis as Record<string, unknown>;
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    if (typeof g[name] === 'undefined') g[name] = class {};
  }
}

async function save(output: string, bytes: Uint8Array, env: CliEnvironment) {
  const absolute = resolve(output);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  env.stdout(`Saved ${absolute} (${bytes.byteLength} bytes)\n`);
}

async function readPdf(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    throw new Error(`PDF を読み込めません: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function imageMime(bytes: Uint8Array, path: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (png) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  throw new Error(`対応していない画像形式です: ${path}（PNG / JPEG / WebP）`);
}

async function imagesToPdf(output: string, inputs: string[], env: CliEnvironment) {
  if (inputs.length === 0) throw new Error('images-to-pdf には画像が1つ以上必要です');
  let pdf: jsPDF | undefined;
  for (const input of inputs) {
    const bytes = new Uint8Array(await readFile(input));
    const dimensions = imageSize(bytes);
    if (!dimensions.width || !dimensions.height) throw new Error(`画像サイズを取得できません: ${input}`);
    const orientation = dimensions.width > dimensions.height ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ unit: 'px', format: [dimensions.width, dimensions.height], orientation });
    } else {
      pdf.addPage([dimensions.width, dimensions.height], orientation);
    }
    const mime = imageMime(bytes, input);
    const format = mime === 'image/png' ? 'PNG' : mime === 'image/webp' ? 'WEBP' : 'JPEG';
    pdf.addImage(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, format, 0, 0, dimensions.width, dimensions.height);
  }
  await save(output, new Uint8Array(pdf!.output('arraybuffer')), env);
}

function createImageResolver(recipePath: string) {
  return async (graphic: RecipeGraphic) => {
    const path = resolve(dirname(resolve(recipePath)), graphic.imagePath!);
    const bytes = new Uint8Array(await readFile(path));
    const mime = imageMime(bytes, path);
    if (mime === 'image/webp') throw new Error(`レシピの画像は PNG / JPEG を指定してください: ${path}`);
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  };
}

async function loadRecipe(path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`レシピ JSON を読み込めません: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
  return parseRecipe(parsed);
}

/** Reserve both paths exclusively: source aliases, symlinks and hardlinks cannot be overwritten. */
export async function writeRegionCandidate(
  output: string,
  reportPath: string,
  bytes: Uint8Array,
  report: unknown,
) {
  const candidate = resolve(output);
  const reportOutput = resolve(reportPath);
  await mkdir(dirname(candidate), { recursive: true });
  await mkdir(dirname(reportOutput), { recursive: true });
  const canonicalCandidate = join(await realpath(dirname(candidate)), basename(candidate));
  const canonicalReport = join(await realpath(dirname(reportOutput)), basename(reportOutput));
  if (canonicalCandidate === canonicalReport) throw new Error('PDF とレポートには別の出力先を指定してください');
  const pdfHandle = await open(candidate, 'wx', 0o600).catch(() => {
    throw new Error('候補 PDF の出力先を新規作成できません。既存ファイルは上書きしません');
  });
  let reportHandle: Awaited<ReturnType<typeof open>> | undefined;
  let completed = false;
  try {
    reportHandle = await open(reportOutput, 'wx', 0o600);
    await pdfHandle.writeFile(bytes);
    await reportHandle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    completed = true;
  } catch {
    throw new Error('候補とレポートを保存できませんでした。出力先は新しいファイルを指定してください');
  } finally {
    await pdfHandle.close();
    await reportHandle?.close();
    if (!completed) {
      await unlink(candidate).catch(() => undefined);
      if (reportHandle) await unlink(reportOutput).catch(() => undefined);
    }
  }
}

async function redactRegions(input: string, output: string, recipePath: string, reportPath: string, env: CliEnvironment) {
  try {
    const recipe = await loadRecipe(recipePath);
    const settings = requireRegionOnlyRecipe(recipe);
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvasFactory: RasterCanvasFactory = (width, height) => {
      const canvas = createCanvas(width, height);
      return {
        canvas: canvas as unknown as HTMLCanvasElement,
        context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
        encodePng: async () => new Uint8Array(await canvas.encode('png')),
        dispose: () => { canvas.width = 1; canvas.height = 1; },
      };
    };
    const source = new Uint8Array(await readFile(input));
    const result = await rasterizeAndVerify(source, settings, {
      canvasFactory,
      documentOptions: {
        standardFontDataUrl: env.standardFontDataUrl,
        cMapUrl: env.cMapUrl,
        cMapPacked: true,
        wasmUrl: env.wasmUrl,
        useSystemFonts: false,
        useWorkerFetch: false,
      },
      onProgress: ({ stage, page, total }) => env.stderr(`${stage}: ${page}/${total}\n`),
    });
    await writeRegionCandidate(output, reportPath, result.bytes, { ...result.report, approval: 'pending-human-review' });
    env.stdout(`Candidate created (${result.bytes.byteLength} bytes). Human review is required; this output is not approved.\n`);
  } catch (error) {
    // File parser errors can include filenames or source text. Keep the secure command's error neutral.
    if (error instanceof RecipeValidationError) throw error;
    throw new Error('領域除去を完了できませんでした。入力・用紙条件・DPI・新規出力先を確認してください');
  }
}

function usage(message: string): never {
  throw new UsageError(message);
}

class UsageError extends Error {}

async function dispatch(argv: string[], env: CliEnvironment): Promise<void> {
  const [command, ...rest] = argv;
  const { positional, options } = parseArgs(rest);

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      env.stdout(HELP);
      return;

    case 'merge': {
      const [output, ...inputs] = positional;
      if (!output) usage('merge には出力パスが必要です');
      await save(output, await mergePdfs(await Promise.all(inputs.map(readPdf))), env);
      return;
    }

    case 'extract':
    case 'reorder': {
      const [input, output, pages] = positional;
      if (!input || !output || !pages) usage(`${command} には input, output, pages が必要です`);
      const bytes = await readPdf(input);
      await save(output, command === 'extract' ? await extractPages(bytes, pages) : await reorderPages(bytes, pages), env);
      return;
    }

    case 'rotate': {
      const [input, output, degrees] = positional;
      if (!input || !output || degrees === undefined) usage('rotate には input, output, degrees が必要です');
      const angle = Number(degrees);
      if (!Number.isFinite(angle)) usage('degrees には数値を指定してください');
      const pages = typeof options.pages === 'string' ? options.pages : undefined;
      await save(output, await rotatePages(await readPdf(input), pages, angle), env);
      return;
    }

    case 'images-to-pdf': {
      const [output, ...inputs] = positional;
      if (!output) usage('images-to-pdf には出力パスが必要です');
      await imagesToPdf(output, inputs, env);
      return;
    }

    case 'add-text': {
      const [input, output, text] = positional;
      if (!input || !output || text === undefined) usage('add-text には input, output, text が必要です');
      const addOptions = addTextOptionsFromArgs(text, options, basename(input));
      await save(output, await addText(await readPdf(input), addOptions), env);
      return;
    }

    case 'inspect': {
      const [input] = positional;
      if (!input) usage('inspect には input が必要です');
      const result = await inspect(await readPdf(input), basename(input), {
        pages: typeof options.pages === 'string' ? options.pages : undefined,
        kinds: typeof options.kinds === 'string' ? options.kinds : undefined,
      });
      const json = `${JSON.stringify(result, null, 2)}\n`;
      if (typeof options.out === 'string') {
        const absolute = resolve(options.out);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, json, 'utf8');
        const itemCount = result.pages.reduce((total, page) => total + page.items.length, 0);
        env.stdout(`Saved ${absolute} (${result.pages.length} pages, ${itemCount} items)\n`);
      } else {
        env.stdout(json);
      }
      return;
    }

    case 'apply-recipe': {
      const [input, output, recipePath] = positional;
      if (!input || !output || !recipePath) usage('apply-recipe には input, output, recipe JSON が必要です');
      const recipe = await loadRecipe(recipePath);
      const result = await applyRecipe(await readPdf(input), recipe, {
        fileName: basename(input),
        allowCoverOnly: options['allow-cover-only'] === true,
        resolveImage: createImageResolver(recipePath),
      });
      await save(output, result.bytes, env);
      if (recipe.contentRules.length > 0) {
        const matched = result.matchCounts.reduce((total, count) => total + count, 0);
        env.stdout(`Content rules: ${matched} element(s) matched, ${result.unmatched.length} rule(s) unmatched\n`);
        for (const rule of result.unmatched) env.stdout(`  unmatched: ${describeContentRule(rule)}\n`);
      }
      return;
    }

    case 'redact-regions': {
      const [input, output, recipePath] = positional;
      if (positional.length !== 3 || !input || !output || !recipePath) usage('redact-regions には input, candidate, recipe JSON が必要です');
      if (Object.keys(options).some((key) => key !== 'report') || options.report === true) usage('redact-regions のオプションは --report <path> のみです');
      await redactRegions(input, output, recipePath, typeof options.report === 'string' ? options.report : `${output}.report.json`, env);
      return;
    }

    default:
      usage(`不明なコマンドです: ${command}`);
  }
}

/** 終了コードを返す（0: 成功 / 1: 失敗）。 */
export async function run(argv: string[], env: CliEnvironment): Promise<number> {
  installNodePolyfills();
  setFontBytesSource(() => readFile(env.fontPath).then((buffer) => new Uint8Array(buffer)));
  if (env.standardFontDataUrl) setPdfjsDocumentOptions({ standardFontDataUrl: env.standardFontDataUrl });
  try {
    await dispatch(argv, env);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      env.stderr(`Error: ${error.message}\n\n${HELP}`);
    } else if (error instanceof RecipeValidationError) {
      env.stderr(`Recipe error: ${error.message}\n`);
    } else if (error instanceof RedactionVerificationError) {
      env.stderr(`Error: ${error.message}\n`);
      for (const item of error.residual) env.stderr(`  page ${item.pageIndex + 1}: "${item.text}"\n`);
      env.stderr('Use --allow-cover-only to save with visual cover only (text data remains extractable).\n');
    } else {
      env.stderr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 1;
  }
}
