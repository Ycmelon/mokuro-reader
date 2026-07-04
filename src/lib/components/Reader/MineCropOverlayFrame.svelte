<script lang="ts">
  import { miningStage, finishCrop, cancelMining } from '$lib/anki-server/mining';

  // Framing crop: the page underneath stays live (pan/zoom keep working because
  // this overlay is pointer-events:none except on the box's grips/controls). The
  // user frames the panel by moving the page under a fixed, movable/resizable
  // window, then presses Done — finishCrop reads the page's live rect, so the
  // current zoom/pan is captured with no extra math.

  type Rect = { l: number; t: number; w: number; h: number };
  let rect = $state<Rect | null>(null);

  const MIN = 40; // px minimum box size
  type Dir = 'nw' | 'ne' | 'se' | 'sw';
  const CORNERS: Dir[] = ['nw', 'ne', 'se', 'sw'];

  type Interaction = { mode: 'move' | Dir; startX: number; startY: number; startRect: Rect };
  let active: Interaction | null = null;

  function centeredRect(): Rect {
    // Start small: the user pans the page to frame the panel, then grows the box.
    const w = Math.min(window.innerWidth * 0.5, 260);
    const h = Math.min(window.innerHeight * 0.3, 200);
    return { l: (window.innerWidth - w) / 2, t: (window.innerHeight - h) / 2, w, h };
  }

  function clampRect(r: Rect): Rect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.max(MIN, Math.min(r.w, vw));
    const h = Math.max(MIN, Math.min(r.h, vh));
    const l = Math.max(0, Math.min(r.l, vw - w));
    const t = Math.max(0, Math.min(r.t, vh - h));
    return { l, t, w, h };
  }

  // On entering crop mode, restore the previous box (Redo crop) or start from a
  // centred default; clear on exit.
  let wasCropping = false;
  $effect(() => {
    const stage = $miningStage;
    if (stage.kind === 'crop') {
      if (!wasCropping) rect = stage.draft.cropRect ?? centeredRect();
      wasCropping = true;
    } else {
      rect = null;
      wasCropping = false;
    }
  });

  // Coalesce pointermove to one update per frame (mobile perf).
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

    if (active.mode === 'move') {
      rect = clampRect({ l: s.l + dx, t: s.t + dy, w: s.w, h: s.h });
      return;
    }

    // Resize from a corner: move the two edges that corner touches.
    let l = s.l;
    let t = s.t;
    let r = s.l + s.w;
    let b = s.t + s.h;
    if (active.mode.includes('w')) l += dx;
    if (active.mode.includes('e')) r += dx;
    if (active.mode.includes('n')) t += dy;
    if (active.mode.includes('s')) b += dy;
    rect = clampRect({
      l: Math.min(l, r),
      t: Math.min(t, b),
      w: Math.abs(r - l),
      h: Math.abs(b - t)
    });
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
    if (!rect) return;
    // Only claim single-pointer drags on the grips; let anything else (incl.
    // multi-touch pinch) fall through to the reader for pan/zoom.
    e.preventDefault();
    e.stopPropagation();
    active = { mode, startX: e.clientX, startY: e.clientY, startRect: rect };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', scheduleMove);
    window.addEventListener('pointerup', endInteraction);
  }

  async function onDone() {
    if (!rect) return;
    await finishCrop(new DOMRect(rect.l, rect.t, rect.w, rect.h));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelMining();
    else if (e.key === 'Enter') onDone();
  }
</script>

<svelte:window onkeydown={$miningStage.kind === 'crop' ? onKeydown : undefined} />

{#if $miningStage.kind === 'crop' && rect}
  <!-- Root is pointer-events:none so page pan/zoom stays live underneath. -->
  <div class="frame-root">
    <!-- Dim panels around the window (pointer-events:none, purely visual). -->
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

    <!-- The window: a pointerdown inside it moves the box; outside it falls
         through to the reader, so a drag on the page pans/zooms instead. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="frame-box"
      style:left="{rect.l}px"
      style:top="{rect.t}px"
      style:width="{rect.w}px"
      style:height="{rect.h}px"
      onpointerdown={(e) => begin(e, 'move')}
    >
      {#each CORNERS as dir}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="corner {dir}" onpointerdown={(e) => begin(e, dir)}></div>
      {/each}
    </div>

    <div class="frame-actions">
      <button class="btn cancel" onclick={cancelMining}>Cancel</button>
      <button class="btn done" onclick={onDone}>Done</button>
    </div>
  </div>
{/if}

<style>
  .frame-root {
    position: fixed;
    inset: 0;
    z-index: 2000;
    /* Let empty areas fall through so the reader keeps handling pan/zoom. */
    pointer-events: none;
  }

  .dim-panel {
    position: absolute;
    background: rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }

  .frame-box {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid #fff;
    outline: 1px solid rgba(0, 0, 0, 0.6);
    /* The box body captures drags to move itself; areas outside stay pass-through
       (root is pointer-events:none) so the reader handles pan/zoom there. */
    pointer-events: auto;
    cursor: move;
    touch-action: none;
  }

  .corner {
    position: absolute;
    width: 28px;
    height: 28px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    pointer-events: auto;
    touch-action: none;
  }

  .corner.nw {
    left: -14px;
    top: -14px;
    cursor: nwse-resize;
  }
  .corner.ne {
    right: -14px;
    top: -14px;
    cursor: nesw-resize;
  }
  .corner.se {
    right: -14px;
    bottom: -14px;
    cursor: nwse-resize;
  }
  .corner.sw {
    left: -14px;
    bottom: -14px;
    cursor: nesw-resize;
  }

  .frame-actions {
    position: fixed;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 12px;
    pointer-events: auto;
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
</style>
