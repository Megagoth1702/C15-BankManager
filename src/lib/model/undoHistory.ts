/**
 * Delta-based undo/redo (max 10 entries). Document data only — no selection.
 * Prefer field/entity patches over full Bank[] snapshots.
 */
import { writable } from 'svelte/store';
import type { AttachDirection, Bank, Preset } from '../types/bank';
import { banks, getBanksSnapshot } from './bankState';
import { markSessionDirty } from './sessionDirty';

export const MAX_HISTORY = 10;

/** Minimal bank geometry + attachment fields for layout undo. */
export type BankLayoutPatch = {
  uuid: string;
  x: number;
  y: number;
  attachedToUuid: string | null;
  attachDirection: AttachDirection | null;
};

export type BankLayoutEntry = {
  kind: 'bank-layout';
  label: string;
  before: BankLayoutPatch[];
  after: BankLayoutPatch[];
};

/**
 * Affected-bank content for preset move/copy/reorder/duplicate/field edits.
 * `presets` omitted = order/selection/timestamp/name only (reorder or bank rename).
 */
export type BankContentPatch = {
  uuid: string;
  name: string;
  presetOrder: string[];
  selectedPreset: string;
  lastChangedTimestamp: number;
  /** Present when preset membership/content changed (move/copy/duplicate/field edits). */
  presets?: Preset[];
};

export type PresetContentEntry = {
  kind: 'preset-content';
  label: string;
  before: BankContentPatch[];
  after: BankContentPatch[];
};

/** Full bank snapshot at a document index (create/delete). */
export type IndexedBank = {
  index: number;
  bank: Bank;
};

/**
 * Create/delete banks: payloads for added/removed banks + layout side-effects
 * on survivors (e.g. children detached when a parent is deleted).
 */
export type BankStructureEntry = {
  kind: 'bank-structure';
  label: string;
  /** Banks removed by the forward action (indices in the before list). */
  removed: IndexedBank[];
  /** Banks added by the forward action (indices in the after list). */
  added: IndexedBank[];
  layoutBefore: BankLayoutPatch[];
  layoutAfter: BankLayoutPatch[];
};

/** Extensible entry union — more kinds added as features land. */
export type UndoEntry = BankLayoutEntry | PresetContentEntry | BankStructureEntry;

const past: UndoEntry[] = [];
const future: UndoEntry[] = [];

let historySuspended = false;

type OpenGroup = {
  label: string;
  before: BankLayoutPatch[];
  uuids: string[];
};

let openGroup: OpenGroup | null = null;

export const canUndo = writable(false);
export const canRedo = writable(false);

function syncFlags(): void {
  canUndo.set(past.length > 0);
  canRedo.set(future.length > 0);
}

function commitBanksInternal(list: Bank[]): void {
  banks.set(list);
  markSessionDirty();
}

function clonePreset(preset: Preset): Preset {
  return { ...preset };
}

function clonePresets(presets: readonly Preset[]): Preset[] {
  return presets.map(clonePreset);
}

function cloneBank(bank: Bank): Bank {
  return {
    ...bank,
    presetOrder: [...bank.presetOrder],
    presets: clonePresets(bank.presets),
    attributes: { ...bank.attributes },
  };
}

export function isHistorySuspended(): boolean {
  return historySuspended;
}

export function isUndoGroupOpen(): boolean {
  return openGroup !== null;
}

/** Run a mutation without recording history (used by undo/redo apply). */
export function runWithoutHistory(fn: () => void): void {
  const prev = historySuspended;
  historySuspended = true;
  try {
    fn();
  } finally {
    historySuspended = prev;
  }
}

export function clearHistory(): void {
  past.length = 0;
  future.length = 0;
  openGroup = null;
  syncFlags();
}

export function captureBankLayout(
  bankList: readonly Bank[],
  uuids: readonly string[],
): BankLayoutPatch[] {
  const want = new Set(uuids);
  const patches: BankLayoutPatch[] = [];
  for (const bank of bankList) {
    if (!want.has(bank.uuid)) continue;
    patches.push({
      uuid: bank.uuid,
      x: bank.x,
      y: bank.y,
      attachedToUuid: bank.attachedToUuid,
      attachDirection: bank.attachDirection,
    });
  }
  return patches;
}

export function captureBankLayoutFromStore(uuids: readonly string[]): BankLayoutPatch[] {
  return captureBankLayout(getBanksSnapshot(), uuids);
}

/**
 * Capture preset content for specific banks.
 * When `includePresets` is false, only order/selection/timestamp are stored (reorder).
 */
export function captureBankContent(
  bankList: readonly Bank[],
  uuids: readonly string[],
  includePresets: boolean,
): BankContentPatch[] {
  const want = new Set(uuids);
  const patches: BankContentPatch[] = [];
  for (const bank of bankList) {
    if (!want.has(bank.uuid)) continue;
    const patch: BankContentPatch = {
      uuid: bank.uuid,
      name: bank.name,
      presetOrder: [...bank.presetOrder],
      selectedPreset: bank.selectedPreset,
      lastChangedTimestamp: bank.lastChangedTimestamp,
    };
    if (includePresets) {
      patch.presets = clonePresets(bank.presets);
    }
    patches.push(patch);
  }
  return patches;
}

export function captureBankContentFromStore(
  uuids: readonly string[],
  includePresets: boolean,
): BankContentPatch[] {
  return captureBankContent(getBanksSnapshot(), uuids, includePresets);
}

function layoutPatchesEqual(a: BankLayoutPatch, b: BankLayoutPatch): boolean {
  return (
    a.uuid === b.uuid &&
    a.x === b.x &&
    a.y === b.y &&
    a.attachedToUuid === b.attachedToUuid &&
    a.attachDirection === b.attachDirection
  );
}

function layoutMapsEqual(before: BankLayoutPatch[], after: BankLayoutPatch[]): boolean {
  if (before.length !== after.length) return false;
  const afterByUuid = new Map(after.map((p) => [p.uuid, p]));
  for (const b of before) {
    const a = afterByUuid.get(b.uuid);
    if (!a || !layoutPatchesEqual(b, a)) return false;
  }
  return true;
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function presetsEqual(a: readonly Preset[] | undefined, b: readonly Preset[] | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (
      pa.uuid !== pb.uuid ||
      pa.name !== pb.name ||
      pa.pos !== pb.pos ||
      pa.type !== pb.type ||
      pa.comment !== pb.comment ||
      pa.deviceName !== pb.deviceName ||
      pa.color !== pb.color ||
      pa.storeTime !== pb.storeTime ||
      pa.rawXml !== pb.rawXml
    ) {
      return false;
    }
  }
  return true;
}

function contentPatchesEqual(a: BankContentPatch, b: BankContentPatch): boolean {
  return (
    a.uuid === b.uuid &&
    a.name === b.name &&
    a.selectedPreset === b.selectedPreset &&
    a.lastChangedTimestamp === b.lastChangedTimestamp &&
    stringArraysEqual(a.presetOrder, b.presetOrder) &&
    presetsEqual(a.presets, b.presets)
  );
}

function contentMapsEqual(before: BankContentPatch[], after: BankContentPatch[]): boolean {
  if (before.length !== after.length) return false;
  const afterByUuid = new Map(after.map((p) => [p.uuid, p]));
  for (const b of before) {
    const a = afterByUuid.get(b.uuid);
    if (!a || !contentPatchesEqual(b, a)) return false;
  }
  return true;
}

function pushEntry(entry: UndoEntry): void {
  // Layout groups coalesce layout only; other entry kinds may still record.
  if (historySuspended) return;
  if (openGroup && entry.kind === 'bank-layout') return;

  past.push(entry);
  if (past.length > MAX_HISTORY) {
    past.shift();
  }
  future.length = 0;
  syncFlags();
}

/**
 * Record a bank-layout delta if anything changed.
 * No-ops while history is suspended or an undo group is open (group end records instead).
 */
export function recordBankLayoutChange(
  label: string,
  before: BankLayoutPatch[],
  after: BankLayoutPatch[],
): void {
  if (historySuspended || openGroup) return;
  if (before.length === 0 && after.length === 0) return;
  if (layoutMapsEqual(before, after)) return;

  pushEntry({ kind: 'bank-layout', label, before, after });
}

/**
 * Record preset-content delta for affected banks only (not the full document).
 */
export function recordPresetContentChange(
  label: string,
  before: BankContentPatch[],
  after: BankContentPatch[],
): void {
  if (historySuspended) return;
  if (before.length === 0 && after.length === 0) return;
  if (contentMapsEqual(before, after)) return;

  pushEntry({ kind: 'preset-content', label, before, after });
}

/**
 * Diff two bank lists into a structure entry (create/delete banks + attach side-effects).
 */
export function recordBankStructureFromLists(
  label: string,
  beforeList: readonly Bank[],
  afterList: readonly Bank[],
): void {
  if (historySuspended) return;

  const afterByUuid = new Map(afterList.map((b) => [b.uuid, b]));
  const beforeByUuid = new Map(beforeList.map((b) => [b.uuid, b]));

  const removed: IndexedBank[] = [];
  beforeList.forEach((bank, index) => {
    if (!afterByUuid.has(bank.uuid)) {
      removed.push({ index, bank: cloneBank(bank) });
    }
  });

  const added: IndexedBank[] = [];
  afterList.forEach((bank, index) => {
    if (!beforeByUuid.has(bank.uuid)) {
      added.push({ index, bank: cloneBank(bank) });
    }
  });

  const survivorUuids = beforeList
    .filter((b) => afterByUuid.has(b.uuid))
    .map((b) => b.uuid);
  const layoutBeforeAll = captureBankLayout(beforeList, survivorUuids);
  const layoutAfterAll = captureBankLayout(afterList, survivorUuids);
  const layoutAfterByUuid = new Map(layoutAfterAll.map((p) => [p.uuid, p]));
  const layoutBefore: BankLayoutPatch[] = [];
  const layoutAfter: BankLayoutPatch[] = [];
  for (const b of layoutBeforeAll) {
    const a = layoutAfterByUuid.get(b.uuid);
    if (!a || layoutPatchesEqual(b, a)) continue;
    layoutBefore.push(b);
    layoutAfter.push(a);
  }

  if (removed.length === 0 && added.length === 0 && layoutBefore.length === 0) {
    return;
  }

  pushEntry({
    kind: 'bank-structure',
    label,
    removed,
    added,
    layoutBefore,
    layoutAfter,
  });
}

/**
 * Capture before → run mutate → capture after for the given bank UUIDs and push if changed.
 * Skips when suspended or group open.
 */
export function recordLayoutAround(
  label: string,
  uuids: readonly string[],
  mutate: () => void,
): void {
  if (historySuspended || openGroup) {
    mutate();
    return;
  }
  const unique = [...new Set(uuids)];
  const before = captureBankLayoutFromStore(unique);
  mutate();
  const after = captureBankLayoutFromStore(unique);
  recordBankLayoutChange(label, before, after);
}

/**
 * Capture before → mutate → capture after for preset content on specific banks.
 */
export function recordPresetContentAround(
  label: string,
  bankUuids: readonly string[],
  includePresets: boolean,
  mutate: () => void,
): void {
  if (historySuspended) {
    mutate();
    return;
  }
  const unique = [...new Set(bankUuids)];
  const before = captureBankContentFromStore(unique, includePresets);
  mutate();
  const after = captureBankContentFromStore(unique, includePresets);
  recordPresetContentChange(label, before, after);
}

/**
 * Start coalescing bank-layout changes (e.g. canvas drag).
 * Nested begins are ignored while a group is already open.
 */
export function beginUndoGroup(label: string, bankUuids: readonly string[]): void {
  if (historySuspended) return;
  if (openGroup) return;

  const uuids = [...new Set(bankUuids)];
  openGroup = {
    label,
    uuids,
    before: captureBankLayoutFromStore(uuids),
  };
}

/**
 * Close group and push one bank-layout entry if layout changed for tracked banks.
 * Also re-captures any of the original UUIDs still present (positions/attach after dock).
 */
export function endUndoGroup(): boolean {
  if (!openGroup) return false;

  const { label, uuids, before } = openGroup;
  openGroup = null;

  if (historySuspended) return false;

  const after = captureBankLayoutFromStore(uuids);
  if (layoutMapsEqual(before, after)) return false;

  // pushEntry would no-op bank-layout if openGroup were still set — already cleared
  past.push({ kind: 'bank-layout', label, before, after });
  if (past.length > MAX_HISTORY) {
    past.shift();
  }
  future.length = 0;
  syncFlags();
  return true;
}

export function cancelUndoGroup(): void {
  openGroup = null;
}

function applyLayoutPatches(patches: BankLayoutPatch[]): void {
  const map = new Map(patches.map((p) => [p.uuid, p]));
  const list = getBanksSnapshot();
  let changed = false;
  const next = list.map((bank) => {
    const p = map.get(bank.uuid);
    if (!p) return bank;
    if (
      bank.x === p.x &&
      bank.y === p.y &&
      bank.attachedToUuid === p.attachedToUuid &&
      bank.attachDirection === p.attachDirection
    ) {
      return bank;
    }
    changed = true;
    return {
      ...bank,
      x: p.x,
      y: p.y,
      attachedToUuid: p.attachedToUuid,
      attachDirection: p.attachDirection,
    };
  });
  if (changed) {
    commitBanksInternal(next);
  }
}

function applyContentPatches(patches: BankContentPatch[]): void {
  const map = new Map(patches.map((p) => [p.uuid, p]));
  const list = getBanksSnapshot();
  let changed = false;
  const next = list.map((bank) => {
    const p = map.get(bank.uuid);
    if (!p) return bank;

    const nameSame = bank.name === p.name;
    const orderSame = stringArraysEqual(bank.presetOrder, p.presetOrder);
    const selectedSame = bank.selectedPreset === p.selectedPreset;
    const tsSame = bank.lastChangedTimestamp === p.lastChangedTimestamp;
    const presetsSame =
      p.presets === undefined ? true : presetsEqual(bank.presets, p.presets);

    if (nameSame && orderSame && selectedSame && tsSame && presetsSame) {
      return bank;
    }

    changed = true;
    return {
      ...bank,
      name: p.name,
      presetOrder: [...p.presetOrder],
      selectedPreset: p.selectedPreset,
      lastChangedTimestamp: p.lastChangedTimestamp,
      ...(p.presets !== undefined ? { presets: clonePresets(p.presets) } : {}),
    };
  });
  if (changed) {
    commitBanksInternal(next);
  }
}

/**
 * Apply create/delete: remove the opposite set, re-insert payloads at indices,
 * then restore layout/attachment on survivors.
 */
function applyStructureEntry(entry: BankStructureEntry, direction: 'undo' | 'redo'): void {
  const toRemove = direction === 'undo' ? entry.added : entry.removed;
  const toInsert = direction === 'undo' ? entry.removed : entry.added;
  const layout = direction === 'undo' ? entry.layoutBefore : entry.layoutAfter;

  const removeUuids = new Set(toRemove.map((item) => item.bank.uuid));
  let list = getBanksSnapshot().filter((b) => !removeUuids.has(b.uuid));

  const inserts = [...toInsert].sort((a, b) => a.index - b.index);
  for (const item of inserts) {
    if (list.some((b) => b.uuid === item.bank.uuid)) continue;
    const at = Math.min(Math.max(0, item.index), list.length);
    list = [...list.slice(0, at), cloneBank(item.bank), ...list.slice(at)];
  }

  if (layout.length > 0) {
    const layoutMap = new Map(layout.map((p) => [p.uuid, p]));
    list = list.map((bank) => {
      const p = layoutMap.get(bank.uuid);
      if (!p) return bank;
      if (
        bank.x === p.x &&
        bank.y === p.y &&
        bank.attachedToUuid === p.attachedToUuid &&
        bank.attachDirection === p.attachDirection
      ) {
        return bank;
      }
      return {
        ...bank,
        x: p.x,
        y: p.y,
        attachedToUuid: p.attachedToUuid,
        attachDirection: p.attachDirection,
      };
    });
  }

  commitBanksInternal(list);
}

function applyEntry(entry: UndoEntry, direction: 'undo' | 'redo'): void {
  switch (entry.kind) {
    case 'bank-layout':
      applyLayoutPatches(direction === 'undo' ? entry.before : entry.after);
      break;
    case 'preset-content':
      applyContentPatches(direction === 'undo' ? entry.before : entry.after);
      break;
    case 'bank-structure':
      applyStructureEntry(entry, direction);
      break;
  }
}

export function undo(): boolean {
  if (historySuspended || openGroup) return false;
  const entry = past.pop();
  if (!entry) {
    syncFlags();
    return false;
  }

  runWithoutHistory(() => applyEntry(entry, 'undo'));
  future.push(entry);
  syncFlags();
  return true;
}

export function redo(): boolean {
  if (historySuspended || openGroup) return false;
  const entry = future.pop();
  if (!entry) {
    syncFlags();
    return false;
  }

  runWithoutHistory(() => applyEntry(entry, 'redo'));
  past.push(entry);
  // Cap past if somehow over (should not grow on redo alone past max unless we undid then…)
  if (past.length > MAX_HISTORY) {
    past.shift();
  }
  syncFlags();
  return true;
}

/** Test / debug helpers */
export function getHistoryDepthForTests(): { past: number; future: number } {
  return { past: past.length, future: future.length };
}

export function peekLastEntryForTests(): UndoEntry | null {
  return past[past.length - 1] ?? null;
}
