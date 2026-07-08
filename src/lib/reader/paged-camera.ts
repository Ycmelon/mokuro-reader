/**
 * Transform camera for the paged reader — the ZoomSurface behind paged mode.
 *
 * Owns `translate(x, y) scale(s)` (origin 0 0) on the wrapper element the
 * old panzoom library used to control, where `s = baseScale × userZoom`.
 * The base comes from page data via paged-zoom-layout's baseTransform; the
 * controller drives userZoom and per-frame view corrections.
 *
 * Invariant: clamping runs after EVERY mutation (scale-only writes shrink
 * the bounds before any correction arrives, and anchorless paths never call
 * correctView at all). Axes where the scaled content fits center at the
 * current scaled size. Clamping is gated by
 * the user's bounds/mobile settings — disabled means free panning, exactly
 * like the old keepInBounds no-op.
 */

import { Animator, areAnimationsInstant } from './animator';
import { createKinetic, type KineticControls } from './kinetic';
import {
  basePosition,
  clampTranslate,
  panEdgeState,
  type BaseLayout,
  type Size,
  type Translate
} from './paged-zoom-layout';
import type { ZoomSurface } from './zoom-controller';

const OVERPAN_VIEWPORT_FRACTION_X = 0.3;
const OVERPAN_VIEWPORT_FRACTION_Y = 0.3;
const ZOOMED_EPSILON = 0.001;

export interface PagedCameraConfig {
  getWrapper(): HTMLElement | null | undefined;
  getViewport(): Size;
  /** bounds/mobile settings gate — false means free panning, no clamping. */
  isClampingEnabled(): boolean;
  /** Enables extra bounded panning slack for zoomed pages. */
  isOverpanEnabled?(): boolean;
  /** Allows overpan even at whole-page fit/100% zoom, used by crop framing. */
  isBaseOverpanEnabled?(): boolean;
  getDevicePixelRatio?(): number;
}

export class PagedCamera {
  private config: PagedCameraConfig;
  private content: Size | null = null;
  private base: BaseLayout = { scale: 1, x: 0, y: 0, alignX: 'center', alignY: 'center' };
  private userZoom = 1;
  private tx = 0;
  private ty = 0;
  private reachableOverpanActive = false;
  private panX: Animator;
  private panY: Animator;
  private kinetic: KineticControls;

  constructor(config: PagedCameraConfig) {
    this.config = config;
    this.panX = new Animator(
      0,
      (v) => {
        this.tx = v;
        this.clampAndRender(false);
      },
      { factor: 0.22, epsilon: 0.5 }
    );
    this.panY = new Animator(
      0,
      (v) => {
        this.ty = v;
        this.clampAndRender(false);
      },
      { factor: 0.22, epsilon: 0.5, onSettle: () => this.settle(true) }
    );
    // Inertial panning (restored from panzoom's kinetic.js). It polls the
    // live translate during a drag and, on release, glides it with momentum.
    this.kinetic = createKinetic(
      () => ({ x: this.tx, y: this.ty }),
      (x, y) => {
        const c = this.clamped({ x, y }, true);
        this.tx = c.x;
        this.ty = c.y;
        this.syncPan();
        this.render();
      }
    );
  }

  /** Begin tracking for an inertial fling (call when a drag starts). */
  kineticStart(): void {
    if (areAnimationsInstant()) return;
    this.kinetic.start();
  }

  /**
   * Release a drag: glide with momentum if it was fast enough, otherwise
   * settle. Animations-off (e-ink) skips the glide entirely.
   */
  kineticStop(): void {
    if (areAnimationsInstant()) {
      // If 'disable animations' flipped on mid-drag, the track() poll loop is
      // still armed from kineticStart(); cancel it so it doesn't reschedule
      // itself forever (this branch never reaches kinetic.stop()).
      this.kinetic.cancel();
      this.settle(true);
      return;
    }
    this.kinetic.stop(() => this.settle(true));
  }

  get translate(): Translate {
    return { x: this.tx, y: this.ty };
  }

  get effectiveScale(): number {
    return this.base.scale * this.userZoom;
  }

  private scaledSize(): Size {
    const c = this.content ?? { width: 0, height: 0 };
    const s = this.effectiveScale;
    return { width: c.width * s, height: c.height * s };
  }

  private overpanForZoom(userZoom = this.userZoom): Size {
    const content = this.content;
    const viewport = this.config.getViewport();
    if (!content || !(content.width > 0) || !(content.height > 0)) {
      return { width: 0, height: 0 };
    }

    const fitScale = Math.min(viewport.width / content.width, viewport.height / content.height);
    const effectiveScale = this.base.scale * userZoom;
    if (this.config.isOverpanEnabled?.() === false) {
      return { width: 0, height: 0 };
    }

    const allowBaseOverpan = this.config.isBaseOverpanEnabled?.() === true;
    if (
      !allowBaseOverpan &&
      (userZoom <= 1 + ZOOMED_EPSILON || effectiveScale <= fitScale + ZOOMED_EPSILON)
    ) {
      return { width: 0, height: 0 };
    }

    return {
      width: viewport.width * OVERPAN_VIEWPORT_FRACTION_X,
      height: viewport.height * OVERPAN_VIEWPORT_FRACTION_Y
    };
  }

  /**
   * Set the displayed content (from page data, not DOM measurement) and its
   * mode base, placing the view at the base alignment for the current user
   * zoom. Callers reset or convert the user zoom level beforehand (keepZoom
   * preserves effective scale; other modes reset to 1).
   */
  applyBase(content: Size, base: BaseLayout): void {
    this.content = content;
    this.base = base;
    this.place();
  }

  /** Re-place the view at the base placement for the current user zoom. */
  place(): void {
    this.stopPan();
    this.reachableOverpanActive = false;
    const scaled = this.scaledSize();
    const viewport = this.config.getViewport();
    this.tx = basePosition(this.base.alignX, scaled.width, viewport.width);
    this.ty = basePosition(this.base.alignY, scaled.height, viewport.height);
    this.clampAndRender(true);
    // A freshly placed page is at rest — settle so the alignment position is
    // device-pixel rounded (#65 applies before any gesture too).
    this.settle();
  }

  /** Set the user zoom multiplier (controller frame step). Clamps and renders. */
  setUserZoom(zoom: number): void {
    const allowBaseOverpan = this.config.isBaseOverpanEnabled?.() === true;
    const preserveOverpan =
      (allowBaseOverpan || zoom > 1 + ZOOMED_EPSILON) &&
      (this.reachableOverpanActive || this.isOutsideStrictBounds());
    this.userZoom = zoom;
    this.clampAndRender(true, preserveOverpan);
    if (!allowBaseOverpan && zoom <= 1 + ZOOMED_EPSILON) {
      this.reachableOverpanActive = false;
    }
  }

  /**
   * Relative view correction in screen space — the paged equivalent of a
   * scroll write: moving content left/up by (dx, dy) decreases the translate.
   */
  adjustView(dx: number, dy: number): void {
    this.tx -= dx;
    this.ty -= dy;
    this.syncPan();
    this.clampAndRender(false);
    this.noteZoomedUserPan();
  }

  /** Zoom anchor correction in screen space, bounded by reachable-overpan. */
  correctZoomView(dx: number, dy: number): void {
    this.tx -= dx;
    this.ty -= dy;
    this.syncPan();
    this.clampAndRender(false);
  }

  /** Smoothly pan by a delta (arrow keys, wheel-pan). Targets are clamped. */
  panBy(dx: number, dy: number): void {
    // An explicit animated pan (wheel/keyboard) supersedes inertial momentum;
    // cancel the glide so the two don't fight over the translate. (The pan
    // animators are left running so successive wheel pans still chain.)
    this.kinetic.cancel();
    const target = this.clamped({ x: this.panX.target + dx, y: this.panY.target + dy }, true);
    this.panX.setTarget(target.x);
    this.panY.setTarget(target.y);
    this.noteZoomedUserPan();
  }

  /** Stop pan animations and any inertial glide, keeping the current position. */
  stopPan(): void {
    this.panX.stop();
    this.panY.stop();
    this.kinetic.cancel();
    this.syncPan();
  }

  /** Adopt the current translate as the pan animators' state. */
  private syncPan(): void {
    this.panX.current = this.tx;
    this.panX.target = this.tx;
    this.panY.current = this.ty;
    this.panY.target = this.ty;
  }

  /**
   * Round the settled translate to device pixels — fractional translates
   * produce a 1-px white compositor seam in Chrome (#65). Clamp FIRST, then
   * round, then render without re-clamping: the clamp's alignment locks on
   * fitting axes return unrounded positions (e.g. a fractional center), and
   * re-clamping after rounding would clobber the rounding for exactly the
   * image-smaller-than-viewport case #65 is about.
   */
  settle(allowOverpan = false): void {
    const dpr = this.config.getDevicePixelRatio?.() ?? 1;
    const preserveOverpan =
      allowOverpan && (this.reachableOverpanActive || this.isOutsideStrictBounds());
    const c = this.clamped({ x: this.tx, y: this.ty }, preserveOverpan);
    this.tx = Math.round(c.x * dpr) / dpr;
    this.ty = Math.round(c.y * dpr) / dpr;
    this.syncPan();
    this.render();
  }

  /** Hidden-content edge state for swipe-to-flip gating (issue #186). */
  edgeState(): { canRevealLeft: boolean; canRevealRight: boolean } {
    return panEdgeState(this.translate, this.scaledSize(), this.config.getViewport(), {
      overpan: this.overpanForZoom()
    });
  }

  /**
   * Where the content under `point` will actually sit after zooming to
   * `userZoomTarget` while trying to place it at `desired` — i.e. the desired
   * position pulled back inside the camera's strict bounds.
   */
  projectClamped(point: Translate, userZoomTarget: number, desired: Translate): Translate {
    const content = this.content;
    if (!content) return point;
    const s = this.effectiveScale;
    const sNext = this.base.scale * userZoomTarget;
    const c = { x: (point.x - this.tx) / s, y: (point.y - this.ty) / s };
    const t = this.clampedAtZoom(
      {
        x: desired.x - c.x * sNext,
        y: desired.y - c.y * sNext
      },
      userZoomTarget
    );
    return { x: c.x * sNext + t.x, y: c.y * sNext + t.y };
  }

  /**
   * Where the content under `point` will actually sit after zooming to
   * `userZoomTarget` while trying to center it — i.e. the centered position
   * pulled back inside the camera's bounds. Double-tap animates toward THIS
   * point: lerping toward the raw viewport center fights the clamp near
   * edges and the view wiggles as the correction and the clamp disagree.
   */
  projectCentered(point: Translate, userZoomTarget: number): Translate {
    const viewport = this.config.getViewport();
    return this.projectClamped(point, userZoomTarget, {
      x: viewport.width / 2,
      y: viewport.height / 2
    });
  }

  private clampedAtZoom(translate: Translate, userZoom: number): Translate {
    const content = this.content;
    if (!this.config.isClampingEnabled() || !content) return translate;
    const s = this.base.scale * userZoom;
    const scaled = { width: content.width * s, height: content.height * s };
    return clampTranslate(translate, scaled, this.config.getViewport());
  }

  /** The controller-facing surface: user zoom in, view corrections out. */
  surface(): ZoomSurface {
    return {
      isReady: () => !!this.config.getWrapper() && !!this.content,
      applyZoomLayout: (zoom) => this.setUserZoom(zoom),
      syncLayout: () => {
        // Transforms don't relayout; getBoundingClientRect always sees them.
      },
      correctView: (dx, dy) => this.correctZoomView(dx, dy)
    };
  }

  destroy(): void {
    this.panX.destroy();
    this.panY.destroy();
    this.kinetic.cancel();
  }

  private clamped(translate: Translate, allowOverpan = false): Translate {
    if (!this.config.isClampingEnabled() || !this.content) return translate;
    return clampTranslate(translate, this.scaledSize(), this.config.getViewport(), {
      overpan: allowOverpan ? this.overpanForZoom() : undefined
    });
  }

  private isOutsideStrictBounds(): boolean {
    if (!this.config.isClampingEnabled() || !this.content) return false;
    const strict = this.clamped({ x: this.tx, y: this.ty }, false);
    return Math.abs(strict.x - this.tx) > 0.5 || Math.abs(strict.y - this.ty) > 0.5;
  }

  private noteZoomedUserPan(): void {
    const overpan = this.overpanForZoom();
    if (overpan.width > 0 || overpan.height > 0) {
      this.reachableOverpanActive = true;
    }
  }

  private clampAndRender(resyncPan: boolean, allowOverpan = true): void {
    const c = this.clamped({ x: this.tx, y: this.ty }, allowOverpan);
    this.tx = c.x;
    this.ty = c.y;
    if (allowOverpan && this.isOutsideStrictBounds()) {
      this.reachableOverpanActive = true;
    }
    if (resyncPan) this.syncPan();
    this.render();
  }

  private render(): void {
    const wrapper = this.config.getWrapper();
    if (!wrapper) return;
    wrapper.style.transformOrigin = '0 0';
    wrapper.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.effectiveScale})`;
  }
}
