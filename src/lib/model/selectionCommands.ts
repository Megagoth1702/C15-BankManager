/**
 * Bank/preset selection + inline rename targets (UI interaction state).
 */
import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import { selTraceSelection } from '../debug/selectionTrace';
import {
  bankMeta,
  getBanksSnapshot,
  type InteractionSurface,
} from './bankState';
import {
  clearBankSelectionFields,
  clearPresetSelectionFields,
  syncBankSelectedPreset,
} from './documentCommit';
import { presetRangeInOrder, uniquePresetUuids } from './presetSelection';
import { setSidebarTab } from './settingsCommands';
import { uuidEquals } from '../uuid/uuidKey';

export type SelectMode = 'replace' | 'toggle' | 'add';

/** Preset focus always clears bank multi-select so both cannot stay active. */
function withPresetFocus<
  T extends {
    selectedBankUuids: string[];
    renamingBankUuid: string | null;
    deleteFocus: 'bank' | 'preset' | null;
    selectionSurface: InteractionSurface | null;
  },
>(m: T, surface: InteractionSurface, patch: Partial<T>): T {
  return {
    ...clearBankSelectionFields(m),
    ...patch,
    deleteFocus: 'preset' as const,
    selectionSurface: surface,
  };
}

export function selectBanks(
  uuids: readonly string[],
  mode: 'replace' | 'add' = 'replace',
): void {
  bankMeta.update((m) => {
    const next =
      mode === 'add'
        ? [...new Set([...m.selectedBankUuids, ...uuids])]
        : [...uuids];
    const primary = next[next.length - 1] ?? null;
    const base = mode === 'replace' ? clearPresetSelectionFields(m) : m;
    return {
      ...base,
      selectedBankUuids: next,
      deleteFocus: next.length > 0 ? 'bank' : null,
      renamingBankUuid:
        base.renamingBankUuid && primary && base.renamingBankUuid !== primary
          ? null
          : base.renamingBankUuid,
    };
  });
  log('store', 'selectBanks', { count: uuids.length, mode });
  selTraceSelection('store.selectBanks', {
    mode,
    requested: uuids.map((u) => u.slice(0, 8)),
  });
}

export function selectPreset(
  bankUuid: string,
  presetUuid: string,
  options: { ctrl?: boolean; shift?: boolean; surface?: InteractionSurface } = {},
): void {
  const list = getBanksSnapshot();
  const bank = list.find((b) => b.uuid === bankUuid);
  if (!bank) return;

  const surface = options.surface ?? 'canvas';
  setSidebarTab('presets');

  const order = bank.presetOrder;
  const meta = get(bankMeta);
  const renaming = meta.renamingPreset;
  if (
    renaming &&
    (renaming.bankUuid !== bankUuid ||
      !uuidEquals(renaming.presetUuid, presetUuid))
  ) {
    cancelRenamePreset();
  }
  const sameBank = meta.presetSelectionBankUuid === bankUuid;

  if (options.shift && sameBank) {
    const anchor =
      meta.presetSelectionAnchorUuid ??
      meta.selectedPresetUuids[meta.selectedPresetUuids.length - 1];
    if (anchor) {
      const range = presetRangeInOrder(order, anchor, presetUuid);
      const base =
        meta.presetSelectionBaseUuids.length > 0
          ? meta.presetSelectionBaseUuids
          : [anchor];
      const selected = uniquePresetUuids([...base, ...range]);
      bankMeta.update((m) =>
        withPresetFocus(m, surface, {
          presetSelectionBankUuid: bankUuid,
          selectedPresetUuids: selected,
        }),
      );
      syncBankSelectedPreset(bankUuid, presetUuid);
      log('store', 'selectPresetRange', { bankUuid, count: selected.length });
      selTraceSelection('store.selectPresetRange', {
        bankUuid: bankUuid.slice(0, 8),
        count: selected.length,
        surface,
      });
      return;
    }
  }

  if (options.ctrl && sameBank) {
    const next = meta.selectedPresetUuids.some((u) => uuidEquals(u, presetUuid))
      ? meta.selectedPresetUuids.filter((u) => !uuidEquals(u, presetUuid))
      : [...meta.selectedPresetUuids, presetUuid];
    const frozen = uniquePresetUuids(next);
    bankMeta.update((m) =>
      withPresetFocus(m, surface, {
        presetSelectionBankUuid: bankUuid,
        selectedPresetUuids: frozen,
        presetSelectionAnchorUuid: presetUuid,
        presetSelectionBaseUuids: frozen,
      }),
    );
    if (frozen.length > 0) {
      syncBankSelectedPreset(bankUuid, presetUuid);
    }
    log('store', 'selectPresetToggle', { bankUuid, presetUuid });
    selTraceSelection('store.selectPresetToggle', {
      bankUuid: bankUuid.slice(0, 8),
      presetUuid: presetUuid.slice(0, 8),
      count: frozen.length,
      surface,
    });
    return;
  }

  bankMeta.update((m) =>
    withPresetFocus(m, surface, {
      presetSelectionBankUuid: bankUuid,
      selectedPresetUuids: [presetUuid],
      presetSelectionAnchorUuid: presetUuid,
      presetSelectionBaseUuids: [presetUuid],
    }),
  );
  syncBankSelectedPreset(bankUuid, presetUuid);
  log('store', 'selectPreset', { bankUuid, presetUuid });
  selTraceSelection('store.selectPreset', {
    bankUuid: bankUuid.slice(0, 8),
    presetUuid: presetUuid.slice(0, 8),
    ctrl: options.ctrl ?? false,
    shift: options.shift ?? false,
    surface: options.surface ?? 'canvas',
  });
}

/** Select multiple presets in one bank (e.g. when starting a drag). */
export function selectPresetsBatch(
  bankUuid: string,
  presetUuids: readonly string[],
  surface: InteractionSurface = 'canvas',
): void {
  const frozen = uniquePresetUuids(presetUuids);
  if (frozen.length === 0) return;
  const primary = frozen[frozen.length - 1]!;
  const meta = get(bankMeta);
  const sameBank = meta.presetSelectionBankUuid === bankUuid;
  const sameSelection =
    sameBank &&
    meta.selectedPresetUuids.length === frozen.length &&
    frozen.every((u, i) => uuidEquals(u, meta.selectedPresetUuids[i] ?? ''));
  // Already the active multi-selection — skip store/localStorage thrash (preset drag start).
  if (sameSelection && !meta.renamingPreset) {
    setSidebarTab('presets');
    syncBankSelectedPreset(bankUuid, primary);
    return;
  }
  const renaming = meta.renamingPreset;
  if (
    renaming &&
    (renaming.bankUuid !== bankUuid ||
      !frozen.some((u) => uuidEquals(u, renaming.presetUuid)))
  ) {
    cancelRenamePreset();
  }
  setSidebarTab('presets');
  bankMeta.update((m) =>
    withPresetFocus(m, surface, {
      presetSelectionBankUuid: bankUuid,
      selectedPresetUuids: frozen,
      presetSelectionAnchorUuid: primary,
      presetSelectionBaseUuids: frozen,
    }),
  );
  syncBankSelectedPreset(bankUuid, primary);
  log('store', 'selectPresetsBatch', { bankUuid, count: frozen.length });
  selTraceSelection('store.selectPresetsBatch', {
    bankUuid: bankUuid.slice(0, 8),
    count: frozen.length,
    surface,
  });
}

export function selectBank(
  uuid: string | null,
  mode: SelectMode = 'replace',
  surface: InteractionSurface = 'canvas',
): void {
  const meta = get(bankMeta);
  if (uuid !== null) {
    setSidebarTab('banks');
    if (meta.renamingBankUuid && meta.renamingBankUuid !== uuid) {
      cancelRenameBank();
    }
    if (meta.renamingPreset) {
      cancelRenamePreset();
    }
  } else if (meta.renamingBankUuid || meta.renamingPreset) {
    cancelRenameBank();
    cancelRenamePreset();
  }

  bankMeta.update((m) => {
    if (uuid === null) {
      return clearPresetSelectionFields({
        ...m,
        selectedBankUuids: [],
        renamingBankUuid: null,
        deleteFocus: null,
      });
    }

    let next: string[];
    if (mode === 'replace') {
      next = [uuid];
    } else if (mode === 'toggle') {
      next = m.selectedBankUuids.includes(uuid)
        ? m.selectedBankUuids.filter((u) => u !== uuid)
        : [...m.selectedBankUuids, uuid];
    } else {
      next = m.selectedBankUuids.includes(uuid)
        ? m.selectedBankUuids
        : [...m.selectedBankUuids, uuid];
    }

    const primary = next[next.length - 1] ?? null;
    const cleared =
      mode === 'replace' ? clearPresetSelectionFields(m) : m;
    return {
      ...cleared,
      selectedBankUuids: next,
      deleteFocus: uuid !== null && next.length > 0 ? 'bank' : null,
      selectionSurface: surface,
      renamingBankUuid:
        cleared.renamingBankUuid && primary && cleared.renamingBankUuid !== primary
          ? null
          : cleared.renamingBankUuid,
    };
  });
  log('store', 'selectBank', { uuid, mode, surface });
  selTraceSelection('store.selectBank', {
    uuid: uuid ? uuid.slice(0, 8) : null,
    mode,
    surface,
  });
}

/** Sidebar tree click — Ctrl toggles; Shift range in tree order; plain click replaces. */
export function selectBankRange(
  uuid: string,
  orderedUuids: string[],
  options: { shift?: boolean; ctrl?: boolean },
): void {
  if (options.ctrl) {
    selectBank(uuid, 'toggle', 'sidebar');
    return;
  }
  if (options.shift) {
    const current = get(bankMeta).selectedBankUuids;
    const anchor = current[current.length - 1];
    if (!anchor) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const i1 = orderedUuids.indexOf(anchor);
    const i2 = orderedUuids.indexOf(uuid);
    if (i1 === -1 || i2 === -1) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
    setSidebarTab('banks');
    bankMeta.update((m) => ({
      ...clearPresetSelectionFields(m),
      selectedBankUuids: orderedUuids.slice(lo, hi + 1),
      renamingBankUuid: null,
      deleteFocus: 'bank',
      selectionSurface: 'sidebar',
    }));
    log('store', 'selectBankRange', { uuid, lo, hi });
    return;
  }
  selectBank(uuid, 'replace', 'sidebar');
}

export function startRenameBank(uuid: string, surface: InteractionSurface): void {
  setSidebarTab('banks');
  bankMeta.update((m) => ({
    ...m,
    selectedBankUuids: [uuid],
    deleteFocus: 'bank',
    renamingBankUuid: uuid,
    renameSurface: surface,
    selectionSurface: surface,
    renamingPreset: null,
    error: null,
  }));
  log('store', 'startRenameBank', { uuid, surface });
}

export function cancelRenameBank(): void {
  bankMeta.update((m) => ({ ...m, renamingBankUuid: null, renameSurface: null }));
}

export function startRenamePreset(
  bankUuid: string,
  presetUuid: string,
  surface: InteractionSurface,
): void {
  setSidebarTab('presets');
  bankMeta.update((m) =>
    withPresetFocus(m, surface, {
      presetSelectionBankUuid: bankUuid,
      selectedPresetUuids: [presetUuid],
      renamingPreset: { bankUuid, presetUuid },
      renameSurface: surface,
      renamingBankUuid: null,
    }),
  );
}

export function cancelRenamePreset(): void {
  bankMeta.update((m) => ({ ...m, renamingPreset: null, renameSurface: null }));
}
