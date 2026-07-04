<script lang="ts">
  import { miningStage, finishCrop, cancelMining } from '$lib/anki-server/mining';

  // Crop rectangle in viewport coordinates (the overlay is position: fixed, so
  // client coords map straight to l/t). null until the user starts drawing.
  let rect = $state<{ l: number; t: number; w: number; h: number } | null>(null);

  const MIN_SIZE = 8; // px; below this a rect is treated as "not drawn yet"

  type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const HANDLES: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  type Interaction = {
    mode: 'draw' | 'move' | Dir;
    startX: number;
    startY: number;
    startRect: { l: number; t: number; w: number; h: number };
  };
  let active: Interaction | null = null;

  let hasRect = $derived(rect !== null && rect.w >= MIN_SIZE && rect.h >= MIN_SIZE);

  // On entering crop mode, restore the previous box (Redo crop) if there is one;
  // otherwise start empty so the user draws fresh. Clear on exit.
  let wasCropping = false;
  $effect(() => {
    const stage = $miningStage;
    if (stage.kind === 'crop') {
      if (!wasCropping) rect = stage.draft.cropRect ?? null;
      wasCropping = true;
    } else {
      rect = null;
      wasCropping = false;
    }
  });

  function normalize(l: number, t: number, r: number, b: number) {
    return { l: Math.min(l, r), t: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };
  }

  // pointermove fires far faster than the display refresh; coalesce to one state
  // update per frame so mobile doesn't drown in re-renders/style recalcs.
  let pendingMove: PointerEvent | null = null;
  let rafId = 0;

  function scheduleMove(e: PointerEvent) {
    pendingMove = e;
    if (!rafId) rafId = requestAnimationFrame(flushMove);
  }

  function flushMove() {
    rafId = 0;
    const e = pendingMove;
    pendingMove = null;
    if (e && active) applyMove(e);
  }

  function applyMove(e: PointerEvent) {
    if (!active) return;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    const s = active.startRect;

    if (active.mode === 'draw') {
      rect = normalize(active.startX, active.startY, e.clientX, e.clientY);
      return;
    }
    if (active.mode === 'move') {
      rect = { l: s.l + dx, t: s.t + dy, w: s.w, h: s.h };
      return;
    }

    // Resize: move only the edges named in the handle direction.
    let l = s.l;
    let t = s.t;
    let r = s.l + s.w;
    let b = s.t + s.h;
    if (active.mode.includes('w')) l += dx;
    if (active.mode.includes('e')) r += dx;
    if (active.mode.includes('n')) t += dy;
    if (active.mode.includes('s')) b += dy;
    rect = normalize(l, t, r, b);
  }

  function endInteraction(e: PointerEvent) {
    active = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingMove = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    window.removeEventListener('pointermove', scheduleMove);
    window.removeEventListener('pointerup', endInteraction);
  }

  function begin(e: PointerEvent, mode: Interaction['mode']) {
    e.preventDefault();
    e.stopPropagation();
    active = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: rect ?? { l: e.clientX, t: e.clientY, w: 0, h: 0 }
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', scheduleMove);
    window.addEventListener('pointerup', endInteraction);
  }

  // Pointerdown on the backdrop starts a fresh draw (replaces any prior rect).
  function onBackdropDown(e: PointerEvent) {
    rect = null;
    begin(e, 'draw');
  }

  async function onDone() {
    if (!rect || !hasRect) return;
    await finishCrop(new DOMRect(rect.l, rect.t, rect.w, rect.h));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelMining();
    else if (e.key === 'Enter' && hasRect) onDone();
  }
</script>

<svelte:window onkeydown={$miningStage.kind === 'crop' ? onKeydown : undefined} />

{#if $miningStage.kind === 'crop'}
  <!-- Full-viewport capture surface. Intercepts all pointer events, which also
       suspends reader pan/zoom while cropping (modal surface). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="crop-backdrop" onpointerdown={onBackdropDown}>
    {#if rect}
      <!-- Dim everything outside the rect with four solid panels (cheaper to
           repaint per-frame than a full-screen spread box-shadow on mobile).
           pointer-events:none so draws pass through to the backdrop. -->
      <div
        class="dim-panel"
        style:left="0"
        style:top="0"
        style:right="0"
        style:height="{rect.t}px"
      ></div>
      <div
        class="dim-panel"
        style:left="0"
        style:top="{rect.t + rect.h}px"
        style:right="0"
        style:bottom="0"
      ></div>
      <div
        class="dim-panel"
        style:left="0"
        style:top="{rect.t}px"
        style:width="{rect.l}px"
        style:height="{rect.h}px"
      ></div>
      <div
        class="dim-panel"
        style:left="{rect.l + rect.w}px"
        style:top="{rect.t}px"
        style:right="0"
        style:height="{rect.h}px"
      ></div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="crop-rect"
        style:left="{rect.l}px"
        style:top="{rect.t}px"
        style:width="{rect.w}px"
        style:height="{rect.h}px"
        onpointerdown={(e) => begin(e, 'move')}
      >
        {#each HANDLES as dir}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="handle {dir}" onpointerdown={(e) => begin(e, dir)}></div>
        {/each}
      </div>
    {/if}

    <div class="crop-hint">
      {hasRect ? 'Drag to move · handles to resize' : 'Draw a box around the panel'}
    </div>

    <div class="crop-actions">
      <button class="btn cancel" onpointerdown={(e) => e.stopPropagation()} onclick={cancelMining}>
        Cancel
      </button>
      <button
        class="btn done"
        disabled={!hasRect}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={onDone}
      >
        Done
      </button>
    </div>
  </div>
{/if}

<style>
  .crop-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    touch-action: none;
    cursor: crosshair;
    /* A faint tint so it's obvious the crop mode is active even before drawing. */
    background: rgba(0, 0, 0, 0.15);
  }

  .dim-panel {
    position: absolute;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }

  .crop-rect {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid #fff;
    outline: 1px solid rgba(0, 0, 0, 0.6);
    cursor: move;
    touch-action: none;
  }

  .handle {
    position: absolute;
    width: 16px;
    height: 16px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    touch-action: none;
  }

  .handle.nw {
    left: -8px;
    top: -8px;
    cursor: nwse-resize;
  }
  .handle.n {
    left: calc(50% - 8px);
    top: -8px;
    cursor: ns-resize;
  }
  .handle.ne {
    right: -8px;
    top: -8px;
    cursor: nesw-resize;
  }
  .handle.e {
    right: -8px;
    top: calc(50% - 8px);
    cursor: ew-resize;
  }
  .handle.se {
    right: -8px;
    bottom: -8px;
    cursor: nwse-resize;
  }
  .handle.s {
    left: calc(50% - 8px);
    bottom: -8px;
    cursor: ns-resize;
  }
  .handle.sw {
    left: -8px;
    bottom: -8px;
    cursor: nesw-resize;
  }
  .handle.w {
    left: -8px;
    top: calc(50% - 8px);
    cursor: ew-resize;
  }

  .crop-hint {
    position: fixed;
    top: max(12px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 13px;
    pointer-events: none;
    white-space: nowrap;
  }

  .crop-actions {
    position: fixed;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn.cancel {
    background: rgba(255, 255, 255, 0.9);
    color: #111;
  }

  .btn.done {
    background: var(--color-primary-600, #2563eb);
    color: #fff;
  }

  .btn.done:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
