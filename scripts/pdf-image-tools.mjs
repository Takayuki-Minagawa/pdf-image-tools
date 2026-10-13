#!/usr/bin/env node
/**
 * CLI ランチャー。処理本体は src/cli/main.ts にあり、vite.cli.config.ts で
 * dist-cli/pdf-image-tools.mjs へバンドルされる（ブラウザ版と同じコードを共有）。
 * バンドルが無い、または src より古い場合は自動でビルドしてから実行する。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = join(root, 'dist-cli', 'pdf-image-tools.mjs');
const fontPath = join(root, 'public', 'fonts', 'NotoSansJP.ttf');
// pdf.js は末尾が '/' のパスを要求する（Windows でも fs は '/' 区切りを受け付ける）
const standardFontDataUrl = join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';

function newestMtime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(path));
    } else if (/\.(ts|tsx|mjs|json)$/.test(entry.name)) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

function bundleIsStale() {
  if (!existsSync(bundlePath)) return true;
  const built = statSync(bundlePath).mtimeMs;
  const sources = [join(root, 'src'), join(root, 'vite.cli.config.ts'), join(root, 'package.json')];
  return sources.some((path) => existsSync(path) && (statSync(path).isDirectory() ? newestMtime(path) : statSync(path).mtimeMs) > built);
}

if (process.argv.includes('--rebuild') || bundleIsStale()) {
  if (!existsSync(join(root, 'node_modules'))) {
    process.stderr.write('依存関係がインストールされていません。先に `npm install` を実行してください。\n');
    process.exit(1);
  }
  process.stderr.write('Building CLI bundle (vite build -c vite.cli.config.ts)...\n');
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '-c', 'vite.cli.config.ts', '--logLevel', 'warn'],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const { run } = await import(pathToFileURL(bundlePath).href);
const args = process.argv.slice(2).filter((arg) => arg !== '--rebuild');
process.exitCode = await run(args, {
  fontPath,
  standardFontDataUrl,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
