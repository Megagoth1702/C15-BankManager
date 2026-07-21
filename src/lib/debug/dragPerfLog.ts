import { bankLodMode } from '../canvas/lod';
import { log } from './sessionLog';

export interface DragPerfSnapshot {
  totalBanks: number;
  totalPresets: number;
  clusterSize: number;
  applyCalls: number;
  storeCommits: number;
  layoutPasses: number;
  dockTests: number;
  visibleBanksRendered: number;
  edgeScrollFrames: number;
  pointerMovedFrames: number;
  msApply: number;
  msLayout: number;
  msStore: number;
  msDock: number;
  msVisibility: number;
  durationMs: number;
}

let sessionActive = false;
let sessionStart = 0;
let lastFlush = 0;

let totalBanks = 0;
let totalPresets = 0;
let clusterSize = 0;

let applyCalls = 0;
let storeCommits = 0;
let layoutPasses = 0;
let dockTests = 0;
let visibleBanksRendered = 0;
let edgeScrollFrames = 0;
let pointerMovedFrames = 0;

let msApply = 0;
let msLayout = 0;
let msStore = 0;
let msDock = 0;
let msVisibility = 0;

export function isDragPerfEnabled(): boolean {
  return true;
}

export function startBankDragPerfSession(
  banks: readonly { presets: readonly unknown[] }[],
  clusterMemberCount: number,
  viewportZoom = 1,
): void {
  if (!isDragPerfEnabled()) return;
  sessionActive = true;
  sessionStart = performance.now();
  lastFlush = sessionStart;
  totalBanks = banks.length;
  totalPresets = banks.reduce((sum, b) => sum + b.presets.length, 0);
  clusterSize = clusterMemberCount;
  applyCalls = 0;
  storeCommits = 0;
  layoutPasses = 0;
  dockTests = 0;
  visibleBanksRendered = 0;
  edgeScrollFrames = 0;
  pointerMovedFrames = 0;
  msApply = 0;
  msLayout = 0;
  msStore = 0;
  msDock = 0;
  msVisibility = 0;
  log('perf', 'bank drag session start', {
    totalBanks,
    totalPresets,
    clusterSize,
    viewportZoom,
    lodMode: bankLodMode(viewportZoom),
  });
}

export function endBankDragPerfSession(): void {
  if (!sessionActive) return;
  flushDragPerf('bank drag session end', true);
  sessionActive = false;
}

export function recordPointerMovedFrame(): void {
  if (!sessionActive) return;
  pointerMovedFrames++;
}

export function recordEdgeScrollFrame(): void {
  if (!sessionActive) return;
  edgeScrollFrames++;
}

export function recordVisibleBanksRendered(count: number): void {
  if (!sessionActive) return;
  visibleBanksRendered = count;
}

export function timeApply<T>(fn: () => T): T {
  if (!sessionActive) return fn();
  const t0 = performance.now();
  const result = fn();
  const dt = performance.now() - t0;
  applyCalls++;
  msApply += dt;
  maybeFlushPeriodic();
  return result;
}

export function timeLayout<T>(fn: () => T): T {
  if (!sessionActive) return fn();
  const t0 = performance.now();
  layoutPasses++;
  const result = fn();
  msLayout += performance.now() - t0;
  return result;
}

export function timeStore<T>(fn: () => T): T {
  if (!sessionActive) return fn();
  const t0 = performance.now();
  storeCommits++;
  const result = fn();
  msStore += performance.now() - t0;
  return result;
}

export function timeDock<T>(fn: () => T): T {
  if (!sessionActive) return fn();
  const t0 = performance.now();
  dockTests++;
  const result = fn();
  msDock += performance.now() - t0;
  return result;
}

export function timeVisibility<T>(fn: () => T): T {
  if (!sessionActive) return fn();
  const t0 = performance.now();
  const result = fn();
  msVisibility += performance.now() - t0;
  return result;
}

function snapshot(): DragPerfSnapshot {
  const now = performance.now();
  return {
    totalBanks,
    totalPresets,
    clusterSize,
    applyCalls,
    storeCommits,
    layoutPasses,
    dockTests,
    visibleBanksRendered,
    edgeScrollFrames,
    pointerMovedFrames,
    msApply: roundMs(msApply),
    msLayout: roundMs(msLayout),
    msStore: roundMs(msStore),
    msDock: roundMs(msDock),
    msVisibility: roundMs(msVisibility),
    durationMs: roundMs(now - sessionStart),
  };
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function maybeFlushPeriodic(): void {
  const now = performance.now();
  if (now - lastFlush < 1000) return;
  flushDragPerf('bank drag heartbeat');
  lastFlush = now;
}

function flushDragPerf(message: string, final = false): void {
  log('perf', message, { ...snapshot(), final });
}