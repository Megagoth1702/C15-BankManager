/**
 * Single writer for bank document mutations + store errors.
 */
import { get } from 'svelte/store';
import type { Bank } from '../types/bank';
import { log } from '../debug/sessionLog';
import { bankMeta, banks, getBanksSnapshot } from './bankState';
import { markSessionDirty } from './sessionDirty';
import { findByUuid } from '../uuid/uuidKey';

export function commitBanks(list: Bank[]): void {
  banks.set(list);
  markSessionDirty();
}

/** Set banks without marking dirty (first empty import / special cases). */
export function replaceBanksQuiet(list: Bank[]): void {
  banks.set(list);
}

export function getBankByUuid(uuid: string): Bank | undefined {
  return findByUuid(getBanksSnapshot(), uuid);
}

export function clearError(): void {
  bankMeta.update((m) => ({ ...m, error: null }));
}

export function setStoreError(message: string): void {
  bankMeta.update((m) => ({ ...m, error: message }));
  log('store', 'error', message, 'warn');
}

export function clearPresetSelectionFields<
  T extends {
    selectedPresetUuids: string[];
    presetSelectionBankUuid: string | null;
    presetSelectionAnchorUuid: string | null;
    presetSelectionBaseUuids: string[];
  },
>(m: T): T {
  return {
    ...m,
    selectedPresetUuids: [],
    presetSelectionBankUuid: null,
    presetSelectionAnchorUuid: null,
    presetSelectionBaseUuids: [],
  };
}

/** Clear canvas bank multi-select (used when focusing preset selection). */
export function clearBankSelectionFields<
  T extends {
    selectedBankUuids: string[];
    renamingBankUuid: string | null;
  },
>(m: T): T {
  return {
    ...m,
    selectedBankUuids: [],
    renamingBankUuid: null,
  };
}

export function syncBankSelectedPreset(bankUuid: string, presetUuid: string): void {
  const list = getBanksSnapshot();
  const bank = findByUuid(list, bankUuid);
  // Skip full banks[] rewrite when primary is already correct (hot path: preset drag start).
  if (
    bank &&
    bank.selectedPreset != null &&
    bank.selectedPreset.toLowerCase() === presetUuid.toLowerCase()
  ) {
    return;
  }
  banks.update((prev) =>
    prev.map((b) =>
      b.uuid === bankUuid ? { ...b, selectedPreset: presetUuid } : b,
    ),
  );
}

export function getPrimarySelectedUuid(): string | null {
  const uuids = get(bankMeta).selectedBankUuids;
  return uuids.length > 0 ? uuids[uuids.length - 1]! : null;
}

export function getSelectedBank(): Bank | undefined {
  const uuid = getPrimarySelectedUuid();
  if (!uuid) return undefined;
  return getBankByUuid(uuid);
}

export function isBankSelected(uuid: string): boolean {
  return get(bankMeta).selectedBankUuids.includes(uuid);
}
