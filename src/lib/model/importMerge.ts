import { horizontalAttachStep } from '../canvas/geometry';
import type { Bank, Preset } from '../types/bank';
import { freshC15Uuid } from '../uuid/c15Uuid';
import { snapToGrid } from './bankFactory';
import { clonePresetWithNewUuid } from './presetMove';

export interface PlacementOffset {
  dx: number;
  dy: number;
}

export interface MergeBankListsOptions {
  /** Keep incoming x/y after UUID remap (e.g. already placed at viewport center). */
  preserveIncomingPositions?: boolean;
}

/** Anchor for placing a new imported group to the right of the current canvas. */
export function defaultPlacementAnchor(current: Bank[]): { x: number; y: number } {
  if (current.length === 0) return { x: 0, y: 0 };

  let maxX = -Infinity;
  let sumY = 0;
  for (const bank of current) {
    maxX = Math.max(maxX, bank.x);
    sumY += bank.y;
  }
  return {
    x: snapToGrid(maxX + horizontalAttachStep()),
    y: snapToGrid(sumY / current.length),
  };
}

/** Translate an imported group so its top-left aligns to the placement anchor. */
export function placementOffsetForNewBanks(
  current: Bank[],
  incoming: Bank[],
): PlacementOffset {
  if (current.length === 0 || incoming.length === 0) {
    return { dx: 0, dy: 0 };
  }

  const anchor = defaultPlacementAnchor(current);
  let minX = Infinity;
  let minY = Infinity;
  for (const bank of incoming) {
    minX = Math.min(minX, bank.x);
    minY = Math.min(minY, bank.y);
  }

  return {
    dx: snapToGrid(anchor.x - minX),
    dy: snapToGrid(anchor.y - minY),
  };
}

function collectPresetUuids(banks: readonly Bank[]): Set<string> {
  const used = new Set<string>();
  for (const bank of banks) {
    for (const preset of bank.presets) {
      used.add(preset.uuid.toLowerCase());
    }
  }
  return used;
}

function remapBankPresets(
  bank: Bank,
  usedPresetUuids: Set<string>,
): Pick<Bank, 'presets' | 'presetOrder' | 'selectedPreset'> {
  const presetIdRemap = new Map<string, string>();

  const presets = bank.presets.map((preset) => {
    const key = preset.uuid.toLowerCase();
    if (usedPresetUuids.has(key)) {
      const newId = freshC15Uuid(usedPresetUuids);
      presetIdRemap.set(preset.uuid, newId);
      return clonePresetWithNewUuid(preset, newId);
    }
    usedPresetUuids.add(key);
    return preset;
  });

  const presetOrder = bank.presetOrder.map((id) => presetIdRemap.get(id) ?? id);
  const selectedPreset = presetIdRemap.get(bank.selectedPreset) ?? bank.selectedPreset;

  return { presets, presetOrder, selectedPreset };
}

/**
 * Assign fresh C15 UUIDs to incoming banks/presets that collide with the session
 * (or earlier banks in the same import batch). Updates attachments and preset-order.
 *
 * Collisions **within the batch** are handled per instance. A single old→new map would
 * incorrectly rewrite the first bank to the second's reminted id (and can create
 * self-attachments that hang attachment walks / Svelte keyed lists).
 */
export function remapIncomingAgainstSession(current: Bank[], incoming: Bank[]): Bank[] {
  const usedBankUuids = new Set(current.map((bank) => bank.uuid.toLowerCase()));
  const usedPresetUuids = collectPresetUuids(current);

  // Per-index final bank UUID: first occurrence keeps its id (if free); later collisions remint.
  const finalBankUuids: string[] = new Array(incoming.length);
  // Original uuid (lowercase) → final uuid of the *first* incoming instance with that id.
  // Attachment targets that pointed at the shared source id resolve to the first bank.
  const firstInstanceFinalByOriginal = new Map<string, string>();

  for (let i = 0; i < incoming.length; i++) {
    const bank = incoming[i]!;
    const key = bank.uuid.toLowerCase();
    let finalUuid: string;
    if (usedBankUuids.has(key)) {
      finalUuid = freshC15Uuid(usedBankUuids);
    } else {
      usedBankUuids.add(key);
      finalUuid = bank.uuid;
    }
    finalBankUuids[i] = finalUuid;
    if (!firstInstanceFinalByOriginal.has(key)) {
      firstInstanceFinalByOriginal.set(key, finalUuid);
    }
  }

  return incoming.map((bank, i) => {
    const uuid = finalBankUuids[i]!;
    const presetFields = remapBankPresets(bank, usedPresetUuids);

    let attachedToUuid = bank.attachedToUuid;
    let attachDirection = bank.attachDirection;
    if (attachedToUuid) {
      const targetKey = attachedToUuid.toLowerCase();
      attachedToUuid = firstInstanceFinalByOriginal.get(targetKey) ?? attachedToUuid;
      // Self-link can appear when two source banks shared a UUID before remint.
      if (attachedToUuid.toLowerCase() === uuid.toLowerCase()) {
        attachedToUuid = null;
        attachDirection = null;
      }
    }

    return {
      ...bank,
      uuid,
      ...presetFields,
      attachedToUuid,
      attachDirection,
    };
  });
}

/**
 * Merge incoming banks into current. Colliding UUIDs are remapped (C15-style);
 * imports are always added — never merged in place by UUID.
 */
export function mergeBankLists(
  current: Bank[],
  incoming: Bank[],
  options: MergeBankListsOptions = {},
): Bank[] {
  if (incoming.length === 0) return [...current];

  const prepared = remapIncomingAgainstSession(current, incoming);
  const preserveExact =
    options.preserveIncomingPositions === true || current.length === 0;
  const offset = preserveExact
    ? { dx: 0, dy: 0 }
    : placementOffsetForNewBanks(current, prepared);

  const additions = prepared.map((bank) => ({
    ...bank,
    x: snapToGrid(bank.x + offset.dx),
    y: snapToGrid(bank.y + offset.dy),
  }));

  return [...current, ...additions];
}