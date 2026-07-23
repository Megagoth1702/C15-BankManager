import { get, writable } from 'svelte/store';
import type { Bank } from '../types/bank';

export type ImportMode = 'replace' | 'merge' | 'folder';

/** Where the user last selected or edits a bank/preset. */
export type InteractionSurface = 'canvas' | 'sidebar';

export const banks = writable<Bank[]>([]);

export const bankMeta = writable({
  /** Ordered selection; last entry is primary (attach handles, F2, status detail). */
  selectedBankUuids: [] as string[],
  selectedMidiBankUuid: '',
  serializeDate: '',
  loading: false,
  error: null as string | null,
  lastImportFilename: '',
  lastImportMode: null as ImportMode | null,
  /** When set, sidebar shows inline rename for this bank (F2 / double-click). */
  renamingBankUuid: null as string | null,
  /** Canvas vs sidebar — F2 rename appears only on the matching surface. */
  selectionSurface: null as InteractionSurface | null,
  renameSurface: null as InteractionSurface | null,
  /** Pan canvas to this bank after search result selection. */
  focusBankUuid: null as string | null,
  /** When set with focusBankUuid, center on this preset row instead of the bank. */
  focusPresetUuid: null as string | null,
  /** Inline preset rename target (F2 / context menu). */
  renamingPreset: null as { bankUuid: string; presetUuid: string } | null,
  /** Multi-preset selection within a single bank (canvas UI). */
  selectedPresetUuids: [] as string[],
  presetSelectionBankUuid: null as string | null,
  /** Shift-range anchor; updated on plain click and Ctrl+click. */
  presetSelectionAnchorUuid: null as string | null,
  /** Frozen selection base — shift ranges union onto this (survives across shift after Ctrl). */
  presetSelectionBaseUuids: [] as string[],
  /** Which selection Delete / Backspace targets — last explicit bank vs preset action. */
  deleteFocus: null as 'bank' | 'preset' | null,
});

/** App preferences (local session). */
export const appSettings = writable({
  /** When true, show the synth GUI no-go zone overlay on the canvas. */
  showSynthZone: true,
  /** When true, show calibration crosses and width-calib debug rulers. */
  showDebugShapes: false,
  sidebarWidthPx: 224,
  sidebarTab: 'banks' as 'banks' | 'presets',
});

/**
 * Reserved for banks manually offset while still logically attached (future use).
 * Drag undock uses `detachBanksKeepingDisplay` / boundary cut via `planBankDrag`.
 */
export const userPositionedUuids = writable<Set<string>>(new Set());

export function getBanksSnapshot(): Bank[] {
  return get(banks);
}

export function getBankMetaSnapshot() {
  return get(bankMeta);
}

export function clearUserPositioned(): void {
  userPositionedUuids.set(new Set());
}