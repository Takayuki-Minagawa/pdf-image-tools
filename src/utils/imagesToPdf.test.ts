import { describe, expect, it } from 'vitest';
import {
  calculateImagePlacement,
  fileFingerprint,
  getEffectiveImageDimensions,
  normalizePdfFileName,
  removeDuplicateFiles,
  resolvePageDimensions,
  sortImageFiles,
} from './imagesToPdf';
import type { ImageFile } from './imagesToPdf';

function fakeFile(name: string, lastModified = 0, size = 100, type = 'image/png'): File {
  return { name, lastModified, size, type } as File;
}

function fakeImage(
  name: string,
  width = 1200,
  height = 800,
  lastModified = 0,
): ImageFile {
  return {
    id: name,
    file: fakeFile(name, lastModified),
    preview: `data:image/png;base64,${name}`,
    width,
    height,
  };
}

describe('画像の実効サイズとページ設定', () => {
  it('トリミングと90度回転を実効サイズに反映する', () => {
    const image = fakeImage('scan.png', 1000, 800);
    image.adjustments = {
      rotation: 90,
      crop: { top: 10, right: 20, bottom: 15, left: 10 },
    };

    expect(getEffectiveImageDimensions(image)).toEqual({ width: 600, height: 700 });
  });

  it('画像の向きに合わせてA4横を解決する', () => {
    const page = resolvePageDimensions(fakeImage('landscape.png'), {
      pageSize: 'a4',
      orientation: 'auto',
    });

    expect(page).toEqual({ width: 297, height: 210, orientation: 'landscape' });
  });

  it('明示された縦向きを画像より優先する', () => {
    const page = resolvePageDimensions(fakeImage('landscape.png'), {
      pageSize: 'letter',
      orientation: 'portrait',
    });

    expect(page).toEqual({ width: 215.9, height: 279.4, orientation: 'portrait' });
  });
});

describe('画像配置', () => {
  it('containでは余白内の中央に画像全体を配置する', () => {
    const placement = calculateImagePlacement(200, 100, 210, 297, 10, 'contain');

    expect(placement.x).toBeCloseTo(10);
    expect(placement.y).toBeCloseTo(101);
    expect(placement.width).toBeCloseTo(190);
    expect(placement.height).toBeCloseTo(95);
  });

  it('coverでは領域全体を覆う倍率を選ぶ', () => {
    const placement = calculateImagePlacement(200, 100, 210, 297, 10, 'cover');

    expect(placement.height).toBeCloseTo(277);
    expect(placement.width).toBeCloseTo(554);
    expect(placement.x).toBeLessThan(0);
  });
});

describe('ファイル整理', () => {
  it('同一ファイルと同一ドロップ内の重複を除外する', () => {
    const existing = fakeImage('page1.png', 100, 100, 10);
    const duplicate = fakeFile('page1.png', 10);
    const unique = fakeFile('page2.png', 20);
    const result = removeDuplicateFiles([duplicate, unique, unique], [existing]);

    expect(result.files).toEqual([unique]);
    expect(result.duplicateCount).toBe(2);
    expect(fileFingerprint(result.files[0])).not.toBe(fileFingerprint(existing.file));
  });

  it('ファイル名を自然順で並べる', () => {
    const images = [fakeImage('page10.png'), fakeImage('page2.png'), fakeImage('page1.png')];

    expect(sortImageFiles(images, 'natural').map((image) => image.file.name)).toEqual([
      'page1.png',
      'page2.png',
      'page10.png',
    ]);
  });

  it('更新日時の新しい順で並べる', () => {
    const images = [fakeImage('old.png', 100, 100, 1), fakeImage('new.png', 100, 100, 9)];

    expect(sortImageFiles(images, 'modified-newest').map((image) => image.file.name)).toEqual([
      'new.png',
      'old.png',
    ]);
  });
});

describe('出力名', () => {
  it('使用できない文字を置換しpdf拡張子を一度だけ付ける', () => {
    expect(normalizePdfFileName(' my:scan?.PDF ')).toBe('my_scan_.pdf');
  });

  it('空の名前には既定名を使う', () => {
    expect(normalizePdfFileName('   ')).toBe('images_to_pdf.pdf');
  });
});
