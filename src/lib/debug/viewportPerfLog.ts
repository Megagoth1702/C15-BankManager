/**
 * Viewport pan / visibility-cull diagnostic trail.
 *
 * Filter console or downloaded debug log by the unique marker:
 *   C15-VIEWPERF
 *
 * Enabled when app debug is on (Vite DEV, or localStorage c15-debug=1).
 *
 * What to look for after a busy-session pan:
 * - `membership.change` — banks mounted/unmounted (enter/exit counts)
 * - `membership.paint-gap` — ms until next rAF after a set change (hitch proxy)
 * - `pan.summary` — aggregate churn + max timings for one pan gesture
 * - `cull.slow` — cull or total refresh over thresholds
 */
import { isAppDebugEnabled } from './debugFlags';
import { log } from './sessionLog';

/** Unique string for log search — do not rename without updating docs. */
export const VIEWPERF_TAG = 'C15-VIEWPERF';

/** Log step field in session log (pairs with tag in message). */
export const VIEWPERF_STEP = 'VIEWPERF';

const SLOW_CULL_MS = 2;
const SLOW_TOTAL_MS = 4;
const SLOW_PAINT_GAP_MS = 16;
const HEARTBEAT_MS = 500;
const MAX_UUID_SAMPLES = 8;

let seq = 0;

interface PanSession {
  startedAt: number;
  panSamples: number;
  scheduleCalls: number;
  refreshCalls: number;
  membershipChanges: number;
  totalEntered: number;
  totalExited: number;
  stickyKeptSamples: number;
  /** Times we skipped membership assign while pan-frozen. */
  frozenSkips: number;
  /** Times pan-delta escape hatch forced a thaw mid-pan. */
  deltaThaws: number;
  maxCullMs: number;
  maxTotalMs: number;
  maxPaintGapMs: number;
  maxInterFrameMs: number;
  lastFrameAt: number;
  lastVisible: number;
  lastStagedLite: number;
  zoomStart: number;
  panXStart: number;
  panYStart: number;
}

/** Call-site tag for visibility refresh (honest double-path diagnosis). */
export type ViewperfVisibilitySource =
  | 'effect'
  | 'schedule'
  | 'pointerup'
  | 'edge-scroll'
  | 'wheel'
  | 'enter-drain'
  | 'delta-thaw'
  | 'focus'
  | 'other';

let panSession: PanSession | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let paintGapPending = false;

function enabled(): boolean {
  return isAppDebugEnabled();
}

function nextSeq(): number {
  seq += 1;
  return seq;
}

function shortUuid(uuid: string): string {
  return uuid.length <= 8 ? uuid : `${uuid.slice(0, 8)}…`;
}

function sampleUuids(uuids: readonly string[], max = MAX_UUID_SAMPLES): string[] {
  if (uuids.length <= max) return uuids.map(shortUuid);
  return [
    ...uuids.slice(0, max - 1).map(shortUuid),
    `…+${uuids.length - (max - 1)}`,
  ];
}

function roundMs(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundZoom(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function emit(
  event: string,
  payload: Record<string, unknown>,
  level: 'info' | 'warn' | 'debug' = 'debug',
): void {
  if (!enabled()) return;
  const n = nextSeq();
  const body = { seq: n, event, ...payload };
  log(VIEWPERF_STEP, `${VIEWPERF_TAG} #${n} ${event}`, body, level);
  // Also mirror with the tag first for easy console filtering.
  if (level === 'warn') {
    console.warn(VIEWPERF_TAG, `#${n}`, event, body);
  } else {
    console.log(VIEWPERF_TAG, `#${n}`, event, body);
  }
}

function visibilityExitedUuids(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): string[] {
  const exited: string[] = [];
  for (const uuid of previous) {
    if (!next.has(uuid)) exited.push(uuid);
  }
  return exited;
}

/** Banks in both sets (still mounted). */
function stickyKeptCount(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): number {
  let n = 0;
  for (const uuid of previous) {
    if (next.has(uuid)) n += 1;
  }
  return n;
}

function ensureHeartbeat(): void {
  if (heartbeatTimer !== null || !panSession) return;
  heartbeatTimer = setInterval(() => {
    if (!panSession) {
      stopHeartbeat();
      return;
    }
    emit('pan.heartbeat', {
      ...snapshotPan(panSession),
      durationMs: roundMs(performance.now() - panSession.startedAt),
    });
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function snapshotPan(s: PanSession): Record<string, unknown> {
  return {
    panSamples: s.panSamples,
    scheduleCalls: s.scheduleCalls,
    refreshCalls: s.refreshCalls,
    membershipChanges: s.membershipChanges,
    totalEntered: s.totalEntered,
    totalExited: s.totalExited,
    stickyKeptSamples: s.stickyKeptSamples,
    frozenSkips: s.frozenSkips,
    deltaThaws: s.deltaThaws,
    refreshPerSample:
      s.panSamples > 0 ? roundMs(s.refreshCalls / s.panSamples) : 0,
    maxCullMs: roundMs(s.maxCullMs),
    maxTotalMs: roundMs(s.maxTotalMs),
    maxPaintGapMs: roundMs(s.maxPaintGapMs),
    maxInterFrameMs: roundMs(s.maxInterFrameMs),
    lastVisible: s.lastVisible,
    lastStagedLite: s.lastStagedLite,
  };
}

export function viewperfPanStart(meta: {
  zoom: number;
  panX: number;
  panY: number;
  canvasW: number;
  canvasH: number;
  bankTotal: number;
  visibleCount: number;
  source?: string;
}): void {
  if (!enabled()) return;
  // End any previous session quietly.
  if (panSession) {
    viewperfPanEnd({ zoom: meta.zoom, panX: meta.panX, panY: meta.panY, reason: 'restart' });
  }
  const now = performance.now();
  panSession = {
    startedAt: now,
    panSamples: 0,
    scheduleCalls: 0,
    refreshCalls: 0,
    membershipChanges: 0,
    totalEntered: 0,
    totalExited: 0,
    stickyKeptSamples: 0,
    frozenSkips: 0,
    deltaThaws: 0,
    maxCullMs: 0,
    maxTotalMs: 0,
    maxPaintGapMs: 0,
    maxInterFrameMs: 0,
    lastFrameAt: now,
    lastVisible: meta.visibleCount,
    lastStagedLite: 0,
    zoomStart: meta.zoom,
    panXStart: meta.panX,
    panYStart: meta.panY,
  };
  ensureHeartbeat();
  emit('pan.start', {
    source: meta.source ?? 'pan',
    zoom: roundZoom(meta.zoom),
    panX: Math.round(meta.panX),
    panY: Math.round(meta.panY),
    canvasW: Math.round(meta.canvasW),
    canvasH: Math.round(meta.canvasH),
    bankTotal: meta.bankTotal,
    visibleCount: meta.visibleCount,
  });
}

export function viewperfPanSample(): void {
  if (!enabled() || !panSession) return;
  panSession.panSamples += 1;
  const now = performance.now();
  if (panSession.lastFrameAt > 0) {
    const gap = now - panSession.lastFrameAt;
    if (gap > panSession.maxInterFrameMs) panSession.maxInterFrameMs = gap;
  }
  panSession.lastFrameAt = now;
}

export function viewperfScheduleVisibility(force: boolean): void {
  if (!enabled()) return;
  if (panSession) panSession.scheduleCalls += 1;
  // Only log forced schedules (zoom etc.) — free pan would flood.
  if (force) {
    emit('visibility.schedule', { force: true, inPan: panSession !== null });
  }
}

export function viewperfPanEnd(meta: {
  zoom: number;
  panX: number;
  panY: number;
  reason?: string;
}): void {
  if (!enabled()) return;
  stopHeartbeat();
  if (!panSession) {
    emit('pan.end', {
      reason: meta.reason ?? 'end',
      note: 'no active pan session',
      zoom: roundZoom(meta.zoom),
    });
    return;
  }
  const s = panSession;
  panSession = null;
  const durationMs = performance.now() - s.startedAt;
  emit(
    'pan.summary',
    {
      reason: meta.reason ?? 'pointerup',
      durationMs: roundMs(durationMs),
      zoomStart: roundZoom(s.zoomStart),
      zoomEnd: roundZoom(meta.zoom),
      panDeltaX: Math.round(meta.panX - s.panXStart),
      panDeltaY: Math.round(meta.panY - s.panYStart),
      ...snapshotPan(s),
      // Derived rates
      membershipPerSec:
        durationMs > 0
          ? roundMs((s.membershipChanges * 1000) / durationMs)
          : 0,
      enterPerSec:
        durationMs > 0 ? roundMs((s.totalEntered * 1000) / durationMs) : 0,
      exitPerSec:
        durationMs > 0 ? roundMs((s.totalExited * 1000) / durationMs) : 0,
    },
    s.membershipChanges > 0 || s.maxPaintGapMs >= SLOW_PAINT_GAP_MS
      ? 'warn'
      : 'debug',
  );
}

/**
 * Call around a full visibility refresh. Returns the measured cull result
 * path timing; caller still performs the work — this only logs.
 */
export function viewperfVisibilityRefresh(detail: {
  force: boolean;
  source?: ViewperfVisibilitySource | string;
  bankTotal: number;
  canvasW: number;
  canvasH: number;
  zoom: number;
  panX: number;
  panY: number;
  enterMarginPx: number;
  exitMarginPx: number;
  previousVisible: ReadonlySet<string>;
  nextVisible: ReadonlySet<string>;
  alwaysIncludeCount: number;
  stagedLiteCount: number;
  /** Wall time for stickyVisibleBankUuidsInCanvas only. */
  cullMs: number;
  /** Wall time for entire refreshCanvasVisibility body. */
  totalMs: number;
  membershipChanged: boolean;
  /** Membership assign skipped (pan freeze). */
  frozenSkip?: boolean;
  remainingEnters?: number;
}): void {
  if (!enabled()) return;

  // entered = next − previous; exited = previous − next
  const enteredUuids: string[] = [];
  for (const u of detail.nextVisible) {
    if (!detail.previousVisible.has(u)) enteredUuids.push(u);
  }
  const exitedUuids = visibilityExitedUuids(
    detail.previousVisible,
    detail.nextVisible,
  );
  const stickyKept = stickyKeptCount(
    detail.previousVisible,
    detail.nextVisible,
  );

  if (panSession) {
    panSession.refreshCalls += 1;
    panSession.lastVisible = detail.nextVisible.size;
    panSession.lastStagedLite = detail.stagedLiteCount;
    if (detail.cullMs > panSession.maxCullMs) panSession.maxCullMs = detail.cullMs;
    if (detail.totalMs > panSession.maxTotalMs) panSession.maxTotalMs = detail.totalMs;
    if (detail.frozenSkip) panSession.frozenSkips += 1;
    if (detail.source === 'delta-thaw') panSession.deltaThaws += 1;
    if (detail.membershipChanged) {
      panSession.membershipChanges += 1;
      panSession.totalEntered += enteredUuids.length;
      panSession.totalExited += exitedUuids.length;
      panSession.stickyKeptSamples += stickyKept;
    }
  }

  if (detail.frozenSkip) {
    // Aggregate only via pan.heartbeat / pan.summary — avoid per-sample flood.
    return;
  }

  const base = {
    source: detail.source ?? (detail.force ? 'force' : 'cull'),
    force: detail.force,
    inPan: panSession !== null,
    remainingEnters: detail.remainingEnters ?? 0,
    bankTotal: detail.bankTotal,
    canvasW: Math.round(detail.canvasW),
    canvasH: Math.round(detail.canvasH),
    zoom: roundZoom(detail.zoom),
    panX: Math.round(detail.panX),
    panY: Math.round(detail.panY),
    enterMarginPx: detail.enterMarginPx,
    exitMarginPx: detail.exitMarginPx,
    prevVisible: detail.previousVisible.size,
    nextVisible: detail.nextVisible.size,
    alwaysInclude: detail.alwaysIncludeCount,
    stagedLite: detail.stagedLiteCount,
    entered: enteredUuids.length,
    exited: exitedUuids.length,
    stickyKept,
    membershipChanged: detail.membershipChanged,
    cullMs: roundMs(detail.cullMs),
    totalMs: roundMs(detail.totalMs),
  };

  if (detail.membershipChanged) {
    emit(
      'membership.change',
      {
        ...base,
        enteredUuids: sampleUuids(enteredUuids),
        exitedUuids: sampleUuids(exitedUuids),
      },
      enteredUuids.length + exitedUuids.length >= 3 ? 'warn' : 'debug',
    );
    schedulePaintGapProbe({
      entered: enteredUuids.length,
      exited: exitedUuids.length,
      nextVisible: detail.nextVisible.size,
      bankTotal: detail.bankTotal,
      zoom: detail.zoom,
    });
  } else if (
    detail.cullMs >= SLOW_CULL_MS ||
    detail.totalMs >= SLOW_TOTAL_MS
  ) {
    emit('cull.slow', base, 'warn');
  }
  // Quiet stable culls are not logged (would flood). Heartbeat covers pan.
}

function schedulePaintGapProbe(meta: {
  entered: number;
  exited: number;
  nextVisible: number;
  bankTotal: number;
  zoom: number;
}): void {
  if (!enabled() || paintGapPending) return;
  paintGapPending = true;
  const t0 = performance.now();
  requestAnimationFrame(() => {
    const gap1 = performance.now() - t0;
    requestAnimationFrame(() => {
      const gap2 = performance.now() - t0;
      paintGapPending = false;
      if (panSession) {
        if (gap1 > panSession.maxPaintGapMs) panSession.maxPaintGapMs = gap1;
        if (gap2 > panSession.maxPaintGapMs) panSession.maxPaintGapMs = gap2;
      }
      emit(
        'membership.paint-gap',
        {
          gap1Ms: roundMs(gap1),
          gap2Ms: roundMs(gap2),
          entered: meta.entered,
          exited: meta.exited,
          nextVisible: meta.nextVisible,
          bankTotal: meta.bankTotal,
          zoom: roundZoom(meta.zoom),
          // gap1 > 16ms ≈ missed a frame after membership assign
          missedFrame: gap1 >= SLOW_PAINT_GAP_MS,
        },
        gap1 >= SLOW_PAINT_GAP_MS ? 'warn' : 'debug',
      );
    });
  });
}

export function viewperfStagedLite(detail: {
  event: 'enter' | 'promote' | 'clear' | 'prune-offscreen';
  count: number;
  uuids?: readonly string[];
  clock?: number;
}): void {
  if (!enabled()) return;
  // Promote/clear are useful; skip empty no-ops.
  if (detail.count === 0 && detail.event !== 'clear') return;
  emit('staged-lite.' + detail.event, {
    count: detail.count,
    clock: detail.clock,
    uuids: detail.uuids ? sampleUuids(detail.uuids) : undefined,
  });
}

export function viewperfZoom(detail: {
  zoom: number;
  panX: number;
  panY: number;
  bankTotal: number;
  visibleCount: number;
}): void {
  if (!enabled()) return;
  emit('zoom', {
    zoom: roundZoom(detail.zoom),
    panX: Math.round(detail.panX),
    panY: Math.round(detail.panY),
    bankTotal: detail.bankTotal,
    visibleCount: detail.visibleCount,
  });
}

export function viewperfNote(event: string, payload: Record<string, unknown> = {}): void {
  if (!enabled()) return;
  emit(event, payload);
}

/** Test / reset helper. */
export function resetViewperfLog(): void {
  stopHeartbeat();
  panSession = null;
  paintGapPending = false;
  seq = 0;
}
