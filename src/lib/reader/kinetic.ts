/**
 * Kinetic ("inertial") panning — the momentum glide that follows a drag
 * release. Descended from panzoom's kinetic.js (the Apple-style exponential
 * decay), but the velocity is now measured from the REAL pointer deltas the
 * gesture tracker already reports, not by polling the surface transform on a
 * rAF loop.
 *
 * Why the change: polling the transform re-derived velocity from a value that
 * clamping, overpan and zoom-correction were also writing, and its
 * `dt = 1000/(1+elapsed)` term amplified a near-zero frame gap into an enormous
 * velocity — a small flick could "teleport" the page to the far edge. Feeding
 * pointer deltas removes that entire class of spike; a `dt` floor, a hard
 * velocity cap and a rest-timeout make the launch velocity robust.
 *
 * Two knobs shape the feel of the glide (see KineticOptions):
 *   - `amplitude`  — HOW FAR it glides. Total glide distance ≈ amplitude × v
 *                    (v in px/ms at release). Lower = less slippery.
 *   - `timeConstant` — HOW FAST it dies out. The decay's time constant in ms;
 *                    it reaches the target in ~3× this. Lower = snappier stop
 *                    (same distance, reached sooner).
 *
 * rAF/clock are injectable so the glide is deterministically testable.
 */

export interface KineticPoint {
  x: number;
  y: number;
}

export interface KineticControls {
  /** Begin a gesture: reset the velocity accumulator (call at drag start). */
  start(): void;
  /**
   * Feed one pointer delta in surface-translate space (call on each pan move).
   * No-op unless a gesture is in progress (between start() and stop()/cancel()).
   */
  sample(dx: number, dy: number): void;
  /** Release: launch the momentum glide (or settle now if too slow). */
  stop(onDone?: () => void): void;
  /** Abort tracking and any glide immediately (no onDone). */
  cancel(): void;
}

export interface KineticOptions {
  /** px/ms below which a release does not fling at all. */
  minVelocity?: number;
  /** px/ms hard cap on launch velocity — the anti-teleport clamp. */
  maxVelocity?: number;
  /** Glide distance per unit release velocity (px per px/ms). */
  amplitude?: number;
  /** Exponential decay time constant in ms — how quickly the glide dies out. */
  timeConstant?: number;
  requestAnimationFrame?: (cb: (t?: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  now?: () => number;
}

// A frame gap smaller than this is treated as this many ms, so two pointer
// samples arriving back-to-back can never inflate the instantaneous velocity.
const MIN_SAMPLE_GAP_MS = 8;
// EMA weight on the newest sample — enough to stay responsive, low enough that
// one noisy sample can't dominate the launch velocity.
const SAMPLE_SMOOTHING = 0.65;
// If the last pointer sample is older than this at release, the finger was
// held still before letting go — launch nothing (matches the old poll loop's
// velocity decaying to zero while the offset stopped changing).
const REST_TIMEOUT_MS = 90;

export function createKinetic(
  getPoint: () => KineticPoint,
  scroll: (x: number, y: number) => void,
  options: KineticOptions = {}
): KineticControls {
  const minVelocity = options.minVelocity ?? 0.15;
  const maxVelocity = options.maxVelocity ?? 5;
  const amplitude = options.amplitude ?? 200;
  const timeConstant = options.timeConstant ?? 230;
  const raf = options.requestAnimationFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = options.cancelAnimationFrame ?? ((id) => cancelAnimationFrame(id));
  const now = options.now ?? (() => performance.now());

  let tracking = false;
  let lastSampleAt = 0;
  let vx = 0; // px/ms
  let vy = 0; // px/ms
  let ax = 0;
  let ay = 0;
  let targetX = 0;
  let targetY = 0;
  let timestamp = 0; // glide start time (for the decay clock)
  let rafId: number | null = null;
  let done: (() => void) | null = null;

  function clampV(v: number): number {
    if (v > maxVelocity) return maxVelocity;
    if (v < -maxVelocity) return -maxVelocity;
    return v;
  }

  function sample(dx: number, dy: number): void {
    if (!tracking) return;
    const t = now();
    const gap = Math.max(t - lastSampleAt, MIN_SAMPLE_GAP_MS);
    lastSampleAt = t;
    // instantaneous velocity of this move, then an exponential moving average
    const ivx = dx / gap;
    const ivy = dy / gap;
    vx = SAMPLE_SMOOTHING * ivx + (1 - SAMPLE_SMOOTHING) * vx;
    vy = SAMPLE_SMOOTHING * ivy + (1 - SAMPLE_SMOOTHING) * vy;
  }

  function autoScroll(): void {
    const elapsed = now() - timestamp;
    let moving = false;
    let dx = 0;
    let dy = 0;

    if (ax) {
      dx = -ax * Math.exp(-elapsed / timeConstant);
      if (dx > 0.5 || dx < -0.5) moving = true;
      else {
        dx = 0;
        ax = 0;
      }
    }
    if (ay) {
      dy = -ay * Math.exp(-elapsed / timeConstant);
      if (dy > 0.5 || dy < -0.5) moving = true;
      else {
        dy = 0;
        ay = 0;
      }
    }

    if (moving) {
      const wantedX = targetX + dx;
      const wantedY = targetY + dy;
      scroll(wantedX, wantedY);
      // Finish early when the consumer clamped our request — a fling into a
      // hard bound refuses to move where the decay asked, so the loop would
      // otherwise spin the full decay writing an identical transform.
      // Test "did the write land where we asked?" (requested vs achieved), NOT
      // "did the offset change since last frame?": the decay curve legitimately
      // produces ~zero movement on the first frame when it runs in the same
      // tick as release (elapsed≈0 ⇒ dx≈-ax lands back at the release point),
      // and a frame-to-frame test misreads that as a bound and dead-stops the
      // glide before it begins. A free axis (achieved == requested) keeps
      // gliding — a diagonal fling into one wall continues along the other.
      const after = getPoint();
      const pinnedX = !ax || Math.abs(after.x - wantedX) > 0.01;
      const pinnedY = !ay || Math.abs(after.y - wantedY) > 0.01;
      if (pinnedX && pinnedY) {
        rafId = null;
        const onDone = done;
        done = null;
        onDone?.();
        return;
      }
      rafId = raf(autoScroll);
    } else {
      rafId = null;
      const onDone = done;
      done = null;
      onDone?.();
    }
  }

  function start(): void {
    cancel();
    tracking = true;
    ax = ay = vx = vy = 0;
    lastSampleAt = now();
  }

  function stop(onDone?: () => void): void {
    tracking = false;
    if (rafId !== null) {
      caf(rafId);
      rafId = null;
    }
    done = onDone ?? null;

    // Released after holding still — the finger stopped feeding samples, so any
    // remaining velocity is stale. Drop it rather than flinging.
    if (now() - lastSampleAt > REST_TIMEOUT_MS) {
      vx = vy = 0;
    }

    const current = getPoint();
    targetX = current.x;
    targetY = current.y;
    timestamp = now();
    ax = ay = 0;

    const lvx = clampV(vx);
    const lvy = clampV(vy);
    if (lvx < -minVelocity || lvx > minVelocity) {
      ax = amplitude * lvx;
      targetX += ax;
    }
    if (lvy < -minVelocity || lvy > minVelocity) {
      ay = amplitude * lvy;
      targetY += ay;
    }

    if (ax || ay) {
      rafId = raf(autoScroll);
    } else {
      // Too slow to fling — settle now.
      const onDoneNow = done;
      done = null;
      onDoneNow?.();
    }
  }

  function cancel(): void {
    tracking = false;
    if (rafId !== null) {
      caf(rafId);
      rafId = null;
    }
    done = null;
    vx = vy = ax = ay = 0;
  }

  return { start, sample, stop, cancel };
}
