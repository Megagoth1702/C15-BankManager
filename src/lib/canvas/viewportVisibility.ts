import { bankOuterHeight, bankOuterWidth, C15_SCALE } from './geometry';
import type { Bank } from '../types/bank';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Asymmetric cull margins (CSS px, canvas-local).
 * Enter is tighter so banks mount only when near/on-screen;
 * exit is looser so edge-grazing pan does not thrash mount/unmount.
 */
export const CANVAS_VISIBILITY_MARGINS = {
  enterPx: 96,
  /** ~enter + ~3× bank-width cushion at typical zoom; keep sticky through edge scrub. */
  exitPx: 288,
} as const;

/** C15 rect → screen pixels inside the canvas element. */
export function worldRectToScreenRect(
  rect: WorldRect,
  viewport: ViewportState,
): WorldRect {
  const scale = C15_SCALE * viewport.zoom;
  return {
    x: viewport.panX + rect.x * scale,
    y: viewport.panY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/** True when any part of the rect intersects the canvas viewport. */
export function isRectVisibleInCanvas(
  rect: WorldRect,
  viewport: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  marginPx = 0,
): boolean {
  if (canvasWidth <= 0 || canvasHeight <= 0) return true;

  const screen = worldRectToScreenRect(rect, viewport);
  const left = -marginPx;
  const top = -marginPx;
  const right = canvasWidth + marginPx;
  const bottom = canvasHeight + marginPx;

  return (
    screen.x + screen.width > left &&
    screen.x < right &&
    screen.y + screen.height > top &&
    screen.y < bottom
  );
}

function intersectsAabb(
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return (
    screenX + screenW > left &&
    screenX < right &&
    screenY + screenH > top &&
    screenY < bottom
  );
}

/**
 * Batch visibility — one scale factor, inline screen AABB per bank (no per-bank object alloc).
 * Symmetric margin (legacy / simple callers). Prefer stickyVisibleBankUuidsInCanvas for pan.
 */
export function visibleBankUuidsInCanvas(
  banks: readonly Bank[],
  displayByUuid: DisplayPositionMap,
  viewport: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  alwaysInclude: ReadonlySet<string> = new Set(),
  marginPx = 0,
): Set<string> {
  return stickyVisibleBankUuidsInCanvas(
    banks,
    displayByUuid,
    viewport,
    canvasWidth,
    canvasHeight,
    /* previousVisible */ new Set(),
    alwaysInclude,
    marginPx,
    marginPx,
  );
}

/**
 * Sticky viewport cull with asymmetric enter/exit margins.
 *
 * - New banks join only when they intersect the **enter** AABB.
 * - Banks already in `previousVisible` stay until they leave the larger **exit** AABB.
 * - `alwaysInclude` is always present (drag cluster, drop targets, etc.).
 *
 * This prevents edge-grazing pan from hammer-mounting full bank cards.
 */
export function stickyVisibleBankUuidsInCanvas(
  banks: readonly Bank[],
  displayByUuid: DisplayPositionMap,
  viewport: ViewportState,
  canvasWidth: number,
  canvasHeight: number,
  previousVisible: ReadonlySet<string> = new Set(),
  alwaysInclude: ReadonlySet<string> = new Set(),
  enterMarginPx: number = CANVAS_VISIBILITY_MARGINS.enterPx,
  exitMarginPx: number = CANVAS_VISIBILITY_MARGINS.exitPx,
): Set<string> {
  const visible = new Set<string>(alwaysInclude);
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    for (const bank of banks) visible.add(bank.uuid);
    return visible;
  }

  // Exit pad must never be tighter than enter (would invert hysteresis).
  const enter = Math.max(0, enterMarginPx);
  const exit = Math.max(enter, exitMarginPx);

  const scale = C15_SCALE * viewport.zoom;
  const { panX, panY } = viewport;
  const enterLeft = -enter;
  const enterTop = -enter;
  const enterRight = canvasWidth + enter;
  const enterBottom = canvasHeight + enter;
  const exitLeft = -exit;
  const exitTop = -exit;
  const exitRight = canvasWidth + exit;
  const exitBottom = canvasHeight + exit;

  for (const bank of banks) {
    if (alwaysInclude.has(bank.uuid)) continue;

    const display = getDisplayPosition(bank, displayByUuid);
    const screenX = panX + display.x * scale;
    const screenY = panY + display.y * scale;
    const screenW = bankOuterWidth() * scale;
    const screenH = bankOuterHeight(bank) * scale;

    if (
      intersectsAabb(
        screenX,
        screenY,
        screenW,
        screenH,
        enterLeft,
        enterTop,
        enterRight,
        enterBottom,
      )
    ) {
      visible.add(bank.uuid);
      continue;
    }

    if (
      previousVisible.has(bank.uuid) &&
      intersectsAabb(
        screenX,
        screenY,
        screenW,
        screenH,
        exitLeft,
        exitTop,
        exitRight,
        exitBottom,
      )
    ) {
      visible.add(bank.uuid);
    }
  }

  return visible;
}

/** Uuids present in `next` but not in `previous` (mount candidates). */
export function visibilityEnteredUuids(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): string[] {
  const entered: string[] = [];
  for (const uuid of next) {
    if (!previous.has(uuid)) entered.push(uuid);
  }
  return entered;
}

/**
 * After `holdFrames` visibility frames, drop staged uuids so they may promote to full.
 * Pure helper for tests / callers that own the frame counter.
 */
export function pruneStagedLiteUuids(
  stagedEnterFrame: ReadonlyMap<string, number>,
  currentFrame: number,
  holdFrames: number,
): Set<string> {
  const still = new Set<string>();
  const hold = Math.max(0, holdFrames);
  for (const [uuid, enteredAt] of stagedEnterFrame) {
    if (currentFrame - enteredAt < hold) {
      still.add(uuid);
    }
  }
  return still;
}

/** Default max new bank mounts per animation frame (spread bulk enter cost). */
export const MAX_VISIBILITY_ENTERS_PER_FRAME = 12;

export interface VisibilityEnterCapResult {
  /** Membership to apply this frame (exits applied; enters capped). */
  next: Set<string>;
  /** Uuids newly added this frame (includes priority). */
  entered: string[];
  /** Uuids removed this frame. */
  exited: string[];
  /** Desired banks still not mounted after this frame's budget. */
  remainingEnters: number;
}

/**
 * Apply desired visibility with immediate exits and rate-limited enters.
 * `priorityInclude` (e.g. drag cluster) always enters even if over budget.
 */
export function applyVisibilityWithEnterCap(
  previous: ReadonlySet<string>,
  desired: ReadonlySet<string>,
  maxEntersPerFrame: number = MAX_VISIBILITY_ENTERS_PER_FRAME,
  priorityInclude: ReadonlySet<string> = new Set(),
): VisibilityEnterCapResult {
  const next = new Set<string>();
  const exited: string[] = [];
  const entered: string[] = [];

  for (const uuid of previous) {
    if (desired.has(uuid)) next.add(uuid);
    else exited.push(uuid);
  }

  // Priority mounts always (drag targets, etc.).
  for (const uuid of priorityInclude) {
    if (!desired.has(uuid) || next.has(uuid)) continue;
    next.add(uuid);
    entered.push(uuid);
  }

  const budget = Math.max(0, maxEntersPerFrame);
  let used = 0;
  for (const uuid of desired) {
    if (next.has(uuid)) continue;
    if (used >= budget) break;
    next.add(uuid);
    entered.push(uuid);
    used += 1;
  }

  let remainingEnters = 0;
  for (const uuid of desired) {
    if (!next.has(uuid)) remainingEnters += 1;
  }

  return { next, entered, exited, remainingEnters };
}
