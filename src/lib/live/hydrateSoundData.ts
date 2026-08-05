/**
 * Merge full preset parameter trees from a device/offline backup into a
 * session that may only hold Live WS shells (metadata, no sound data).
 */

import type { Bank, Preset } from '../types/bank';
import { bankHasFullSoundData } from './liveDeviceImport';

/** True when a preset XML block carries C15 parameter trees. */
export function presetRawHasFullSound(rawXml: string): boolean {
  return (
    rawXml.includes('<parameter') ||
    rawXml.includes('<parameter-group') ||
    rawXml.includes('<parameter-groups')
  );
}

export interface HydrateSoundResult {
  banks: Bank[];
  /** Presets whose rawXml gained parameter trees. */
  hydratedPresetCount: number;
  /** Session bank names still missing full sound after merge. */
  banksStillMissing: string[];
}

function mergePresetFromSource(session: Preset, source: Preset | undefined): {
  preset: Preset;
  hydrated: boolean;
} {
  if (!source || !presetRawHasFullSound(source.rawXml)) {
    return { preset: session, hydrated: false };
  }
  const wasThin = !presetRawHasFullSound(session.rawXml);
  return {
    preset: {
      ...session,
      name: source.name || session.name,
      type: source.type || session.type,
      comment: source.comment || session.comment,
      deviceName: source.deviceName || session.deviceName,
      color: source.color || session.color,
      storeTime: source.storeTime || session.storeTime,
      // Prefer source pos when replacing body so export pos matches device.
      pos: source.pos,
      rawXml: source.rawXml,
    },
    hydrated: wasThin,
  };
}

/**
 * Body-only merge: keep session layout/selection; replace thin preset bodies
 * from `sourceBanks` matched by bank UUID then preset UUID (case-insensitive).
 * If UUID match fails for a thin bank but the source bank is full, adopt the
 * source preset list (same bank UUID, Live remint edge cases).
 */
export function hydrateBanksWithSoundData(
  sessionBanks: readonly Bank[],
  sourceBanks: readonly Bank[],
): HydrateSoundResult {
  const sourceByUuid = new Map(
    sourceBanks.map((b) => [b.uuid.toLowerCase(), b] as const),
  );

  let hydratedPresetCount = 0;
  const banksStillMissing: string[] = [];

  const banks = sessionBanks.map((sessionBank) => {
    const source = sourceByUuid.get(sessionBank.uuid.toLowerCase());
    if (!source) {
      if (!bankHasFullSoundData(sessionBank)) {
        banksStillMissing.push(sessionBank.name || sessionBank.uuid);
      }
      return sessionBank;
    }

    if (sessionBank.presets.length === 0) {
      // Empty bank is valid full data; optionally adopt source presets if session empty and source full.
      if (source.presets.length > 0 && bankHasFullSoundData(source)) {
        hydratedPresetCount += source.presets.length;
        return {
          ...sessionBank,
          presets: source.presets.map((p) => ({ ...p })),
          presetOrder:
            source.presetOrder.length > 0
              ? [...source.presetOrder]
              : source.presets.map((p) => p.uuid),
          selectedPreset: sessionBank.selectedPreset || source.selectedPreset,
        };
      }
      return sessionBank;
    }

    const srcByUuid = new Map(
      source.presets.map((p) => [p.uuid.toLowerCase(), p] as const),
    );

    let anyHydrated = false;
    const presets = sessionBank.presets.map((p, index) => {
      const matched =
        srcByUuid.get(p.uuid.toLowerCase()) ?? source.presets[index];
      const { preset, hydrated } = mergePresetFromSource(p, matched);
      if (hydrated) {
        anyHydrated = true;
        hydratedPresetCount += 1;
      }
      return preset;
    });

    let next: Bank = { ...sessionBank, presets };

    if (!bankHasFullSoundData(next) && bankHasFullSoundData(source)) {
      // UUID/slot merge left gaps — adopt full source preset list, keep layout.
      if (!anyHydrated) {
        hydratedPresetCount += source.presets.filter((p) =>
          presetRawHasFullSound(p.rawXml),
        ).length;
      }
      next = {
        ...sessionBank,
        presets: source.presets.map((p) => ({ ...p })),
        presetOrder:
          source.presetOrder.length > 0
            ? [...source.presetOrder]
            : source.presets.map((p) => p.uuid),
        selectedPreset: sessionBank.selectedPreset || source.selectedPreset,
      };
    }

    if (!bankHasFullSoundData(next)) {
      banksStillMissing.push(sessionBank.name || sessionBank.uuid);
    }
    return next;
  });

  return { banks, hydratedPresetCount, banksStillMissing };
}

/**
 * Quick structural check that backup bytes look like a full C15 export
 * (gzip or XML containing parameter trees), not Live shells.
 */
export function backupBytesLookLikeFullSound(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 64) return false;
  // Avoid full parse for the gate: decompress is still needed for gzip.
  // Callers that already parse should use bankHasFullSoundData on the doc.
  try {
    // Lazy import avoided — callers use parse path; this is a cheap UTF-8 sniff
    // for already-decompressed tests. For gzip magic, return true only after
    // outer parse. Keep this helper for plain XML fixtures in unit tests.
    const head = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, Math.min(bytes.byteLength, 4096)),
    );
    if (head.includes('<parameter') || head.includes('<parameter-group')) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
