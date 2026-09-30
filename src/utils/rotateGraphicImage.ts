/** Lossless quarter-turn of an imported raster, retaining transparent signature pixels. */
export function rotateGraphicImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('画像を回転できませんでした'));
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalHeight;
        canvas.height = image.naturalWidth;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像の回転に必要な描画領域を作成できませんでした');
        context.translate(canvas.width, 0);
        context.rotate(Math.PI / 2);
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    image.src = dataUrl;
  });
}
