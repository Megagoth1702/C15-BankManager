/**
 * Live import job state + device document sync waiters.
 *
 * Firmware `import-bank` uses ignoreUUIDs=true (new UUIDs on device).
 * Full `import-all-banks` preserves UUIDs but locks the preset manager and
 * shows the HWUI splash — treat as a cold, busy operation on our side too.
 */

import { derived, get, writable } from 'svelte/store';
import { log } from '../debug/sessionLog';

export type LiveImportPhase =
  | 'idle'
  | 'preparing'
  | 'sending'
  | 'waiting-sync'
  | 'redocking'
  | 'replacing'
  | 'done'
  | 'error';

export interface LiveImportJobState {
  active: boolean;
  phase: LiveImportPhase;
  /** Primary line under the spinner. */
  label: string;
  /** Secondary detail (bank name, lock message, …). */
  detail: string | null;
  current: number;
  total: number;
  error: string | null;
}

export interface DeviceBankRef {
  uuid: string;
  name: string;
  x: number;
  y: number;
  attachedToUuid: string | null;
  attachDirection: string | null;
}

/** Snapshot of device library after a WS document apply (or last known). */
export interface DeviceLibrarySnapshot {
  updateId: number | null;
  banks: DeviceBankRef[];
  at: number;
}

const initialJob: LiveImportJobState = {
  active: false,
  phase: 'idle',
  label: '',
  detail: null,
  current: 0,
  total: 0,
  error: null,
};

export const liveImportJob = writable<LiveImportJobState>({ ...initialJob });

export const isLiveImportBusy = derived(liveImportJob, ($j) => $j.active);

export function getLiveImportBusy(): boolean {
  return get(liveImportJob).active;
}

let lastSnapshot: DeviceLibrarySnapshot | null = null;
type SnapshotListener = (snap: DeviceLibrarySnapshot) => void;
const listeners = new Set<SnapshotListener>();

/** Called from liveMode after each document is considered (with current canvas banks). */
export function notifyDeviceLibrarySnapshot(snap: DeviceLibrarySnapshot): void {
  lastSnapshot = snap;
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      log('C15-LIVE', 'device snapshot listener error', String(err), 'warn');
    }
  }
}

export function getLastDeviceLibrarySnapshot(): DeviceLibrarySnapshot | null {
  return lastSnapshot;
}

export function resetDeviceLibrarySnapshot(): void {
  lastSnapshot = null;
}

export function subscribeDeviceLibrarySnapshot(fn: SnapshotListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Wait until `predicate` is true on a device library snapshot.
 * Checks the last snapshot immediately (unless opts say otherwise), then listens.
 * Resolves false on timeout (does not throw).
 *
 * Important: snapshots must reflect the **device** document, never the local
 * canvas. Callers that just mutated the store must pass `notBeforeMs` /
 * `minUpdateId` so a pre-upload snapshot cannot satisfy the wait.
 */
export function waitForDeviceCondition(
  predicate: (snap: DeviceLibrarySnapshot) => boolean,
  opts?: {
    timeoutMs?: number;
    /** Ignore snapshots with `at` strictly less than this (ms since epoch). */
    notBeforeMs?: number;
    /** Ignore snapshots whose updateId is null or ≤ this value. */
    minUpdateId?: number | null;
    /** When true (default), evaluate lastSnapshot immediately. */
    checkLastSnapshot?: boolean;
  },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const notBeforeMs = opts?.notBeforeMs ?? 0;
  const minUpdateId = opts?.minUpdateId;
  const checkLast = opts?.checkLastSnapshot !== false;

  const eligible = (snap: DeviceLibrarySnapshot): boolean => {
    if (snap.at < notBeforeMs) return false;
    if (minUpdateId != null) {
      if (snap.updateId == null || snap.updateId <= minUpdateId) return false;
    }
    return predicate(snap);
  };

  if (checkLast && lastSnapshot && eligible(lastSnapshot)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(ok);
    };

    const unsub = subscribeDeviceLibrarySnapshot((snap) => {
      if (eligible(snap)) finish(true);
    });

    const timer = setTimeout(() => {
      log('C15-LIVE', 'waitForDeviceCondition timeout', { timeoutMs, notBeforeMs, minUpdateId }, 'warn');
      finish(false);
    }, timeoutMs);
  });
}

/**
 * Drop cached device snapshot so a subsequent wait cannot succeed on
 * pre-mutation state (e.g. right before import-all-banks).
 */
export function invalidateDeviceLibrarySnapshot(reason?: string): void {
  if (lastSnapshot) {
    log('C15-LIVE', 'device snapshot invalidated', { reason: reason ?? '' });
  }
  lastSnapshot = null;
}

export function beginLiveImportJob(opts: {
  phase?: LiveImportPhase;
  label: string;
  detail?: string | null;
  total?: number;
}): void {
  liveImportJob.set({
    active: true,
    phase: opts.phase ?? 'preparing',
    label: opts.label,
    detail: opts.detail ?? null,
    current: 0,
    total: opts.total ?? 0,
    error: null,
  });
  log('C15-LIVE', 'import job begin', {
    label: opts.label,
    total: opts.total ?? 0,
  });
}

export function updateLiveImportJob(
  patch: Partial<
    Pick<LiveImportJobState, 'phase' | 'label' | 'detail' | 'current' | 'total' | 'error'>
  >,
): void {
  liveImportJob.update((j) => {
    if (!j.active) return j;
    return { ...j, ...patch };
  });
}

export function endLiveImportJob(opts?: {
  error?: string | null;
  label?: string;
}): void {
  const err = opts?.error ?? null;
  if (err) {
    liveImportJob.set({
      active: false,
      phase: 'error',
      label: opts?.label ?? 'C15 import failed',
      detail: err,
      current: 0,
      total: 0,
      error: err,
    });
    log('C15-LIVE', 'import job error', err, 'error');
    // Clear sticky error phase after a beat so UI can return to idle badge.
    setTimeout(() => {
      liveImportJob.update((j) => (j.phase === 'error' && !j.active ? { ...initialJob } : j));
    }, 4000);
    return;
  }

  liveImportJob.set({ ...initialJob, phase: 'done', label: opts?.label ?? '' });
  log('C15-LIVE', 'import job done', { label: opts?.label });
  setTimeout(() => {
    liveImportJob.update((j) => (j.phase === 'done' && !j.active ? { ...initialJob } : j));
  }, 800);
}

/** Find a newly appeared bank matching expected name + approx position. */
export function matchNewDeviceBank(
  beforeUuids: ReadonlySet<string>,
  snap: DeviceLibrarySnapshot,
  expected: { name: string; x: number; y: number },
  posTolerance = 45,
): DeviceBankRef | null {
  const newcomers = snap.banks.filter((b) => !beforeUuids.has(b.uuid.toLowerCase()));
  if (newcomers.length === 0) return null;

  const nameMatches = newcomers.filter((b) => b.name === expected.name);
  const pool = nameMatches.length > 0 ? nameMatches : newcomers;

  let best: DeviceBankRef | null = null;
  let bestDist = Infinity;
  for (const b of pool) {
    const d = Math.hypot(b.x - expected.x, b.y - expected.y);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }

  if (best && bestDist <= posTolerance) return best;
  // Name unique among newcomers — accept even if position drifted.
  if (nameMatches.length === 1) return nameMatches[0]!;
  // Single newcomer total.
  if (newcomers.length === 1) return newcomers[0]!;
  return bestDist < Infinity ? best : null;
}
