<script lang="ts">
  import {
    dictPopup,
    popupStack,
    closePopup,
    activeTextBox,
    clearActiveTextBox,
    clearWordHighlight,
    lookupReference,
    popupGoBack
  } from '$lib/dictionary/lookup';
  import StructuredContent from './StructuredContent.svelte';
  import { miscSettings, settings } from '$lib/settings';
  import { CreditCardPlusAltOutline } from 'flowbite-svelte-icons';
  import { startMining } from '$lib/anki-server/mining';

  // The mine button only makes sense when the active protocol has a live
  // connection: a server session for 'server', a connected AnkiConnect for
  // 'ankiconnect'.
  let canMine = $derived(
    $miscSettings.ankiServerSettings.protocol === 'server'
      ? $miscSettings.ankiServerSettings.token !== ''
      : ($settings.ankiConnectSettings.connectionData?.connected ?? false)
  );

  let popupEl: HTMLElement | undefined = $state();
  let popup = $derived($dictPopup);
  let canGoBack = $derived($popupStack.length > 0);
  let popupHeight = $derived($miscSettings.dictionaryPopupHeight ?? 30);

  // Japanese text uses the bundled textbook font unless the user opts out, in
  // which case it falls back to the pre-bundle stacks. Driven as CSS variables
  // on the popup so the scoped rules below stay declarative.
  let headwordFont = $derived(
    $settings.textbookFont
      ? "'UD Digi Kyokasho', 'Noto Sans JP', sans-serif"
      : "'Noto Sans JP', sans-serif"
  );
  let definitionFont = $derived(
    $settings.textbookFont
      ? "'UD Digi Kyokasho', var(--font-sans, sans-serif)"
      : 'var(--font-sans, sans-serif)'
  );

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
      // The tapped-character highlight survives a no-match lookup as feedback
      // (closePopup never ran) — dismissing the box must take it along.
      clearWordHighlight();
    }
  }

  // Escape is handled by the reader's capture-phase coordinator
  // (Reader.svelte handleEscapeCapture), which layers this popup against the
  // other reader overlays and the layout's global back-navigation.
</script>

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
    style:--dict-headword-font={headwordFont}
    style:--dict-definition-font={definitionFont}
    role="dialog"
    aria-label="Dictionary lookup"
    tabindex="-1"
    onclick={handlePopupClick}
  >
    {#if canGoBack}
      <button class="dict-back" aria-label="Back" onclick={popupGoBack}>‹ Back</button>
    {/if}
    <button class="dict-close" aria-label="Close" onclick={closePopup}>×</button>
    {#if canMine}
      <!-- One mine button for the whole lookup: the focus is the tapped word as
           written in the sentence, so it doesn't depend on which entry is shown. -->
      <button
        class="dict-mine"
        aria-label="Mine card"
        title="Mine card"
        onclick={() => {
          startMining();
          closePopup();
        }}
      >
        <CreditCardPlusAltOutline size="sm" />
      </button>
    {/if}

    {#each popup.results as result}
      {@const allReadings = [result.reading, ...result.altReadings].filter(
        (r) => r && r !== result.expression
      )}
      <div class="dict-entry">
        <div class="dict-headword">
          <span class="dict-expression">{result.expression}</span>
          {#if result.altExpressions.length > 0}
            <span class="dict-alt-expressions">{result.altExpressions.join('・')}</span>
          {/if}
          {#if allReadings.length > 0}
            <span class="dict-reading">【{allReadings.join('・')}】</span>
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

  /* Header mine button — one per lookup. Sticky + floated right so it sits just
     left of the sticky close button without displacing the headword; z-index
     keeps it above the close button's stacking neighbours. */
  .dict-mine {
    position: sticky;
    top: 0;
    float: right;
    margin: 6px 44px 0 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: var(--color-primary-600);
    color: #fff;
    cursor: pointer;
    z-index: 1;
  }

  .dict-mine:hover {
    background: var(--color-primary-500);
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
    font-family: var(--dict-headword-font, 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif);
  }

  /* Alternative writings of the same word (merged by JMdict sequence) */
  .dict-alt-expressions {
    font-size: 15px;
    color: var(--color-gray-400);
    margin-left: 6px;
    font-family: var(--dict-headword-font, 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif);
  }

  .dict-reading {
    font-size: 13px;
    color: var(--color-gray-400);
    margin-left: 4px;
    font-family: var(--dict-headword-font, 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif);
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
    /* Japanese text in definitions and example sentences uses the textbook
       font (restricted to Japanese codepoints via unicode-range in app.css);
       English glosses fall through to the app's normal default font. The
       textbook font is dropped when the textbookFont setting is off. */
    font-family: var(--dict-definition-font, 'UD Digi Kyokasho', var(--font-sans, sans-serif));
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
