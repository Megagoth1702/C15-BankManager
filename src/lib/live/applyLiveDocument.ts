/**
 * Merge live playground documents into the app Bank model and commit to the store.
 * Mirrors NonMaps maps PresetManager.updateBanks (keep shells; replace changed).
 */

import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import type { Bank, Preset, PresetType } from '../types/bank';
import {
  bankMeta,
  banks,
  clearUserPositioned,
  getBanksSnapshot,
} from '../model/bankState';
import { clearHistory } from '../model/undoHistory';
import { clearSessionDirty } from '../model/sessionDirty';
import { findByUuid } from '../uuid/uuidKey';
import {
  parseLiveDocument,
  type LiveBankSnapshot,
  type LiveDocumentSnapshot,
  type LivePresetSnapshot,
} from './parseLiveDocument';

export interface ApplyLiveResult {
  applied: boolean;
  reason: string;
  bankCount: number;
  updateId: number | null;
  /** True when this was the first successful library apply after connect. */
  firstLibraryPull: boolean;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Minimal offline-shaped preset block for UI/export of live-only presets.
 * Parameter trees are not present in live WS pushes — full sound data needs
 * `/presets/download-banks` (not used on every pull; HWUI splash).
 */
export function synthesizeLivePresetRawXml(
  pos: number,
  snap: LivePresetSnapshot,
  attrs: Record<string, string>,
): string {
  const lines: string[] = [`<preset pos="${pos}">`];
  lines.push(` <uuid>${escapeXml(snap.uuid)}</uuid>`);
  lines.push(` <name>${escapeXml(snap.name)}</name>`);
  lines.push(` <type>${escapeXml(snap.type)}</type>`);

  const keys = Object.keys(attrs);
  if (keys.length > 0) {
    lines.push(' <attributes>');
    for (const key of keys) {
      lines.push(
        `  <attribute name="${escapeXml(key)}">${escapeXml(attrs[key] ?? '')}</attribute>`,
      );
    }
    lines.push(' </attributes>');
  }

  lines.push('</preset>');
  return lines.join('\n');
}

function metaFromLiveAttrs(attrs: Record<string, string>): {
  comment: string;
  deviceName: string;
  color: string;
  storeTime: string;
} {
  return {
    comment: attrs.Comment ?? attrs.comment ?? '',
    deviceName: attrs.DeviceName ?? attrs.deviceName ?? '',
    color: attrs.color ?? '',
    storeTime: attrs.StoreTime ?? attrs.storeTime ?? '',
  };
}

function mergePreset(
  pos: number,
  snap: LivePresetSnapshot,
  previous: Preset | undefined,
): Preset {
  // UUID may differ after import-bank remint; still prefer previous body when
  // the caller matched by slot (same index in the bank).
  const prev = previous;

  // Unchanged shell: keep previous body (rawXml / meta).
  if (!snap.changed && prev) {
    return {
      ...prev,
      // Device uuid wins so later live ops target the real preset.
      uuid: snap.uuid || prev.uuid,
      pos,
      name: snap.name || prev.name,
      type: (snap.type || prev.type) as PresetType,
    };
  }

  const attrs =
    snap.changed && Object.keys(snap.attributes).length > 0
      ? snap.attributes
      : prev
        ? {
            Comment: prev.comment,
            DeviceName: prev.deviceName,
            color: prev.color,
            StoreTime: prev.storeTime,
          }
        : { ...snap.attributes };

  // Prefer previous rawXml when we have offline/full content and live is a
  // shell (no attrs) or only metadata — import-bank remints preset UUIDs so
  // identity match alone is not enough.
  let rawXml: string;
  const liveHasAttrs = Object.keys(snap.attributes).length > 0;
  if (prev?.rawXml && (!snap.changed || !liveHasAttrs)) {
    rawXml = prev.rawXml;
  } else if (prev?.rawXml && snap.changed && liveHasAttrs) {
    // Live attrs updated — if previous has full parameter trees, keep them
    // and only resynthesize when previous was already a thin live shell.
    const prevHasParams =
      prev.rawXml.includes('<parameter') ||
      prev.rawXml.includes('<parameter-group');
    rawXml = prevHasParams
      ? prev.rawXml
      : synthesizeLivePresetRawXml(pos, snap, attrs);
  } else {
    rawXml = synthesizeLivePresetRawXml(pos, snap, attrs);
  }

  const meta = metaFromLiveAttrs(attrs);
  return {
    pos,
    uuid: snap.uuid,
    name: snap.name || prev?.name || 'Unnamed',
    type: snap.type || prev?.type || 'Single',
    comment: meta.comment || prev?.comment || '',
    deviceName: meta.deviceName || prev?.deviceName || '',
    color: meta.color || prev?.color || '',
    storeTime: meta.storeTime || prev?.storeTime || '',
    rawXml,
  };
}

function mergeBank(snap: LiveBankSnapshot, previous: Bank | undefined): Bank {
  // Shell only: keep content, refresh always-present tag fields.
  if (!snap.changed && previous) {
    return {
      ...previous,
      name: snap.name || previous.name,
      x: snap.x,
      y: snap.y,
      selectedPreset: snap.selectedPreset || previous.selectedPreset,
    };
  }

  const prevPresets = previous?.presets ?? [];
  const prevByUuid = new Map(
    prevPresets.map((p) => [p.uuid.toLowerCase(), p]),
  );

  const livePresets = snap.presets ?? [];

  // Changed bank with no preset children (or parse miss) but we already have
  // full local content — keep bodies rather than paint an empty header shell.
  if (livePresets.length === 0 && prevPresets.length > 0) {
    return {
      ...previous!,
      name: snap.name || previous!.name,
      x: snap.x,
      y: snap.y,
      attachedToUuid: snap.changed
        ? snap.attachedToUuid
        : (previous!.attachedToUuid ?? null),
      attachDirection: snap.changed
        ? snap.attachDirection
        : (previous!.attachDirection ?? null),
      selectedPreset: snap.selectedPreset || previous!.selectedPreset,
      attributes: snap.changed
        ? { ...(previous!.attributes ?? {}), ...snap.attributes }
        : (previous!.attributes ?? {}),
    };
  }

  const presets: Preset[] = livePresets.map((p, index) => {
    // Prefer UUID match; fall back to same slot so reminted live presets still
    // inherit offline rawXml / metadata from the just-imported local bank.
    const prev =
      prevByUuid.get(p.uuid.toLowerCase()) ?? prevPresets[index];
    return mergePreset(index, p, prev);
  });
  const presetOrder = presets.map((p) => p.uuid);

  // Attachment only present when bank.changed; otherwise keep previous.
  const attachedToUuid = snap.changed
    ? snap.attachedToUuid
    : (previous?.attachedToUuid ?? null);
  const attachDirection = snap.changed
    ? snap.attachDirection
    : (previous?.attachDirection ?? null);

  const attributes = snap.changed
    ? { ...(previous?.attributes ?? {}), ...snap.attributes }
    : (previous?.attributes ?? {});

  if (snap.changed && snap.collapsed) {
    attributes.collapsed = 'true';
  } else if (snap.changed && attributes.collapsed === 'true' && !snap.collapsed) {
    delete attributes.collapsed;
  }

  return {
    uuid: snap.uuid,
    name: snap.name || previous?.name || 'Unnamed Bank',
    x: snap.x,
    y: snap.y,
    attachedToUuid,
    attachDirection,
    presetOrder,
    presets,
    selectedPreset: snap.selectedPreset || previous?.selectedPreset || '',
    bankSerializeDate: previous?.bankSerializeDate ?? '',
    lastChangedTimestamp: previous?.lastChangedTimestamp ?? 0,
    attributes,
  };
}

/**
 * Pure merge: device bank list is authoritative when `snapshot.banks` is set.
 * Banks missing from the snapshot are removed (deleted on device).
 */
export function mergeLiveSnapshot(
  previous: Bank[],
  snapshot: LiveDocumentSnapshot,
): Bank[] | null {
  if (!snapshot.banksSectionChanged || snapshot.banks == null) return null;

  const prevByUuid = new Map(previous.map((b) => [b.uuid.toLowerCase(), b]));
  return snapshot.banks.map((snap) =>
    mergeBank(snap, prevByUuid.get(snap.uuid.toLowerCase())),
  );
}

/**
 * Resolve app bank selection after a live banks-section apply.
 *
 * The C15 is single-select (`selected-bank`). This app supports multi-select for
 * marquee / multi-bank drag only. Collapsing multi-select to the device bank on
 * every layout echo (move-cluster, undock, select-bank races) broke marquee and
 * multi-drag selection stickiness.
 *
 * Rules:
 * - First library pull: device selection wins (fresh live session).
 * - App multi-select (≥2 surviving): keep app multi (filter deleted banks).
 * - Otherwise: adopt device single selection when present; else keep survivors.
 */
export function resolveLiveAppliedBankSelection(
  appSelected: readonly string[],
  deviceSelectedUuid: string,
  mergedExists: (uuid: string) => boolean,
  options: { firstLibraryPull: boolean },
): string[] {
  const device =
    deviceSelectedUuid && mergedExists(deviceSelectedUuid)
      ? deviceSelectedUuid
      : null;
  const surviving = appSelected.filter((uuid) => mergedExists(uuid));

  if (options.firstLibraryPull) {
    return device ? [device] : surviving;
  }

  if (surviving.length >= 2) {
    return surviving;
  }

  if (device) {
    return [device];
  }

  return surviving;
}

let libraryAppliedOnce = false;

/** Reset first-pull tracking (call on disconnect / new connect). */
export function resetLiveLibraryApplyState(): void {
  libraryAppliedOnce = false;
}

export function hasLiveLibraryApplied(): boolean {
  return libraryAppliedOnce;
}

/**
 * Apply a raw WS document string to the bank store when it carries bank changes.
 * Skips omit-oracles frames (oracle-only parameter scrubbing).
 */
export function applyLiveDocumentXml(xml: string): ApplyLiveResult {
  const snapshot = parseLiveDocument(xml);
  if (!snapshot) {
    return {
      applied: false,
      reason: 'not-live-document',
      bankCount: getBanksSnapshot().length,
      updateId: null,
      firstLibraryPull: false,
    };
  }

  if (snapshot.omitOracles) {
    return {
      applied: false,
      reason: 'omit-oracles',
      bankCount: getBanksSnapshot().length,
      updateId: snapshot.updateId,
      firstLibraryPull: false,
    };
  }

  if (!snapshot.presetManagerChanged) {
    return {
      applied: false,
      reason: 'preset-manager-unchanged',
      bankCount: getBanksSnapshot().length,
      updateId: snapshot.updateId,
      firstLibraryPull: false,
    };
  }

  // Selection-only update when banks section unchanged
  if (!snapshot.banksSectionChanged || snapshot.banks == null) {
    if (snapshot.selectedBankUuid || snapshot.selectedMidiBankUuid) {
      bankMeta.update((m) => ({
        ...m,
        selectedMidiBankUuid:
          snapshot.selectedMidiBankUuid || m.selectedMidiBankUuid,
      }));
    }
    return {
      applied: false,
      reason: 'banks-section-unchanged',
      bankCount: getBanksSnapshot().length,
      updateId: snapshot.updateId,
      firstLibraryPull: false,
    };
  }

  const previous = getBanksSnapshot();
  const merged = mergeLiveSnapshot(previous, snapshot);
  if (!merged) {
    return {
      applied: false,
      reason: 'merge-null',
      bankCount: previous.length,
      updateId: snapshot.updateId,
      firstLibraryPull: false,
    };
  }

  const firstLibraryPull = !libraryAppliedOnce;
  libraryAppliedOnce = true;

  banks.set(merged);
  clearUserPositioned();
  clearHistory();
  // Device is authority while live — offline dirty flag does not apply.
  clearSessionDirty();

  const exists = (uuid: string) => merged.some((b) => b.uuid === uuid);

  bankMeta.update((m) => {
    const selected = resolveLiveAppliedBankSelection(
      m.selectedBankUuids,
      snapshot.selectedBankUuid,
      exists,
      { firstLibraryPull },
    );
    const base = (m.bankSelectionBaseUuids ?? []).filter(exists);
    const anchor =
      m.bankSelectionAnchorUuid && exists(m.bankSelectionAnchorUuid)
        ? m.bankSelectionAnchorUuid
        : (selected[selected.length - 1] ?? null);

    return {
      ...m,
      selectedBankUuids: selected,
      bankSelectionBaseUuids: base,
      bankSelectionAnchorUuid: selected.length > 0 ? anchor : null,
      selectedMidiBankUuid:
        snapshot.selectedMidiBankUuid || m.selectedMidiBankUuid,
      serializeDate: m.serializeDate,
      lastImportFilename: 'C15 Live',
      lastImportMode: 'replace',
      error: null,
      loading: false,
      // Drop preset multi-select if bank list changed under us
      selectedPresetUuids: m.selectedPresetUuids.filter((pu) =>
        merged.some((b) => b.presets.some((p) => p.uuid === pu)),
      ),
      presetSelectionBankUuid:
        m.presetSelectionBankUuid &&
        merged.some((b) => b.uuid === m.presetSelectionBankUuid)
          ? m.presetSelectionBankUuid
          : null,
    };
  });

  log('C15-LIVE', 'library applied', {
    bankCount: merged.length,
    updateId: snapshot.updateId,
    firstLibraryPull,
    selected: snapshot.selectedBankUuid.slice(0, 8),
    appSelectedCount: get(bankMeta).selectedBankUuids.length,
  });

  return {
    applied: true,
    reason: 'ok',
    bankCount: merged.length,
    updateId: snapshot.updateId,
    firstLibraryPull,
  };
}

/** Focus selected (or first) bank after first pull — optional UI helper. */
export function getLiveFocusBankUuid(): string | null {
  const meta = get(bankMeta);
  if (meta.selectedBankUuids.length > 0) {
    return meta.selectedBankUuids[meta.selectedBankUuids.length - 1] ?? null;
  }
  const list = getBanksSnapshot();
  return list[0]?.uuid ?? null;
}

export function getLiveBankByUuid(uuid: string): Bank | undefined {
  return findByUuid(getBanksSnapshot(), uuid);
}
