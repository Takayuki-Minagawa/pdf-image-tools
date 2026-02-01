import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js workerの設定
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ConvertedImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export async function pdfToImages(
  file: File,
  scale: number = 2,
  onProgress?: (progress: number) => void
): Promise<ConvertedImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: ConvertedImage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    images.push({
      pageNumber: i,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
    });

    if (onProgress) {
      onProgress((i / pdf.numPages) * 100);
    }
  }

  return images;
}
