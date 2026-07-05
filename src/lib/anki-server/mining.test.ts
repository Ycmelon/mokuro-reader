import { describe, expect, it } from 'vitest';
import { screenRectToImageCrop } from './mining';

// An 800×1200 image displayed 400px wide at (100, 50) → uniform scale of 2.
const pageBox = { left: 100, top: 50, width: 400 };
const IMG_W = 800;
const IMG_H = 1200;

describe('screenRectToImageCrop', () => {
  it('scales a rect fully inside the page into image pixels', () => {
    const crop = screenRectToImageCrop(
      { left: 150, top: 100, width: 100, height: 50 },
      pageBox,
      IMG_W,
      IMG_H
    );
    expect(crop).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it('clips a rect that overhangs the page edges to the intersection', () => {
    // Starts 50px left of and above the page; only the overlapping part counts.
    const crop = screenRectToImageCrop(
      { left: 50, top: 0, width: 100, height: 100 },
      pageBox,
      IMG_W,
      IMG_H
    );
    expect(crop).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('clips a rect overhanging the bottom-right corner', () => {
    // Page spans x:[100,500], y:[50,650] on screen (image is 1200 tall at 2×).
    const crop = screenRectToImageCrop(
      { left: 480, top: 630, width: 100, height: 100 },
      pageBox,
      IMG_W,
      IMG_H
    );
    expect(crop).toEqual({ x: 760, y: 1160, width: 40, height: 40 });
  });

  it('returns null when the rect misses the page entirely', () => {
    // Right of the page.
    expect(
      screenRectToImageCrop({ left: 520, top: 100, width: 50, height: 50 }, pageBox, IMG_W, IMG_H)
    ).toBeNull();
    // Above the page.
    expect(
      screenRectToImageCrop({ left: 150, top: 0, width: 50, height: 40 }, pageBox, IMG_W, IMG_H)
    ).toBeNull();
  });

  it('returns null for a sub-pixel sliver of overlap', () => {
    expect(
      screenRectToImageCrop({ left: 99.8, top: 100, width: 0.3, height: 50 }, pageBox, IMG_W, IMG_H)
    ).toBeNull();
  });
});
