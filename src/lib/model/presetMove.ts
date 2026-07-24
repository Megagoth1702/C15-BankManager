import type { Bank, Preset } from '../types/bank';
import { findByUuid } from '../uuid/uuidKey';
import { getPresetAttributes } from '../xml/presetAttributes';
import { rewritePresetPos } from '../xml/serialize';
import { freshC15Uuid } from '../uuid/c15Uuid';

export interface MovePresetsResult {
  ok: boolean;
  moved: string[];
  banks?: Bank[];
  error?: string;
}

function allPresetUuidNeedles(banks: readonly Bank[]): Set<string> {
  const used = new Set<string>();
  for (const bank of banks) {
    for (const preset of bank.presets) {
      used.add(preset.uuid.toLowerCase());
    }
  }
  return used;
}

/**
 * Align each preset's `pos` + rawXml `pos="N"` with `presetOrder` indices.
 * Required for C15 export: load places content by pos into preset-order slots.
 */
export function syncPresetPositionsToOrder(
  presets: readonly Preset[],
  presetOrder: readonly string[],
): Preset[] {
  const indexByUuid = new Map<string, number>();
  presetOrder.forEach((uuid, i) => {
    indexByUuid.set(uuid.toLowerCase(), i);
  });

  let nextOrphan = presetOrder.length;
  return presets.map((preset) => {
    const fromOrder = indexByUuid.get(preset.uuid.toLowerCase());
    const pos = fromOrder !== undefined ? fromOrder : nextOrphan++;
    if (preset.pos === pos && preset.rawXml.includes(`pos="${pos}"`)) {
      return preset;
    }
    return {
      ...preset,
      pos,
      rawXml: rewritePresetPos(preset.rawXml, pos),
    };
  });
}

function freshPresetUuid(used: Set<string>): string {
  return freshC15Uuid(used);
}

/**
 * C15 copy (`Preset(tgtBank, *srcPreset)`): new preset UUID, source unchanged.
 * `rawXml` gets the new `<uuid>` so export matches `preset-order`.
 */
export function clonePresetWithNewUuid(preset: Preset, newUuid: string): Preset {
  const rawXml = preset.rawXml.replace(
    /<uuid>[\s\S]*?<\/uuid>/,
    `<uuid>${newUuid}</uuid>`,
  );
  return { ...preset, uuid: newUuid, rawXml };
}

/**
 * Copy presets into another bank (C15 default drag-drop: new UUIDs, source kept).
 */
export function copyPresetsBetweenBanks(
  banks: Bank[],
  presetUuids: readonly string[],
  sourceBankUuid: string,
  targetBankUuid: string,
  insertIndex?: number,
): MovePresetsResult {
  if (sourceBankUuid === targetBankUuid) {
    return { ok: false, moved: [], error: 'Source and target bank are the same.' };
  }

  const unique = [...new Set(presetUuids)];
  if (unique.length === 0) {
    return { ok: false, moved: [], error: 'No presets selected.' };
  }

  const source = banks.find((b) => b.uuid === sourceBankUuid);
  const target = banks.find((b) => b.uuid === targetBankUuid);
  if (!source || !target) {
    return { ok: false, moved: [], error: 'Source or target bank not found.' };
  }

  const toCopy: Preset[] = [];
  for (const uuid of unique) {
    const preset = source.presets.find(
      (p) => p.uuid.toLowerCase() === uuid.toLowerCase(),
    );
    if (!preset) {
      return { ok: false, moved: [], error: `Preset not found in source bank: ${uuid}` };
    }
    toCopy.push(preset);
  }

  const used = allPresetUuidNeedles(banks);
  const copies = toCopy.map((preset) => {
    const newUuid = freshPresetUuid(used);
    return clonePresetWithNewUuid(preset, newUuid);
  });
  const copiedUuids = copies.map((p) => p.uuid);

  const nextTargetOrder = [...target.presetOrder];
  const at = Math.max(
    0,
    Math.min(insertIndex ?? nextTargetOrder.length, nextTargetOrder.length),
  );
  nextTargetOrder.splice(at, 0, ...copiedUuids);
  const nextTargetPresets = [...target.presets, ...copies];
  const nextTargetSelected = copiedUuids[copiedUuids.length - 1] ?? target.selectedPreset;
  const now = Math.floor(Date.now() / 1000);

  const updated: Bank[] = banks.map((b) => {
    if (b.uuid === targetBankUuid) {
      return {
        ...b,
        presetOrder: nextTargetOrder,
        presets: nextTargetPresets,
        selectedPreset: nextTargetSelected,
        lastChangedTimestamp: now,
      };
    }
    return b;
  });

  return { ok: true, moved: copiedUuids, banks: updated };
}

/**
 * Duplicate presets within one bank (C15 `copyPresetBelow`: new UUIDs, inserted after selection).
 */
export function duplicatePresetsInBank(
  banks: Bank[],
  bankUuid: string,
  presetUuids: readonly string[],
): MovePresetsResult {
  const unique = [...new Set(presetUuids)];
  if (unique.length === 0) {
    return { ok: false, moved: [], error: 'No presets selected.' };
  }

  const bank = banks.find((b) => b.uuid === bankUuid);
  if (!bank) {
    return { ok: false, moved: [], error: 'Bank not found.' };
  }

  const needles = new Set(unique.map((u) => u.toLowerCase()));
  const ordered = bank.presetOrder.filter((u) => needles.has(u.toLowerCase()));
  if (ordered.length !== unique.length) {
    return { ok: false, moved: [], error: 'Preset not found in bank.' };
  }

  let lastIndex = -1;
  for (let i = 0; i < bank.presetOrder.length; i++) {
    if (needles.has(bank.presetOrder[i]!.toLowerCase())) lastIndex = i;
  }
  const insertAt = lastIndex + 1;

  const used = allPresetUuidNeedles(banks);
  const copies: Preset[] = [];
  const newUuids: string[] = [];
  for (const uuid of ordered) {
    const preset = bank.presets.find((p) => p.uuid.toLowerCase() === uuid.toLowerCase());
    if (!preset) {
      return { ok: false, moved: [], error: `Preset not found in bank: ${uuid}` };
    }
    const newUuid = freshPresetUuid(used);
    copies.push(clonePresetWithNewUuid(preset, newUuid));
    newUuids.push(newUuid);
  }

  const nextOrder = [...bank.presetOrder];
  nextOrder.splice(insertAt, 0, ...newUuids);
  const nextPresets = [...bank.presets, ...copies];
  const nextSelected = newUuids[newUuids.length - 1] ?? bank.selectedPreset;
  const now = Math.floor(Date.now() / 1000);

  const updated = banks.map((b) => {
    if (b.uuid !== bankUuid) return b;
    return {
      ...b,
      presetOrder: nextOrder,
      presets: nextPresets,
      selectedPreset: nextSelected,
      lastChangedTimestamp: now,
    };
  });

  return { ok: true, moved: newUuids, banks: updated };
}

/**
 * Adjust insert index after removing dragged presets from the current order.
 */
export function adjustInsertIndexForReorder(
  order: readonly string[],
  movingNeedles: ReadonlySet<string>,
  insertIndex: number,
): number {
  let adjusted = insertIndex;
  const limit = Math.min(insertIndex, order.length);
  for (let i = 0; i < limit; i++) {
    if (movingNeedles.has(order[i]!.toLowerCase())) adjusted--;
  }
  const remaining = order.length - movingNeedles.size;
  return Math.max(0, Math.min(adjusted, remaining));
}

/**
 * Reorder presets within one bank (C15: same bank drag = move, UUIDs preserved).
 */
export function reorderPresetsInBank(
  banks: Bank[],
  bankUuid: string,
  presetUuids: readonly string[],
  insertIndex: number,
): MovePresetsResult {
  const unique = [...new Set(presetUuids)];
  if (unique.length === 0) {
    return { ok: false, moved: [], error: 'No presets selected.' };
  }

  const bank = banks.find((b) => b.uuid === bankUuid);
  if (!bank) {
    return { ok: false, moved: [], error: 'Bank not found.' };
  }

  const needles = new Set(unique.map((u) => u.toLowerCase()));
  const moving = bank.presetOrder.filter((u) => needles.has(u.toLowerCase()));
  if (moving.length !== unique.length) {
    return { ok: false, moved: [], error: 'Preset not found in bank.' };
  }

  const without = bank.presetOrder.filter((u) => !needles.has(u.toLowerCase()));
  const at = adjustInsertIndexForReorder(bank.presetOrder, needles, insertIndex);
  const nextOrder = [...without];
  nextOrder.splice(at, 0, ...moving);

  const unchanged =
    nextOrder.length === bank.presetOrder.length &&
    nextOrder.every((u, i) => u === bank.presetOrder[i]);
  if (unchanged) {
    return { ok: true, moved: moving, banks };
  }

  const nextSelected = moving[moving.length - 1] ?? bank.selectedPreset;
  const now = Math.floor(Date.now() / 1000);
  const nextPresets = syncPresetPositionsToOrder(bank.presets, nextOrder);

  const updated = banks.map((b) => {
    if (b.uuid !== bankUuid) return b;
    return {
      ...b,
      presetOrder: nextOrder,
      presets: nextPresets,
      selectedPreset: nextSelected,
      lastChangedTimestamp: now,
    };
  });

  return { ok: true, moved: moving, banks: updated };
}

/** Criteria for sorting a bank's `preset-order`. */
export type PresetSortBy = 'name' | 'storeTime';

function presetLookup(bank: Bank): Map<string, Preset> {
  const map = new Map<string, Preset>();
  for (const preset of bank.presets) {
    map.set(preset.uuid.toLowerCase(), preset);
  }
  return map;
}

/**
 * Resolve C15 creation/store time from the preset field or rawXml
 * `<attribute name="StoreTime">…</attribute>` (source of truth on disk).
 */
export function resolvePresetStoreTime(preset: Preset): string {
  const fromField = (preset.storeTime ?? '').trim();
  if (fromField && fromField !== '0') return fromField;
  const fromXml = getPresetAttributes(preset.rawXml).storeTime.trim();
  if (fromXml && fromXml !== '0') return fromXml;
  return fromField || fromXml || '';
}

/**
 * Numeric sort key for StoreTime (ISO-8601 preferred).
 * Missing / "0" times sort after real timestamps (for ascending order).
 */
export function storeTimeSortValue(storeTime: string): number {
  const raw = storeTime.trim();
  if (!raw || raw === '0') return Number.POSITIVE_INFINITY;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return ms;
  // Non-ISO fallback: stable string rank via char codes is not needed — use 0 + string tiebreak later
  return Number.NaN;
}

function compareStoreTimes(a: string, b: string): number {
  const va = storeTimeSortValue(a);
  const vb = storeTimeSortValue(b);
  const aMissing = !Number.isFinite(va);
  const bMissing = !Number.isFinite(vb);
  if (aMissing && bMissing) return a.localeCompare(b);
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (va !== vb) return va - vb;
  return a.localeCompare(b);
}

function ordersEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

/**
 * Sort all presets in one bank by name (A→Z) or creation/store time (oldest→newest).
 * Uses C15 `StoreTime` attributes. If the bank is already in that order, reverses
 * (Z→A / newest→oldest) so the action always produces a visible reorder when keys differ.
 * Stable on ties. UUIDs and selection are preserved.
 */
export function sortPresetsInBank(
  banks: Bank[],
  bankUuid: string,
  sortBy: PresetSortBy,
): MovePresetsResult {
  const bank = findByUuid(banks, bankUuid);
  if (!bank) {
    return { ok: false, moved: [], error: 'Bank not found.' };
  }
  if (bank.presetOrder.length < 2) {
    return { ok: true, moved: [...bank.presetOrder], banks };
  }

  const byUuid = presetLookup(bank);
  const orderIndex = new Map<string, number>();
  bank.presetOrder.forEach((uuid, i) => {
    orderIndex.set(uuid.toLowerCase(), i);
  });

  // Cache resolved StoreTime so we don't re-parse rawXml per comparison.
  const storeTimeByUuid = new Map<string, string>();
  if (sortBy === 'storeTime') {
    for (const preset of bank.presets) {
      storeTimeByUuid.set(preset.uuid.toLowerCase(), resolvePresetStoreTime(preset));
    }
  }

  const ascending = [...bank.presetOrder].sort((a, b) => {
    const pa = byUuid.get(a.toLowerCase());
    const pb = byUuid.get(b.toLowerCase());
    if (!pa || !pb) {
      return (orderIndex.get(a.toLowerCase()) ?? 0) - (orderIndex.get(b.toLowerCase()) ?? 0);
    }

    let cmp = 0;
    if (sortBy === 'name') {
      cmp = pa.name.localeCompare(pb.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    } else {
      const ta = storeTimeByUuid.get(a.toLowerCase()) ?? '';
      const tb = storeTimeByUuid.get(b.toLowerCase()) ?? '';
      cmp = compareStoreTimes(ta, tb);
    }
    if (cmp !== 0) return cmp;
    return (orderIndex.get(a.toLowerCase()) ?? 0) - (orderIndex.get(b.toLowerCase()) ?? 0);
  });

  // Already ascending → reverse so a second click (or already-sorted bank) still reorders.
  const nextOrder = ordersEqual(ascending, bank.presetOrder)
    ? [...ascending].reverse()
    : ascending;

  if (ordersEqual(nextOrder, bank.presetOrder)) {
    return { ok: true, moved: [...nextOrder], banks };
  }

  const now = Math.floor(Date.now() / 1000);
  // Keep StoreTime field in sync; always rewrite pos to match new order (C15 export).
  const withStoreTime =
    sortBy === 'storeTime'
      ? bank.presets.map((preset) => {
          const resolved = storeTimeByUuid.get(preset.uuid.toLowerCase()) ?? '';
          return resolved && resolved !== preset.storeTime
            ? { ...preset, storeTime: resolved }
            : preset;
        })
      : bank.presets;
  const nextPresets = syncPresetPositionsToOrder(withStoreTime, nextOrder);

  const updated = banks.map((b) => {
    if (b.uuid.toLowerCase() !== bank.uuid.toLowerCase()) return b;
    return {
      ...b,
      presetOrder: nextOrder,
      presets: nextPresets,
      lastChangedTimestamp: now,
    };
  });

  return { ok: true, moved: [...nextOrder], banks: updated };
}

/**
 * Move presets from one bank to another (C15: UUID preserved, preset-order updated).
 * Appends to target `preset-order` by default.
 */
export function movePresetsBetweenBanks(
  banks: Bank[],
  presetUuids: readonly string[],
  sourceBankUuid: string,
  targetBankUuid: string,
  insertIndex?: number,
): MovePresetsResult {
  if (sourceBankUuid === targetBankUuid) {
    return { ok: false, moved: [], error: 'Source and target bank are the same.' };
  }

  const unique = [...new Set(presetUuids)];
  if (unique.length === 0) {
    return { ok: false, moved: [], error: 'No presets selected.' };
  }

  const source = banks.find((b) => b.uuid === sourceBankUuid);
  const target = banks.find((b) => b.uuid === targetBankUuid);
  if (!source || !target) {
    return { ok: false, moved: [], error: 'Source or target bank not found.' };
  }

  const toMove: Preset[] = [];
  for (const uuid of unique) {
    const preset = source.presets.find(
      (p) => p.uuid.toLowerCase() === uuid.toLowerCase(),
    );
    if (!preset) {
      return { ok: false, moved: [], error: `Preset not found in source bank: ${uuid}` };
    }
    if (target.presets.some((p) => p.uuid.toLowerCase() === uuid.toLowerCase())) {
      return { ok: false, moved: [], error: `Preset already exists in target bank: ${uuid}` };
    }
    toMove.push(preset);
  }

  const movedUuids = toMove.map((p) => p.uuid);
  const movedNeedle = new Set(movedUuids.map((u) => u.toLowerCase()));

  const nextSourceOrder = source.presetOrder.filter(
    (u) => !movedNeedle.has(u.toLowerCase()),
  );
  const nextSourcePresets = source.presets.filter(
    (p) => !movedNeedle.has(p.uuid.toLowerCase()),
  );
  let nextSourceSelected = source.selectedPreset;
  if (movedNeedle.has(source.selectedPreset.toLowerCase())) {
    nextSourceSelected = nextSourceOrder[0] ?? '';
  }

  const nextTargetOrder = [...target.presetOrder];
  const at = Math.max(
    0,
    Math.min(insertIndex ?? nextTargetOrder.length, nextTargetOrder.length),
  );
  nextTargetOrder.splice(at, 0, ...movedUuids);
  const nextTargetPresets = [...target.presets, ...toMove];
  const nextTargetSelected = movedUuids[movedUuids.length - 1] ?? target.selectedPreset;

  const now = Math.floor(Date.now() / 1000);

  const updated: Bank[] = banks.map((b) => {
    if (b.uuid === sourceBankUuid) {
      return {
        ...b,
        presetOrder: nextSourceOrder,
        presets: nextSourcePresets,
        selectedPreset: nextSourceSelected,
        lastChangedTimestamp: now,
      };
    }
    if (b.uuid === targetBankUuid) {
      return {
        ...b,
        presetOrder: nextTargetOrder,
        presets: nextTargetPresets,
        selectedPreset: nextTargetSelected,
        lastChangedTimestamp: now,
      };
    }
    return b;
  });

  return { ok: true, moved: movedUuids, banks: updated };
}