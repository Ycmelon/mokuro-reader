<script lang="ts">
  import {
    dictPopup,
    popupStack,
    closePopup,
    activeTextBox,
    clearActiveTextBox,
    lookupReference,
    popupGoBack
  } from '$lib/dictionary/lookup';
  import StructuredContent from './StructuredContent.svelte';
  import { miscSettings } from '$lib/settings';

  let popupEl: HTMLElement | undefined = $state();
  let popup = $derived($dictPopup);
  let canGoBack = $derived($popupStack.length > 0);
  let popupHeight = $derived($miscSettings.dictionaryPopupHeight ?? 30);

  // Cross-reference links inside definitions look like
  // `?query=<encoded-term>&wildcards=off&...`. Intercept them and look the
  // referenced entry up instead of navigating the browser. External links
  // (full http(s) URLs) are left to open normally.
  function handlePopupClick(e: MouseEvent) {
    const anchor = (e.target as Element | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('?')) return; // external link — let it open
    e.preventDefault();
    const match = href.match(/[?&]query=([^&]+)/);
    if (match) {
      const term = decodeURIComponent(match[1]);
      lookupReference(term);
      popupEl?.scrollTo({ top: 0 });
    }
  }

  /**
   * Staged dismiss (mobile flow):
   *  - tap inside the definition panel        → ignore
   *  - tap inside any text box                → ignore (the box handles it)
   *  - tap elsewhere while a definition is up  → close the definition only
   *  - tap elsewhere with no definition up     → hide the active text box
   */
  function handleDocumentMousedown(e: MouseEvent) {
    const target = e.target;
    if (popupEl && target instanceof Node && popupEl.contains(target)) return;
    if (target instanceof Element && target.closest('.textBox')) return;

    if (popup) {
      closePopup();
    } else if ($activeTextBox) {
      clearActiveTextBox();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (canGoBack) popupGoBack();
      else if (popup) closePopup();
      else clearActiveTextBox();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onmousedown={handleDocumentMousedown} />

{#if popup}
  <!-- Inject the dictionary's own styles.css, scoped to .dict-definitions -->
  {@html `<style>${popup.css}</style>`}

  <!-- Click is delegated to the <a> cross-reference links inside, which are
       themselves keyboard-accessible (Enter fires a click). -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    bind:this={popupEl}
    class="dict-popup"
    style:height="{popupHeight}vh"
    role="dialog"
    aria-label="Dictionary lookup"
    tabindex="-1"
    onclick={handlePopupClick}
  >
    {#if canGoBack}
      <button class="dict-back" aria-label="Back" onclick={popupGoBack}>‹ Back</button>
    {/if}
    <button class="dict-close" aria-label="Close" onclick={closePopup}>×</button>

    {#each popup.results as result}
      <div class="dict-entry">
        <div class="dict-headword">
          <span class="dict-expression">{result.expression}</span>
          {#if result.reading && result.reading !== result.expression}
            <span class="dict-reading">【{result.reading}】</span>
          {/if}
          {#if result.inflectionPath.length > 0}
            <span class="dict-inflection">{result.inflectionPath.join(' › ')}</span>
          {/if}
        </div>

        <div class="dict-definitions">
          {#each result.definitions as def}
            <div class="dict-def">
              {#if typeof def === 'string'}
                {def}
              {:else}
                <StructuredContent content={def} />
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#if popup.results.length === 0}
      <p class="dict-no-results">No results</p>
    {/if}
  </div>
{/if}

<style>
  .dict-popup {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 30vh;
    z-index: 1000;
    background: var(--color-gray-800);
    color: var(--color-gray-50);
    border-top: 1px solid var(--color-gray-700);
    border-radius: 1rem 1rem 0 0;
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.35);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    font-size: 14px;
    line-height: 1.5;
  }

  .dict-close {
    position: sticky;
    top: 0;
    float: right;
    margin: 6px 8px 0 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: var(--color-gray-700);
    color: var(--color-gray-300);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }

  .dict-close:hover {
    background: var(--color-gray-600);
  }

  .dict-back {
    position: sticky;
    top: 0;
    float: left;
    margin: 6px 0 0 8px;
    padding: 0 10px;
    height: 28px;
    border: none;
    border-radius: 14px;
    background: var(--color-gray-700);
    color: var(--color-gray-300);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }

  .dict-back:hover {
    background: var(--color-gray-600);
  }

  /* Cross-reference links inside definitions */
  .dict-definitions :global(a[href^='?']) {
    color: var(--color-primary-400);
    cursor: pointer;
    text-decoration: none;
  }

  .dict-definitions :global(a[href^='?']:hover) {
    text-decoration: underline;
  }

  .dict-entry {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-gray-700);
  }

  .dict-entry:last-child {
    border-bottom: none;
  }

  .dict-headword {
    margin-bottom: 4px;
  }

  .dict-expression {
    font-size: 20px;
    font-weight: 700;
    font-family: 'Noto Sans JP', sans-serif;
  }

  .dict-reading {
    font-size: 13px;
    color: var(--color-gray-400);
    margin-left: 4px;
    font-family: 'Noto Sans JP', sans-serif;
  }

  /* Deinflection trace — not part of the dictionary, kept minimal/neutral */
  .dict-inflection {
    display: inline-block;
    margin-left: 6px;
    font-size: 11px;
    color: var(--color-primary-400);
    font-style: italic;
  }

  .dict-definitions {
    font-size: 13px;
  }

  .dict-def {
    margin-bottom: 2px;
  }

  .dict-no-results {
    padding: 12px 14px;
    color: var(--color-gray-400);
    font-style: italic;
    margin: 0;
  }
</style>
