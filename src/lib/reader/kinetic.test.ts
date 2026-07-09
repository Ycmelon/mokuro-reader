import { describe, it, expect, vi } from 'vitest';
import { createKinetic, type KineticOptions } from './kinetic';

/**
 * Drives the kinetic tracker deterministically. Velocity now comes from
 * pointer samples (not transform polling), so the harness feeds deltas via
 * move() with a manual clock; a manual rAF queue steps the decay loop.
 */
function harness(opts: Partial<KineticOptions> = {}) {
  let clock = 0;
  const queue: Array<(t?: number) => void> = [];
  const raf = (cb: (t?: number) => void) => {
    queue.push(cb);
    return queue.length;
  };
  const caf = (id: number) => {
    queue[id - 1] = () => {};
  };
  const now = () => clock;
  let point = { x: 0, y: 0 };
  const scrolled: Array<{ x: number; y: number }> = [];
  const k = createKinetic(
    () => point,
    (x, y) => {
      point = { x, y };
      scrolled.push({ x, y });
    },
    { requestAnimationFrame: raf, cancelAnimationFrame: caf, now, ...opts }
  );
  // A pointer move: time passes, the surface follows the finger, and the
  // tracker samples the raw delta (exactly how the camera calls it).
  function move(dx: number, dy: number, dtMs = 16) {
    clock += dtMs;
    point = { x: point.x + dx, y: point.y + dy };
    k.sample(dx, dy);
  }
  // Run exactly the callbacks queued right now (one decay "frame").
  function frame(dtMs = 16) {
    clock += dtMs;
    const batch = queue.splice(0);
    for (const cb of batch) cb(clock);
  }
  // Let time pass without a pointer sample (a pause before release).
  function idle(dtMs: number) {
    clock += dtMs;
  }
  return {
    k,
    frame,
    move,
    idle,
    scrolled,
    setPoint: (x: number, y: number) => (point = { x, y }),
    get point() {
      return point;
    }
  };
}

describe('createKinetic', () => {
  it('does not fling when the surface was held still before release (below minVelocity)', () => {
    const h = harness();
    const onDone = vi.fn();
    h.setPoint(100, 100);
    h.k.start();
    // pressed and held: every move delta is zero, so velocity stays 0
    for (let i = 0; i < 5; i++) h.move(0, 0);
    h.k.stop(onDone);
    expect(h.scrolled.length).toBe(0); // no glide
    expect(onDone).toHaveBeenCalledTimes(1); // settles immediately, no autoScroll
  });

  it('flings past the release point and decays to a stop, then signals done', () => {
    const h = harness();
    const onDone = vi.fn();
    h.k.start();
    // fast drag: 40px/frame to the right for 5 frames → release at x=200
    for (let i = 0; i < 5; i++) h.move(40, 0);
    const releaseX = h.point.x;
    expect(releaseX).toBe(200);
    h.k.stop(onDone);

    let maxX = releaseX;
    for (let i = 0; i < 200 && onDone.mock.calls.length === 0; i++) {
      h.frame();
      if (h.scrolled.length) maxX = Math.max(maxX, h.scrolled[h.scrolled.length - 1].x);
    }
    // glided forward past the release point
    expect(maxX).toBeGreaterThan(releaseX + 10);
    // and came to rest (done fired)
    expect(onDone).toHaveBeenCalledTimes(1);
    // monotonic decay: each glide step moves less than (or equal to) the prior
    const steps = h.scrolled.map((s) => s.x);
    for (let i = 2; i < steps.length; i++) {
      expect(steps[i] - steps[i - 1]).toBeLessThanOrEqual(steps[i - 1] - steps[i - 2] + 1e-6);
    }
  });

  it('does not false-pin when the first glide frame runs in the same tick as release', () => {
    const h = harness();
    const onDone = vi.fn();
    h.k.start();
    for (let i = 0; i < 5; i++) h.move(40, 0);
    h.k.stop(onDone);
    // First autoScroll fires in the SAME tick as stop() — the frame-cycle race
    // where mouseup lands right before rAF. elapsed=0 makes the decay curve
    // start exactly at the release point (zero movement on frame one).
    h.frame(0);
    let maxX = 200;
    for (let i = 0; i < 200 && onDone.mock.calls.length === 0; i++) {
      h.frame();
      if (h.scrolled.length) maxX = Math.max(maxX, h.scrolled[h.scrolled.length - 1].x);
    }
    expect(maxX).toBeGreaterThan(210); // glided past the release point
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('flings on both axes independently', () => {
    const h = harness();
    h.k.start();
    for (let i = 0; i < 5; i++) h.move(30, -50);
    h.k.stop();
    h.frame();
    expect(h.scrolled.length).toBeGreaterThan(0);
    const last = h.scrolled[h.scrolled.length - 1];
    expect(last.x).toBeGreaterThan(150); // glided right
    expect(last.y).toBeLessThan(-250); // glided up
  });

  it('caps launch velocity so a spike delta cannot teleport the page', () => {
    // maxVelocity 5 px/ms, amplitude 120 → glide beyond release ≤ 600px, no
    // matter how absurd the delta. This is the anti-teleport guarantee.
    const h = harness();
    h.k.start();
    h.move(5000, 0, 16); // a bogus 5000px jump in one frame
    const releaseX = h.point.x;
    h.k.stop();
    let maxX = releaseX;
    for (let i = 0; i < 400 && h.scrolled.length >= 0; i++) {
      const before = h.scrolled.length;
      h.frame();
      if (h.scrolled.length) maxX = Math.max(maxX, h.scrolled[h.scrolled.length - 1].x);
      if (h.scrolled.length === before && i > 2) break;
    }
    expect(maxX - releaseX).toBeLessThanOrEqual(601);
    expect(maxX - releaseX).toBeGreaterThan(0); // it still glided
  });

  it('does not fling when the finger paused before release (rest timeout)', () => {
    const h = harness();
    const onDone = vi.fn();
    h.k.start();
    for (let i = 0; i < 5; i++) h.move(40, 0); // fast drag
    h.idle(120); // then held still for 120ms > REST_TIMEOUT before letting go
    h.k.stop(onDone);
    expect(h.scrolled.length).toBe(0); // stale velocity dropped, no glide
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops an in-flight glide and fires no further scrolls', () => {
    const h = harness();
    const onDone = vi.fn();
    h.k.start();
    for (let i = 0; i < 5; i++) h.move(40, 0);
    h.k.stop(onDone);
    h.frame(); // one glide frame
    const countAfterOne = h.scrolled.length;
    h.k.cancel();
    h.frame();
    h.frame();
    expect(h.scrolled.length).toBe(countAfterOne); // no more scrolls
    expect(onDone).not.toHaveBeenCalled(); // cancel is not a natural finish
  });

  it('a fresh start() resets accumulated velocity (no carryover fling)', () => {
    const h = harness();
    h.k.start();
    for (let i = 0; i < 5; i++) h.move(40, 0);
    // new gesture begins without releasing the old one
    h.k.start();
    h.move(0, 0); // held still relative to the restart
    h.move(0, 0);
    const onDone = vi.fn();
    h.k.stop(onDone);
    h.frame();
    expect(h.scrolled.length).toBe(0); // stale velocity did not carry over
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores samples outside a gesture (no start → no velocity)', () => {
    const h = harness();
    const onDone = vi.fn();
    h.move(40, 0); // sample without start() — should be ignored
    h.move(40, 0);
    h.k.stop(onDone);
    expect(h.scrolled.length).toBe(0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('createKinetic — clamp early-out', () => {
  it('stops the glide promptly when the consumer pins it at a bound', () => {
    let clock = 0;
    const queue: Array<(t?: number) => void> = [];
    const raf = (cb: (t?: number) => void) => {
      queue.push(cb);
      return queue.length;
    };
    const caf = (id: number) => {
      queue[id - 1] = () => {};
    };
    let point = { x: 0, y: 0 };
    const BOUND = 100; // the consumer refuses to scroll past x=100
    const scrolled: number[] = [];
    const k = createKinetic(
      () => point,
      (x) => {
        const cx = Math.min(BOUND, x); // clamp like the camera does
        point = { x: cx, y: 0 };
        scrolled.push(cx);
      },
      { requestAnimationFrame: raf, cancelAnimationFrame: caf, now: () => clock }
    );
    function frame(dt = 16) {
      clock += dt;
      const batch = queue.splice(0);
      for (const cb of batch) cb(clock);
    }
    k.start();
    // hard fast fling to the right — would project well past the bound. The
    // surface is clamped during the drag, but velocity comes from the raw
    // deltas, so momentum still points past the wall.
    for (let i = 1; i <= 5; i++) {
      clock += 16;
      point = { x: Math.min(BOUND, i * 40), y: 0 };
      k.sample(40, 0);
    }
    const onDone = vi.fn();
    k.stop(onDone);
    let frames = 0;
    for (let i = 0; i < 200 && onDone.mock.calls.length === 0; i++) {
      frame();
      frames++;
    }
    expect(onDone).toHaveBeenCalledTimes(1);
    // pinned at the bound, it must finish in a handful of frames, not the
    // full decay
    expect(frames).toBeLessThan(10);
    // never reported a position past the bound
    expect(Math.max(...scrolled)).toBeLessThanOrEqual(BOUND);
  });

  it('a diagonal fling keeps gliding on the free axis after one axis pins', () => {
    let clock = 0;
    const queue: Array<(t?: number) => void> = [];
    const raf = (cb: (t?: number) => void) => {
      queue.push(cb);
      return queue.length;
    };
    const caf = (id: number) => {
      queue[id - 1] = () => {};
    };
    let point = { x: 0, y: 0 };
    const X_BOUND = 60;
    const seen: Array<{ x: number; y: number }> = [];
    const k = createKinetic(
      () => point,
      (x, y) => {
        point = { x: Math.min(X_BOUND, x), y };
        seen.push({ ...point });
      },
      { requestAnimationFrame: raf, cancelAnimationFrame: caf, now: () => clock }
    );
    function frame(dt = 16) {
      clock += dt;
      const batch = queue.splice(0);
      for (const cb of batch) cb(clock);
    }
    k.start();
    for (let i = 1; i <= 5; i++) {
      clock += 16;
      point = { x: Math.min(X_BOUND, i * 40), y: i * 40 };
      k.sample(40, 40);
    }
    k.stop();
    for (let i = 0; i < 200 && queue.length; i++) frame();
    // y kept gliding past the release value even though x was pinned
    expect(seen[seen.length - 1].y).toBeGreaterThan(220);
    expect(Math.max(...seen.map((s) => s.x))).toBeLessThanOrEqual(X_BOUND);
  });
});
