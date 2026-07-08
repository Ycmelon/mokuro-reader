<script lang="ts">
  import {
    dictPopup,
    popupStack,
    closePopup,
    activeTextBox,
    clearActiveTextBox,
    clearWordHighlight,
    popupGoBack
  } from '$lib/dictionary/lookup';
  import Definitions from './Definitions.svelte';
  import PitchAccent from './PitchAccent.svelte';
  import Star from './Star.svelte';
  import { miscSettings, settings } from '$lib/settings';
  import { startMining } from '$lib/anki-server/mining';
  import type { LookupResult } from '$lib/dictionary/types';

  let pitchMode = $derived($miscSettings.pitchAccentDisplay ?? 'downstep');

  function pitchFor(result: LookupResult, reading: string) {
    return result.pitches.find((p) => p.reading === reading);
  }

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
  <div
    bind:this={popupEl}
    class="dict-popup"
    style:height="{popupHeight}vh"
    style:--dict-headword-font={headwordFont}
    style:--dict-definition-font={definitionFont}
    role="dialog"
    aria-label="Dictionary lookup"
    tabindex="-1"
  >
    {#if canGoBack}
      <button class="dict-back" aria-label="Back" onclick={popupGoBack}>‹ Back</button>
    {/if}
    {#if canMine}
      <!-- One mine button for the whole lookup: the focus is the tapped word as
           written in the sentence, so it doesn't depend on which entry is shown. -->
      <button
        class="dict-mine"
        style:bottom="calc({popupHeight}vh - 1px)"
        onclick={() => {
          startMining();
          closePopup();
        }}
      >
        Create flashcard
      </button>
    {/if}

    {#each popup.results as result}
      <!-- Search-only forms (JMdict sK/sk) are lookup aliases only; they stay in
           the term's keys index but are never displayed. -->
      {@const writings = result.writings.filter((w) => !w.hidden)}
      {@const readings = result.readings.filter((r) => !r.hidden)}
      <!-- A word marked 'uk' (usually written in kana) has a kana form that is a
           real spelling, not just a reading gloss — render it at the kanji size.
           Without 'uk', the kana only supplies the reading and stays small. -->
      {@const usuallyKana = writings.length > 0 && result.senses.some((s) => s.misc.includes('uk'))}
      <div class="dict-entry">
        <div class="dict-headword">
          {#if writings.length > 0}
            <span class="dict-kanji"
              >{#each writings as w, i}{#if i > 0}<span class="dict-sep">、</span>{/if}<span
                  class="dict-writing"
                  class:obscure={w.obscure}
                  >{w.text}{#if w.priority}<Star />{/if}</span
                >{/each}</span
            >
          {/if}

          <span
            class="dict-reading"
            class:kana-headword={writings.length === 0}
            class:usually-kana={usuallyKana}
            >{#each readings as r, i}{#if i > 0}<span class="dict-sep">、</span>{/if}{@const pitch =
                pitchMode !== 'none' ? pitchFor(result, r.text) : undefined}<span
                class="dict-reading-item"
                class:obscure={r.obscure}
                >{#if pitch}<PitchAccent
                    reading={r.text}
                    position={pitch.positions[0]}
                    mode={pitchMode === 'binary' ? 'binary' : 'downstep'}
                  />{:else}{r.text}{/if}{#if r.priority}<Star />{/if}</span
              >{/each}</span
          >

          {#if result.inflectionPath.length > 0}
            <span class="dict-inflection">({result.inflectionPath.join(' › ')})</span>
          {/if}
        </div>

        <div class="dict-senses">
          <Definitions senses={result.senses} />
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

  /* One mine button per lookup, floating over the popup edge. */
  .dict-mine {
    position: fixed;
    left: 50%;
    transform: translate(-50%, -35%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding: 0 14px;
    border: none;
    border-radius: 8px;
    background: var(--color-gray-700);
    color: var(--color-gray-50);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    z-index: 1001;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
  }

  .dict-mine:hover {
    background: var(--color-gray-600);
  }

  .dict-entry {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-gray-700);
  }

  .dict-entry:last-child {
    border-bottom: none;
  }

  /* Inline flow (not flexbox) so wrapped lines share one uniform row height.
     A wrapping flex row's height tracks its contents, so a line carrying a
     pitch-accent graph/overline grew taller than a plain line — the uneven
     spacing. A fixed line-height makes every wrapped row identical and leaves
     headroom above the kana for the pitch marks. */
  .dict-headword {
    margin-bottom: 4px;
    line-height: 30px;
    font-family: var(--dict-headword-font, 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif);
  }

  /* Kanji headwords: the primary word, in the popup's default (near-white) text
     colour so the first line stays uncluttered. */
  .dict-kanji {
    font-size: 20px;
    color: var(--color-gray-50);
  }

  /* Readings sit quietly in grey beside the word — this is the "reading only"
     case, where the kana just tells you how to pronounce the kanji. The left
     margin separates the kana group from the word group (matches 10ten). */
  .dict-reading {
    font-size: 18px;
    color: var(--color-gray-400);
    margin-left: 16px;
  }

  /* A kana-only headword is the primary word; a 'uk' (usually-kana) word has a
     kanji form but is genuinely written in kana. Both are real spellings, so
     they take the near-white colour and the same size as the kanji headword. */
  .dict-reading.kana-headword,
  .dict-reading.usually-kana {
    font-size: 20px;
    color: var(--color-gray-50);
  }

  /* A kana-only headword leads the line, so it takes no separating indent. */
  .dict-reading.kana-headword {
    margin-left: 0;
  }

  /* Rare/old/irregular forms are de-emphasized so the standard form reads first. */
  .dict-writing.obscure,
  .dict-reading-item.obscure {
    opacity: 0.55;
  }

  .dict-sep {
    opacity: 0.6;
  }

  /* Deinflection trace — quiet grey, no italics. */
  .dict-inflection {
    font-size: 12px;
    color: var(--color-gray-400);
    margin-left: 16px;
  }

  .dict-senses {
    font-size: 13px;
    /* Japanese text in glosses and notes uses the textbook font (restricted to
       Japanese codepoints via unicode-range in app.css); English glosses fall
       through to the app's default font. */
    font-family: var(--dict-definition-font, 'UD Digi Kyokasho', var(--font-sans, sans-serif));
  }

  .dict-no-results {
    padding: 12px 14px;
    color: var(--color-gray-400);
    font-style: italic;
    margin: 0;
  }
</style>
