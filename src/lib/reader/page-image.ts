/**
 * Resolve the displayed page image URL from an element inside a rendered page
 * (e.g. an OCR text box the user invoked Anki capture on).
 *
 * The image is painted by the `.manga-page-image` layer inside the page's
 * `[data-page-index]` container (MangaPage.svelte), kept separate from the
 * text boxes so invert/grayscale filters don't trap the boxes in the image's
 * stacking context. We therefore find the page container, then read the
 * background off its image layer. A legacy ancestor-walk fallback covers any
 * element whose background still lives on an ancestor.
 */
function urlFromBackground(value: string | null | undefined): string | null {
  if (!value || value === 'none') return null;
  const match = value.match(/url\(["']?(.+?)["']?\)/);
  return match ? match[1] : null;
}

/**
 * Resolve a page from the live reader DOM rather than retaining a component
 * element. Paged navigation destroys and recreates MangaPage, so a mining
 * context that captured the original element would keep returning its detached,
 * zero-sized node even after the reader came back to the same page.
 */
export function findRenderedPage(
  volumeUuid: string,
  pageIndex: number,
  root: ParentNode = document
): HTMLElement | null {
  const index = String(pageIndex);
  const pages = root.querySelectorAll<HTMLElement>('[data-page-index]');

  // Page transitions temporarily leave the outgoing and incoming trees in the
  // DOM together. The incoming (live) tree is appended last.
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const page = pages[i];
    if (
      page.isConnected &&
      page.dataset.pageIndex === index &&
      page.dataset.volumeUuid === volumeUuid
    ) {
      return page;
    }
  }

  return null;
}

export function extractPageImageUrl(element: HTMLElement | null): string | null {
  if (!element) return null;

  const pageEl = element.closest<HTMLElement>('[data-page-index]');
  const imageLayer = pageEl?.querySelector<HTMLElement>('.manga-page-image');
  if (imageLayer) {
    const url = urlFromBackground(getComputedStyle(imageLayer).backgroundImage);
    if (url) return url;
  }

  // Fallback: traverse up looking for a background-image on any ancestor.
  let current: HTMLElement | null = element;
  while (current) {
    const url = urlFromBackground(getComputedStyle(current).backgroundImage);
    if (url) return url;
    current = current.parentElement;
  }
  return null;
}
