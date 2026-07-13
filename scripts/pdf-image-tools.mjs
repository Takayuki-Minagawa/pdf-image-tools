#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { jsPDF } from 'jspdf';
import { imageSize } from 'image-size';

const HELP = `PDF Image Tools CLI

Usage:
  pdf-image-tools merge <output.pdf> <input1.pdf> <input2.pdf> [...]
  pdf-image-tools extract <input.pdf> <output.pdf> <pages>
  pdf-image-tools reorder <input.pdf> <output.pdf> <pages>
  pdf-image-tools images-to-pdf <output.pdf> <image1> <image2> [...]
  pdf-image-tools apply-recipe <input.pdf> <output.pdf> <recipe.json>

Page syntax:
  1-3,5,8    Ranges and individual pages are 1-based.

Examples:
  pdf-image-tools merge combined.pdf cover.pdf body.pdf
  pdf-image-tools extract report.pdf summary.pdf 1-3,8
  pdf-image-tools reorder scan.pdf sorted.pdf 3,1,2
  pdf-image-tools images-to-pdf photos.pdf 001.jpg 002.png
  pdf-image-tools apply-recipe report.pdf stamped.pdf company-recipe.json
`;

function fail(message) {
  process.stderr.write(`Error: ${message}\n\n${HELP}`);
  process.exitCode = 1;
}

function parsePageSpec(spec, pageCount) {
  const result = [];
  for (const part of spec.split(',').map((value) => value.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`Invalid page specification: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`Page range ${part} is outside 1-${pageCount}`);
    }
    for (let page = start; page <= end; page++) result.push(page - 1);
  }
  if (result.length === 0) throw new Error('At least one page is required');
  return result;
}

async function save(output, bytes) {
  const absolute = resolve(output);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  process.stdout.write(`Saved ${absolute} (${bytes.byteLength} bytes)\n`);
}

async function merge(output, inputs) {
  if (inputs.length < 2) throw new Error('merge requires at least two input PDFs');
  const target = await PDFDocument.create();
  for (const input of inputs) {
    const source = await PDFDocument.load(await readFile(input));
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
  await save(output, await target.save());
}

async function selectPages(input, output, spec) {
  const source = await PDFDocument.load(await readFile(input));
  const pageIndices = parsePageSpec(spec, source.getPageCount());
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, pageIndices);
  pages.forEach((page) => target.addPage(page));
  await save(output, await target.save());
}

function imageFormat(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'PNG';
  if (extension === '.jpg' || extension === '.jpeg') return 'JPEG';
  if (extension === '.webp') return 'WEBP';
  throw new Error(`Unsupported CLI image format: ${extension || path}. Use PNG, JPEG, or WebP.`);
}

async function imagesToPdf(output, inputs) {
  if (inputs.length === 0) throw new Error('images-to-pdf requires at least one image');
  let pdf;
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const bytes = await readFile(input);
    const dimensions = imageSize(bytes);
    if (!dimensions.width || !dimensions.height) throw new Error(`Cannot determine image size: ${input}`);
    const orientation = dimensions.width > dimensions.height ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ unit: 'px', format: [dimensions.width, dimensions.height], orientation });
    } else {
      pdf.addPage([dimensions.width, dimensions.height], orientation);
    }
    const base64 = bytes.toString('base64');
    const format = imageFormat(input);
    const mime = format === 'PNG' ? 'image/png' : format === 'WEBP' ? 'image/webp' : 'image/jpeg';
    pdf.addImage(`data:${mime};base64,${base64}`, format, 0, 0, dimensions.width, dimensions.height);
  }
  await save(output, Buffer.from(pdf.output('arraybuffer')));
}

function toRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return match
    ? rgb(Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255)
    : rgb(0, 0, 0);
}

function roman(number, upper) {
  const values = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let result = '';
  for (const [value, symbol] of values) {
    while (number >= value) {
      result += symbol;
      number -= value;
    }
  }
  return upper ? result.toUpperCase() : result;
}

function pageNumberText(number, config) {
  if (config.format === 'dash-numeric') return `- ${number} -`;
  const value = config.format === 'roman-lower' ? roman(number, false)
    : config.format === 'roman-upper' ? roman(number, true) : String(number);
  return `${config.prefix ?? ''}${value}${config.suffix ?? ''}`;
}

function resolveTemplate(template, page, total, filename) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
  return String(template ?? '')
    .replaceAll('{{page}}', String(page))
    .replaceAll('{{total}}', String(total))
    .replaceAll('{{date}}', date)
    .replaceAll('{{filename}}', filename);
}

async function applyRecipe(input, output, recipePath) {
  const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
  if (recipe?.version !== 1 || !recipe.headerFooter || !recipe.pageNumbering || !Array.isArray(recipe.textBoxes)) {
    throw new Error('The JSON file is not a PDF Image Tools recipe');
  }
  const document = await PDFDocument.load(await readFile(input));
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await readFile(new URL('../public/fonts/NotoSansJP.ttf', import.meta.url)), { subset: true });
  const pages = document.getPages();

  for (const box of recipe.textBoxes) {
    const targets = box.pageIndex === -1 ? pages.map((_, index) => index) : [box.pageIndex];
    for (const pageIndex of targets) {
      const page = pages[pageIndex];
      if (!page) continue;
      const y = page.getHeight() - box.y - box.height;
      if (box.backgroundColor && box.backgroundColor !== 'transparent') {
        page.drawRectangle({ x: box.x, y, width: box.width, height: box.height, color: toRgb(box.backgroundColor) });
      }
      if (box.borderStyle !== 'none' && box.borderWidth > 0) {
        page.drawRectangle({
          x: box.x, y, width: box.width, height: box.height,
          borderColor: toRgb(box.borderColor), borderWidth: box.borderWidth,
          borderDashArray: box.borderStyle === 'dashed' ? [4, 4] : box.borderStyle === 'dotted' ? [1, 2] : undefined,
        });
      }
      if (box.text) page.drawText(box.text, { x: box.x + 4, y: y + box.height - box.fontSize - 4, size: box.fontSize, font, color: toRgb(box.fontColor) });
    }
  }

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const width = page.getWidth();
    const height = page.getHeight();
    const drawSection = (config, header) => {
      if (!config.enabled) return;
      const y = header ? height - config.margin - config.fontSize : config.margin;
      for (const [align, template] of [['left', config.left], ['center', config.center], ['right', config.right]]) {
        const text = resolveTemplate(template, pageNumber, pages.length, basename(input));
        if (!text) continue;
        const textWidth = font.widthOfTextAtSize(text, config.fontSize);
        const x = align === 'left' ? config.marginHorizontal : align === 'center' ? (width - textWidth) / 2 : width - config.marginHorizontal - textWidth;
        page.drawText(text, { x, y, size: config.fontSize, font, color: toRgb(config.fontColor) });
      }
    };
    drawSection(recipe.headerFooter.header, true);
    drawSection(recipe.headerFooter.footer, false);

    const numbering = recipe.pageNumbering;
    if (numbering.enabled && pageNumber >= numbering.startPage) {
      const text = pageNumberText(numbering.startNumber + pageNumber - numbering.startPage, numbering);
      const textWidth = font.widthOfTextAtSize(text, numbering.fontSize);
      const top = numbering.position.startsWith('top');
      const x = numbering.position.endsWith('left') ? numbering.margin
        : numbering.position.endsWith('right') ? width - numbering.margin - textWidth : (width - textWidth) / 2;
      const y = top ? height - numbering.margin - numbering.fontSize : numbering.margin;
      page.drawText(text, { x, y, size: numbering.fontSize, font, color: toRgb(numbering.fontColor) });
    }
  });
  await save(output, await document.save());
}

const [, , command, ...args] = process.argv;
try {
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
  } else if (command === 'merge') {
    const [output, ...inputs] = args;
    if (!output) fail('Missing output path');
    else await merge(output, inputs);
  } else if (command === 'extract' || command === 'reorder') {
    const [input, output, pages] = args;
    if (!input || !output || !pages) fail(`${command} requires input, output, and pages`);
    else await selectPages(input, output, pages);
  } else if (command === 'images-to-pdf') {
    const [output, ...inputs] = args;
    if (!output) fail('Missing output path');
    else await imagesToPdf(output, inputs);
  } else if (command === 'apply-recipe') {
    const [input, output, recipe] = args;
    if (!input || !output || !recipe) fail('apply-recipe requires input, output, and recipe JSON');
    else await applyRecipe(input, output, recipe);
  } else {
    fail(`Unknown command: ${command}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
