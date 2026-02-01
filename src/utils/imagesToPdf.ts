import { jsPDF } from 'jspdf';

export interface ImageFile {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
}

export async function imagesToPdf(
  images: ImageFile[],
  onProgress?: (progress: number) => void
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('No images to convert');
  }

  // 最初の画像のサイズでPDFを作成
  const firstImage = images[0];
  const pdf = new jsPDF({
    orientation: firstImage.width > firstImage.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [firstImage.width, firstImage.height],
  });

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    if (i > 0) {
      pdf.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
    }

    pdf.addImage(img.preview, 'JPEG', 0, 0, img.width, img.height);

    if (onProgress) {
      onProgress(((i + 1) / images.length) * 100);
    }
  }

  return pdf.output('blob');
}

export function loadImage(file: File): Promise<ImageFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          file,
          preview: e.target?.result as string,
          width: img.width,
          height: img.height,
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
