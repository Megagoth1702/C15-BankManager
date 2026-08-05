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
import { uniqueUuids, uuidEquals } from '../uuid/uuidKey';
import {
  pushLoadPreset,
  pushSelectBank,
  pushSelectPreset,
} from '../live/livePush';

export type SelectMode = 'replace' | 'toggle' | 'add';

/** Inclusive range between two UUIDs in tree/list order (sidebar bank multi-select). */
export function bankRangeInOrder(
  order: readonly string[],
  anchorUuid: string,
  clickedUuid: string,
): string[] {
  const i1 = order.findIndex((u) => uuidEquals(u, anchorUuid));
  const i2 = order.findIndex((u) => uuidEquals(u, clickedUuid));
  if (i1 === -1 || i2 === -1) return [clickedUuid];
  const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
  return order.slice(lo, hi + 1) as string[];
}

function uniqueBankUuids(uuids: readonly string[]): string[] {
  return uniqueUuids(uuids);
}

/**
 * Bank header context-menu selection (mirrors preset context menu):
 * if the bank is already selected, keep the full multi-selection;
 * otherwise select only the clicked bank.
 */
export function resolveBankContextMenuSelection(
  bankUuid: string,
  selectedBankUuids: readonly string[],
): { shouldSelectClicked: boolean } {
  const alreadySelected = selectedBankUuids.some((u) => uuidEquals(u, bankUuid));
  return { shouldSelectClicked: !alreadySelected };
}

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
    const next = uniqueBankUuids(
      mode === 'add' ? [...m.selectedBankUuids, ...uuids] : [...uuids],
    );
    const primary = next[next.length - 1] ?? null;
    const cleared = mode === 'replace' ? clearPresetSelectionFields(m) : m;
    return {
      ...cleared,
      selectedBankUuids: next,
      // Marquee / batch counts as a new anchor (plain selection gesture).
      bankSelectionAnchorUuid: primary,
      bankSelectionBaseUuids: next,
      deleteFocus: next.length > 0 ? 'bank' : null,
      selectionSurface: 'canvas',
      // Marquee / batch selection is canvas-origin — reveal primary bank in the sidebar tree.
      revealSidebarBankUuid: primary,
      renamingBankUuid:
        cleared.renamingBankUuid && primary && cleared.renamingBankUuid !== primary
          ? null
          : cleared.renamingBankUuid,
    };
  });
  if (uuids.length > 0) {
    setSidebarTab('banks');
  }
  log('store', 'selectBanks', { count: uuids.length, mode });
  selTraceSelection('store.selectBanks', {
    mode,
    requested: uuids.map((u) => u.slice(0, 8)),
  });

  // C15 is single-select. Multi-select (marquee / bulk move) is app-local —
  // do not push select-bank for N≥2 (echoes used to collapse multi-select).
  if (mode === 'replace' && uuids.length === 1) {
    pushSelectBank(uuids[0]!);
  }
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
          revealSidebarPresetUuid: surface === 'canvas' ? presetUuid : null,
        }),
      );
      syncBankSelectedPreset(bankUuid, presetUuid);
      // Device selects the range end (primary).
      pushSelectPreset(presetUuid);
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
        revealSidebarPresetUuid: surface === 'canvas' ? presetUuid : null,
      }),
    );
    if (frozen.length > 0) {
      syncBankSelectedPreset(bankUuid, presetUuid);
      pushSelectPreset(presetUuid);
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

  // NonMaps: second click on already-selected sole preset → load into edit buffer.
  const alreadySoleSelected =
    sameBank &&
    meta.selectedPresetUuids.length === 1 &&
    uuidEquals(meta.selectedPresetUuids[0]!, presetUuid);

  bankMeta.update((m) =>
    withPresetFocus(m, surface, {
      presetSelectionBankUuid: bankUuid,
      selectedPresetUuids: [presetUuid],
      presetSelectionAnchorUuid: presetUuid,
      presetSelectionBaseUuids: [presetUuid],
      revealSidebarPresetUuid: surface === 'canvas' ? presetUuid : null,
    }),
  );
  syncBankSelectedPreset(bankUuid, presetUuid);

  if (alreadySoleSelected) {
    pushLoadPreset(presetUuid);
    log('store', 'loadPreset', { bankUuid, presetUuid });
    selTraceSelection('store.loadPreset', {
      bankUuid: bankUuid.slice(0, 8),
      presetUuid: presetUuid.slice(0, 8),
      surface,
    });
  } else {
    pushSelectPreset(presetUuid);
    log('store', 'selectPreset', { bankUuid, presetUuid });
    selTraceSelection('store.selectPreset', {
      bankUuid: bankUuid.slice(0, 8),
      presetUuid: presetUuid.slice(0, 8),
      ctrl: options.ctrl ?? false,
      shift: options.shift ?? false,
      surface: options.surface ?? 'canvas',
    });
  }
}

/** Load the primary selected preset into the C15 edit buffer (Enter / Live). */
export function loadSelectedPreset(): boolean {
  const meta = get(bankMeta);
  const uuid =
    meta.selectedPresetUuids[meta.selectedPresetUuids.length - 1] ?? null;
  if (!uuid) return false;
  pushLoadPreset(uuid);
  log('store', 'loadSelectedPreset', { presetUuid: uuid });
  return true;
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
    if (surface === 'canvas') {
      bankMeta.update((m) => ({
        ...m,
        revealSidebarPresetUuid: primary,
      }));
    }
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
      revealSidebarPresetUuid: surface === 'canvas' ? primary : null,
    }),
  );
  syncBankSelectedPreset(bankUuid, primary);
  pushSelectPreset(primary);
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
        ...clearBankSelectionFields(m),
        deleteFocus: null,
        revealSidebarBankUuid: null,
      });
    }

    let next: string[];
    if (mode === 'replace') {
      next = [uuid];
    } else if (mode === 'toggle') {
      next = m.selectedBankUuids.some((u) => uuidEquals(u, uuid))
        ? m.selectedBankUuids.filter((u) => !uuidEquals(u, uuid))
        : [...m.selectedBankUuids, uuid];
    } else {
      next = m.selectedBankUuids.some((u) => uuidEquals(u, uuid))
        ? m.selectedBankUuids
        : [...m.selectedBankUuids, uuid];
    }

    const primary = next[next.length - 1] ?? null;
    const cleared =
      mode === 'replace' ? clearPresetSelectionFields(m) : m;
    // Plain click and Ctrl/Meta toggle/add set the shift anchor + frozen base.
    // Shift-range (selectBankRange) never calls here for the range path.
    const anchorUuid = next.length > 0 ? uuid : null;
    const baseUuids = next;
    // Toggle deselect of last bank leaves no selection to reveal.
    const reveal =
      surface === 'canvas' && primary != null ? primary : null;
    // Sidebar bank pick → pan canvas to that bank's header (zoom unchanged).
    const focusTarget =
      surface === 'sidebar' && uuid !== null && next.some((u) => uuidEquals(u, uuid))
        ? uuid
        : null;
    return {
      ...cleared,
      selectedBankUuids: next,
      bankSelectionAnchorUuid: anchorUuid,
      bankSelectionBaseUuids: baseUuids,
      deleteFocus: uuid !== null && next.length > 0 ? 'bank' : null,
      selectionSurface: surface,
      revealSidebarBankUuid: reveal,
      focusBankUuid: focusTarget ?? cleared.focusBankUuid,
      focusPresetUuid: focusTarget ? null : cleared.focusPresetUuid,
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

  // Mirror primary selection onto device (NonMaps select-bank).
  if (uuid && mode === 'replace') {
    pushSelectBank(uuid);
  }
}

/**
 * Sidebar tree click — Ctrl toggles; Shift range from fixed anchor in tree order;
 * plain click replaces. Anchor/base update only on plain and Ctrl clicks (via
 * selectBank); successive Shift clicks re-range from the same anchor and union
 * onto the frozen base so prior multi-select is not wiped.
 */
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
    const meta = get(bankMeta);
    const anchor =
      meta.bankSelectionAnchorUuid ??
      meta.selectedBankUuids[meta.selectedBankUuids.length - 1] ??
      null;
    if (!anchor) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const anchorIdx = orderedUuids.findIndex((u) => uuidEquals(u, anchor));
    const clickIdx = orderedUuids.findIndex((u) => uuidEquals(u, uuid));
    if (anchorIdx === -1 || clickIdx === -1) {
      selectBank(uuid, 'replace', 'sidebar');
      return;
    }
    const range = bankRangeInOrder(orderedUuids, anchor, uuid);
    const frozenBase =
      meta.bankSelectionBaseUuids.length > 0
        ? meta.bankSelectionBaseUuids
        : meta.selectedBankUuids.length > 0
          ? meta.selectedBankUuids
          : [anchor];
    const selected = uniqueBankUuids([...frozenBase, ...range]);
    setSidebarTab('banks');
    bankMeta.update((m) => ({
      ...clearPresetSelectionFields(m),
      selectedBankUuids: selected,
      // Keep anchor + base frozen across successive Shift range adjusts.
      bankSelectionAnchorUuid: anchor,
      bankSelectionBaseUuids: frozenBase,
      renamingBankUuid: null,
      deleteFocus: 'bank',
      selectionSurface: 'sidebar',
      revealSidebarBankUuid: null,
      focusBankUuid: uuid,
      focusPresetUuid: null,
    }));
    log('store', 'selectBankRange', {
      uuid,
      anchor,
      count: selected.length,
    });
    selTraceSelection('store.selectBankRange', {
      uuid: uuid.slice(0, 8),
      anchor: anchor.slice(0, 8),
      count: selected.length,
    });
    return;
  }
  selectBank(uuid, 'replace', 'sidebar');
}

export function startRenameBank(uuid: string, surface: InteractionSurface): void {
  setSidebarTab('banks');
  bankMeta.update((m) => ({
    ...m,
    selectedBankUuids: [uuid],
    bankSelectionAnchorUuid: uuid,
    bankSelectionBaseUuids: [uuid],
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
