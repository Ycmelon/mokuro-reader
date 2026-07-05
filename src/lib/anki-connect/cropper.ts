import { showSnackbar } from '$lib/util';
import { blobToBase64 } from '.';
import type { Block } from '$lib/types';

/**
 * Expands a text block's bounding box by a percentage of page dimensions.
 * Used to give some padding around the text when cropping for Anki cards.
 */
export function expandTextBoxBounds(
  block: Block,
  page: { img_width: number; img_height: number },
  horizontalPct = 0.05,
  verticalPct = 0.02
): [number, number, number, number] {
  const [xmin, ymin, xmax, ymax] = block.box;
  const expandX = page.img_width * horizontalPct;
  const expandY = page.img_height * verticalPct;

  return [
    Math.max(0, xmin - expandX),
    Math.max(0, ymin - expandY),
    Math.min(page.img_width, xmax + expandX),
    Math.min(page.img_height, ymax + expandY)
  ];
}

async function createImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous'); // needed to avoid cross-origin issues
    image.src = url;
  });
}

export type Pixels = { width: number; height: number; x: number; y: number };

/**
 * Crop `imageSrc` to `pixelCrop` and return a base64 JPEG data URL. Exported at
 * full resolution / high quality — the reader mines from a user-drawn box, so the
 * crop is already the region of interest and Anki handles storage sizing.
 */
export async function getCroppedImg(imageSrc: string, pixelCrop: Pixels) {
  const image = await createImage(imageSrc);
  const width = Math.max(1, Math.round(pixelCrop.width));
  const height = Math.max(1, Math.round(pixelCrop.height));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    showSnackbar('Error: crop failed');
    return;
  }

  // JPEG has no alpha — pre-fill so any sliver outside the source image comes
  // out white rather than black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    width,
    height
  );

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return await blobToBase64(blob);
}
