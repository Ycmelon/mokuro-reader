<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { Button, Input, Label, Spinner } from 'flowbite-svelte';
  import { showSnackbar } from '$lib/util';
  import { miscSettings } from '$lib/settings/misc';
  import {
    miningStage,
    reopenCrop,
    cancelMining,
    type MiningContext,
    type MiningDraft
  } from '$lib/anki-server/mining';
  import { buildGenerationPrompt, generateFromMessages, type CardBase } from '$lib/ai-chat/card';
  import { validateCardConfig } from '$lib/anki-server/cards';
  import { sendMinedCard } from '$lib/anki-server/send';
  import { UnauthorizedError } from '$lib/anki-server/client';
  import type { ChatMessage } from '$lib/ai-chat/openrouter';

  // Local, editable copies of the draft. Reseeded only when a *new* draft arrives
  // (initial crop, or a redo-crop) — identified by object identity — so ongoing
  // edits are never clobbered by re-renders.
  let sentence = $state('');
  let focus = $state('');
  let image = $state<string | null>(null);
  let lastDraft: MiningDraft | null = null;

  // AI-generated fields, filled by "Generate" and then editable.
  let reading = $state('');
  let meaning = $state('');
  let extra = $state('');
  let comments = $state(''); // AI note about any OCR fixes it made (usually empty)
  let feedback = $state(''); // user steer, sent to the model on Regenerate
  let generated = $state(false);
  let generating = $state(false);
  let genError = $state('');
  let sending = $state(false); // true while a card POST is in flight
  // Set when a Redo crop is in flight, so the returning draft only swaps the
  // image and keeps the generated content instead of resetting it.
  let redoing = false;
  // Running refinement conversation: each Regenerate appends the feedback turn
  // and the model's reply, so successive edits build on prior ones. Reset on a
  // fresh mine; preserved across a Redo crop.
  let cardHistory: ChatMessage[] = [];

  let cardEl = $state<HTMLDivElement>(); // scroll container, for auto-scroll after generation

  const taClass =
    'block w-full resize-none overflow-hidden rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm text-gray-900 focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

  // Auto-grow a textarea to fit its content. The bound value is passed as the
  // action param so programmatic changes (e.g. after generation) re-measure.
  function autogrow(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    node.addEventListener('input', resize);
    return {
      update: (_v: string) => requestAnimationFrame(resize),
      destroy: () => node.removeEventListener('input', resize)
    };
  }

  $effect(() => {
    const stage = $miningStage;
    if (stage.kind === 'idle') {
      redoing = false;
      return;
    }
    if (stage.kind === 'review' && stage.draft !== lastDraft) {
      lastDraft = stage.draft;
      image = stage.draft.image;
      if (redoing) {
        // Redo crop of the same card: keep sentence/focus + generated content,
        // only swap in the freshly cropped image.
        redoing = false;
      } else {
        // A fresh mine invalidates any prior generation.
        sentence = stage.draft.sentence;
        focus = stage.draft.focus;
        reading = meaning = extra = comments = feedback = '';
        cardHistory = [];
        generated = false;
        genError = '';
      }
      generating = false;
    }
  });

  function base(): CardBase {
    return { sentence, focus, image: image ?? '' };
  }

  function onRedoCrop() {
    // Flag the round-trip so the returning draft keeps the generated content.
    redoing = true;
    // Carry the current edits back so they survive the crop round-trip.
    reopenCrop({ sentence, focus, image });
  }

  async function onGenerate() {
    generating = true;
    genError = '';
    try {
      // First generation seeds the sentence/focus; each later one appends the
      // feedback (with the current, possibly-edited sentence/focus) so the model
      // revises its previous card rather than starting over.
      const userTurn: ChatMessage = {
        role: 'user',
        content: generated
          ? `Updated sentence: ${sentence}\nUpdated focus: ${focus}` +
            (feedback.trim() ? `\nFeedback: ${feedback.trim()}` : '\nPlease revise the card.')
          : buildGenerationPrompt(base())
      };
      const messages = [...cardHistory, userTurn];
      const { fields, reply } = await generateFromMessages(messages);
      cardHistory = [...messages, { role: 'assistant', content: reply }];

      // Merge only the fields the model actually returned — regenerations omit
      // unchanged fields, so replacing wholesale would blank them.
      if (fields.sentence) sentence = fields.sentence; // corrected OCR, if any
      if (fields.focus) focus = fields.focus;
      if (fields.reading !== undefined) reading = fields.reading;
      if (fields.meaning !== undefined) meaning = fields.meaning;
      if (fields.extra !== undefined) extra = fields.extra;
      if (fields.comments !== undefined) comments = fields.comments;
      feedback = ''; // consumed into history; ready for the next steer
      generated = true;
      await tick();
      requestAnimationFrame(() =>
        cardEl?.scrollTo({ top: cardEl.scrollHeight, behavior: 'smooth' })
      );
    } catch (e) {
      genError = e instanceof Error ? e.message : String(e);
    } finally {
      generating = false;
    }
  }

  async function onSendToAnki() {
    const stage = get(miningStage);
    if (stage.kind !== 'review') return;
    const ctx: MiningContext = stage.ctx;
    const cfg = get(miscSettings).ankiServerSettings;

    const configError = validateCardConfig(cfg);
    if (configError) {
      genError = configError;
      return;
    }

    sending = true;
    genError = '';
    try {
      await sendMinedCard(
        { word: focus, reading, meaning, sentence, extra, image: image ?? '' },
        cfg,
        {
          seriesTitle: ctx.seriesTitle,
          volumeTitle: ctx.volumeTitle,
          volumeUuid: ctx.volumeUuid,
          pageIndex: ctx.pageIndex
        }
      );
      showSnackbar(`Card added to ${cfg.deck}`);
      cancelMining();
    } catch (e) {
      // Keep the dialog open so the user can fix and retry without re-mining.
      genError =
        e instanceof UnauthorizedError
          ? 'Session expired — log in again in Settings → Anki.'
          : e instanceof Error
            ? e.message
            : String(e);
    } finally {
      sending = false;
    }
  }
</script>

{#if $miningStage.kind === 'review'}
  <div class="review-scrim" style="z-index: 2000;">
    <div class="review-card" bind:this={cardEl}>
      <h2 class="mb-1 text-lg font-semibold text-gray-900 dark:text-white">Review card</h2>

      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">Sentence</Label>
        <textarea class={taClass} rows="1" bind:value={sentence} use:autogrow={sentence}></textarea>
      </div>

      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">Focus</Label>
        <Input bind:value={focus} class="w-full" />
      </div>

      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">Image</Label>
        {#if image}
          <img src={image} alt="Cropped card" class="review-image" />
        {:else}
          <p class="text-sm text-gray-500">No image</p>
        {/if}
        <Button size="sm" color="alternative" class="mt-2" onclick={onRedoCrop}>Redo crop</Button>
      </div>

      {#if generated}
        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Reading</Label>
          <Input bind:value={reading} class="w-full" />
        </div>
        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Meaning</Label>
          <textarea class={taClass} rows="1" bind:value={meaning} use:autogrow={meaning}></textarea>
        </div>
        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Extra</Label>
          <textarea class={taClass} rows="1" bind:value={extra} use:autogrow={extra}></textarea>
        </div>
        {#if comments}
          <p class="text-sm text-amber-600 dark:text-amber-400">{comments}</p>
        {/if}
        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Feedback (applied on Regenerate)</Label>
          <textarea
            class={taClass}
            rows="1"
            bind:value={feedback}
            use:autogrow={feedback}
            placeholder="e.g. keep the meaning shorter, explain the grammar…"
          ></textarea>
        </div>
      {/if}

      {#if genError}
        <div class="rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-900 dark:text-red-200">
          {genError}
        </div>
      {/if}

      <div class="relative z-10 flex flex-wrap justify-end gap-2 pt-1">
        <Button color="alternative" onclick={cancelMining} disabled={sending}>Cancel</Button>
        {#if generated}
          <Button color="alternative" onclick={onGenerate} disabled={generating || sending}>
            {generating ? 'Regenerating…' : 'Regenerate'}
          </Button>
          <Button color="primary" onclick={onSendToAnki} disabled={sending}>
            {#if sending}<Spinner size="4" class="me-2" />Sending…{:else}Send to Anki{/if}
          </Button>
        {:else}
          <Button color="primary" onclick={onGenerate} disabled={generating}>
            {#if generating}<Spinner size="4" class="me-2" />Generating…{:else}Generate{/if}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .review-scrim {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.5);
  }

  .review-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 20px;
    border-radius: 12px;
    background: var(--color-gray-800, #1f2937);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  }

  .review-image {
    max-width: 100%;
    max-height: 40vh;
    border-radius: 6px;
    object-fit: contain;
  }
</style>
