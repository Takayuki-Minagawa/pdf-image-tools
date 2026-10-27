import { mkdtemp, readFile, rm, symlink, writeFile, access, link, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readBoundedRegionInput, run, writeRegionCandidate } from './main';
import { REGION_REDACTION_LIMITS } from '../types/regionRedaction';

const directories: string[] = [];

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'region-cli-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('candidate output isolation', () => {
  it('rejects existing sources and symlink or hardlink aliases without modification', async () => {
    const root = await directory();
    const input = join(root, 'original.pdf');
    const contents = new Uint8Array([1, 2, 3]);
    await writeFile(input, contents);
    await symlink(input, join(root, 'alias.pdf'));
    await link(input, join(root, 'hardlink.pdf'));
    for (const name of ['original.pdf', 'alias.pdf', 'hardlink.pdf']) {
      await expect(writeRegionCandidate(join(root, name), join(root, 'report.json'), new Uint8Array([9]), {})).rejects.toThrow(/上書き/);
    }
    expect(new Uint8Array(await readFile(input))).toEqual(contents);
  });

  it('rejects identical output paths and removes a reserved candidate when report creation fails', async () => {
    const root = await directory();
    const candidate = join(root, 'candidate.pdf');
    const report = join(root, 'report.json');
    await expect(writeRegionCandidate(candidate, candidate, new Uint8Array([9]), {})).rejects.toThrow(/別の出力先/);
    await writeFile(report, 'original report');
    await expect(writeRegionCandidate(candidate, report, new Uint8Array([9]), {})).rejects.toThrow(/保存できません/);
    await expect(access(candidate)).rejects.toThrow();
    expect(await readFile(report, 'utf8')).toBe('original report');
  });

  it('detects the same new path through a symlinked parent', async () => {
    const root = await directory();
    const alias = `${root}-alias`;
    await symlink(root, alias);
    try {
      await expect(writeRegionCandidate(join(root, 'candidate.pdf'), join(alias, 'candidate.pdf'), new Uint8Array([9]), {})).rejects.toThrow(/別の出力先/);
    } finally {
      await rm(alias);
    }
  });
});

describe('redact-regions command', () => {
  it('writes only a verified, unapproved candidate with a content-free report and leaves the input intact', async () => {
    const root = await directory();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.setTitle('PRIVATE-METADATA');
    doc.addPage([100, 80]).drawText('PRIVATE-TEXT', { x: 10, y: 40, size: 8, font });
    const source = await doc.save();
    const input = join(root, 'secret-filename.pdf');
    const output = join(root, 'candidate.pdf');
    const recipe = join(root, 'recipe.json');
    await writeFile(input, source);
    await writeFile(recipe, JSON.stringify({
      version: 3,
      regionRedaction: { version: 1, dpi: 72, regions: [{ id: 'r1', pages: [1], x: 0, y: 25, width: 100, height: 30, pageWidth: 100, pageHeight: 80, fill: 'white' }] },
    }));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(['redact-regions', input, output, recipe], {
      fontPath: '',
      standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
      cMapUrl: `${process.cwd()}/node_modules/pdfjs-dist/cmaps/`,
      wasmUrl: `${process.cwd()}/node_modules/pdfjs-dist/wasm/`,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });
    expect(code, stderr.join('')).toBe(0);
    const result = await PDFDocument.load(await readFile(output), { updateMetadata: false });
    expect(result.getPage(0).getSize()).toEqual({ width: 100, height: 80 });
    expect(result.getTitle()).toBeUndefined();
    const report = await readFile(`${output}.report.json`, 'utf8');
    expect(JSON.parse(report).approval).toBe('pending-human-review');
    expect(report).not.toMatch(/PRIVATE|secret-filename/);
    expect(stdout.join('')).toMatch(/not approved/);
    expect(new Uint8Array(await readFile(input))).toEqual(source);
  });
});


describe('bounded secure input', () => {
  it('rejects a sparse oversized PDF before allocating its contents and leaves the source intact', async () => {
    const root = await directory();
    const input = join(root, 'private-oversized.pdf');
    const handle = await open(input, 'wx');
    const size = REGION_REDACTION_LIMITS.maxInputBytes + 1;
    await handle.write('PRIVATE-SOURCE');
    await handle.truncate(size);
    await handle.close();
    const allocate = vi.spyOn(Buffer, 'alloc');
    try {
      await expect(readBoundedRegionInput(input, REGION_REDACTION_LIMITS.maxInputBytes)).rejects.toThrow(/上限/);
      expect(allocate.mock.calls).toHaveLength(0);
    } finally { allocate.mockRestore(); }
    const recipe = join(root, 'recipe.json');
    await writeFile(recipe, JSON.stringify({ version: 3, regionRedaction: { version: 1, dpi: 72, regions: [] } }));
    const messages: string[] = [];
    const output = join(root, 'candidate.pdf');
    expect(await run(['redact-regions', input, output, recipe], { fontPath: '', stdout: (message) => messages.push(message), stderr: (message) => messages.push(message) })).toBe(1);
    expect(messages.join('')).not.toMatch(/private-oversized|PRIVATE-SOURCE/);
    await expect(access(output)).rejects.toThrow();
    expect((await stat(input)).size).toBe(size);
    const original = await open(input, 'r');
    try {
      const prefix = Buffer.alloc(14);
      await original.read(prefix, 0, prefix.length, 0);
      expect(prefix.toString()).toBe('PRIVATE-SOURCE');
    } finally { await original.close(); }
  });

  it('bounds recipe files to 1 MiB and rejects nonregular input files', async () => {
    const root = await directory();
    await expect(readBoundedRegionInput(root, 1024)).rejects.toThrow(/通常のファイル/);
    const input = join(root, 'small.pdf');
    await writeFile(input, 'unchanged');
    const recipe = join(root, 'private-recipe.json');
    const handle = await open(recipe, 'wx');
    await handle.truncate(1024 * 1024 + 1);
    await handle.close();
    const messages: string[] = [];
    const output = join(root, 'candidate.pdf');
    expect(await run(['redact-regions', input, output, recipe], { fontPath: '', stdout: (message) => messages.push(message), stderr: (message) => messages.push(message) })).toBe(1);
    expect(messages.join('')).not.toContain('private-recipe');
    await expect(access(output)).rejects.toThrow();
    expect(await readFile(input, 'utf8')).toBe('unchanged');
  });
});
