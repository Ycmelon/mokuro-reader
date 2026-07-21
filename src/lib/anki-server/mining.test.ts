import { describe, expect, it } from 'vitest';
import { screenRectToImageCrop } from './mining';
import { findRenderedPage } from '$lib/reader/page-image';

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

describe('findRenderedPage', () => {
  it('resolves a remounted page instead of retaining the detached page', () => {
    const oldPage = document.createElement('div');
    oldPage.dataset.pageIndex = '4';
    oldPage.dataset.volumeUuid = 'volume-a';
    document.body.append(oldPage);

    expect(findRenderedPage('volume-a', 4)).toBe(oldPage);

    oldPage.remove();
    const remountedPage = document.createElement('div');
    remountedPage.dataset.pageIndex = '4';
    remountedPage.dataset.volumeUuid = 'volume-a';
    document.body.append(remountedPage);

    expect(findRenderedPage('volume-a', 4)).toBe(remountedPage);
    remountedPage.remove();
  });

  it('does not return a page with the same index from another volume', () => {
    const page = document.createElement('div');
    page.dataset.pageIndex = '2';
    page.dataset.volumeUuid = 'volume-b';
    document.body.append(page);

    expect(findRenderedPage('volume-a', 2)).toBeNull();
    page.remove();
  });

  it('prefers the incoming page while a transition keeps both copies mounted', () => {
    const outgoing = document.createElement('div');
    outgoing.dataset.pageIndex = '6';
    outgoing.dataset.volumeUuid = 'volume-a';
    const incoming = outgoing.cloneNode() as HTMLElement;
    document.body.append(outgoing, incoming);

    expect(findRenderedPage('volume-a', 6)).toBe(incoming);
    outgoing.remove();
    incoming.remove();
  });
});
