/**
 * Phase 5: push imported banks to the C15 while Live (Option B auto-send).
 *
 * - Merge / single-bank: sequential HTTP `import-bank` + re-dock via WS.
 * - Replace: clear device banks (delete-bank each) → 2s settle → HTTP
 *   `import-all-banks` (device splash + loading lock). Clearing first avoids
 *   the read/write thrash when a large library is already on the C15.
 *
 * Device remains authority; we wait for WS document snapshots before unfreezing.
 */

import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import type { AttachDirection, Bank } from '../types/bank';
import { compressString } from '../xml/gzip';
import {
  formatSerializeDate,
  serializePresetManagerXml,
  serializeSingleBankXml,
} from '../xml/serialize';
import { bankMeta, banks, getBanksSnapshot } from '../model/bankState';
import { dockParamsFromAttach } from './livePush';
import {
  beginLiveImportJob,
  endLiveImportJob,
  getLastDeviceLibrarySnapshot,
  getLiveImportBusy,
  invalidateDeviceLibrarySnapshot,
  matchNewDeviceBank,
  updateLiveImportJob,
  waitForDeviceCondition,
  type DeviceBankRef,
} from './liveImportJob';
import { importAllBanksHttp, importBankHttp } from './liveHttp';
import { liveMode, reapplyLastLiveDocument, sendLiveRpc } from './liveMode';
import { getLiveSettingsSnapshot } from './liveSettings';
import { rpcDeleteBank, rpcDockBanks, rpcSelectBank } from './liveRpc';
import { confirmAppDialog } from '../ui/appDialog';

const PER_BANK_SYNC_MS = 90_000;
const FULL_REPLACE_SYNC_MS = 180_000;
const REDOCK_SETTLE_MS = 2_500;
/** Wait for device library to report empty after bulk delete. */
const PRE_REPLACE_CLEAR_SYNC_MS = 120_000;
/**
 * Extra pause after the device is empty before import-all-banks.
 * Gives playground time to settle so the backup upload does not race residual
 * bank-section churn (the forever read/write loop on large libraries).
 */
const PRE_REPLACE_POST_CLEAR_PAUSE_MS = 2_000;

export interface LiveDeviceImportResult {
  ok: boolean;
  mode: 'merge' | 'replace';
  sent: number;
  failed: number;
  errors: string[];
  /** localUuid → deviceUuid after import-bank remint */
  uuidMap: Map<string, string>;
}

/** True when presets look like offline/full exports (have parameter trees). */
export function bankHasFullSoundData(bank: Bank): boolean {
  if (bank.presets.length === 0) return true;
  return bank.presets.every(
    (p) =>
      p.rawXml.includes('<parameter') ||
      p.rawXml.includes('<parameter-group') ||
      p.rawXml.includes('<parameter-groups'),
  );
}

export function banksMissingFullSoundData(banks: readonly Bank[]): Bank[] {
  return banks.filter((b) => !bankHasFullSoundData(b));
}

export function isLiveReadyForImport(): boolean {
  const m = get(liveMode);
  return m.connection === 'live' && m.libraryReady;
}

/** Parents before children (only edges inside the set). */
export function orderBanksForDeviceImport(banks: readonly Bank[]): Bank[] {
  const byUuid = new Map(banks.map((b) => [b.uuid.toLowerCase(), b]));
  const inSet = new Set(banks.map((b) => b.uuid.toLowerCase()));
  const visited = new Set<string>();
  const result: Bank[] = [];

  function visit(b: Bank): void {
    const key = b.uuid.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    if (b.attachedToUuid && inSet.has(b.attachedToUuid.toLowerCase())) {
      const parent = byUuid.get(b.attachedToUuid.toLowerCase());
      if (parent) visit(parent);
    }
    result.push(b);
  }

  // Stable: original order for roots, depth for children.
  for (const b of banks) visit(b);
  return result;
}

function deviceUuidSet(snapBanks: readonly DeviceBankRef[]): Set<string> {
  return new Set(snapBanks.map((b) => b.uuid.toLowerCase()));
}

/** Case-insensitive lookup on local→device uuid map. */
export function lookupUuidMap(
  uuidMap: ReadonlyMap<string, string>,
  localUuid: string,
): string | null {
  const direct = uuidMap.get(localUuid);
  if (direct) return direct;
  const key = localUuid.toLowerCase();
  for (const [k, v] of uuidMap) {
    if (k.toLowerCase() === key) return v;
  }
  return null;
}

/**
 * After sequential `import-bank` (firmware ignoreUUIDs=true), rewrite local bank
 * UUIDs (and attachment targets) to the device-minted ids so the deferred live
 * document reapply can keep full local preset content on shell banks.
 *
 * Without this, reapply matches by UUID only: device shells have no previous
 * body → empty banks (header only) until a later changed document arrives.
 */
export function rewriteBanksToDeviceUuids(
  banks: readonly Bank[],
  uuidMap: ReadonlyMap<string, string>,
): Bank[] {
  if (uuidMap.size === 0) return banks.map((b) => b);

  const lower = new Map<string, string>();
  for (const [local, device] of uuidMap) {
    lower.set(local.toLowerCase(), device);
  }

  return banks.map((bank) => {
    const nextUuid = lower.get(bank.uuid.toLowerCase()) ?? bank.uuid;
    let nextParent = bank.attachedToUuid;
    if (nextParent) {
      nextParent = lower.get(nextParent.toLowerCase()) ?? nextParent;
    }
    if (nextUuid === bank.uuid && nextParent === bank.attachedToUuid) {
      return bank;
    }
    return {
      ...bank,
      uuid: nextUuid,
      attachedToUuid: nextParent,
    };
  });
}

/**
 * Apply {@link rewriteBanksToDeviceUuids} to the session store and remap
 * selection / focus ids that still point at pre-import local UUIDs.
 */
export function applyImportUuidMapToSession(
  uuidMap: ReadonlyMap<string, string>,
): number {
  if (uuidMap.size === 0) return 0;

  const before = getBanksSnapshot();
  const rewritten = rewriteBanksToDeviceUuids(before, uuidMap);
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (
      before[i]!.uuid !== rewritten[i]!.uuid ||
      before[i]!.attachedToUuid !== rewritten[i]!.attachedToUuid
    ) {
      changed++;
    }
  }
  if (changed === 0) return 0;

  banks.set(rewritten);

  const mapUuid = <T extends string | null>(uuid: T): T => {
    if (uuid == null || uuid === '') return uuid;
    return (lookupUuidMap(uuidMap, uuid) ?? uuid) as T;
  };

  bankMeta.update((m) => {
    const selectedBankUuids = m.selectedBankUuids.map((u) => mapUuid(u));
    const renamingPreset = m.renamingPreset
      ? {
          bankUuid: mapUuid(m.renamingPreset.bankUuid),
          presetUuid: m.renamingPreset.presetUuid,
        }
      : null;
    return {
      ...m,
      selectedBankUuids,
      selectedMidiBankUuid: mapUuid(m.selectedMidiBankUuid),
      renamingBankUuid: mapUuid(m.renamingBankUuid),
      focusBankUuid: mapUuid(m.focusBankUuid),
      revealSidebarBankUuid: mapUuid(m.revealSidebarBankUuid),
      renamingPreset,
      presetSelectionBankUuid: mapUuid(m.presetSelectionBankUuid),
    };
  });

  log('C15-LIVE', 'rewrote local bank UUIDs to device ids before reapply', {
    mapped: uuidMap.size,
    banksTouched: changed,
  });
  return changed;
}

/**
 * Strip attachment when the parent is neither in this send batch nor already
 * present on the device. Single-bank imports of an attached Uli XML (etc.)
 * otherwise serialize a dangling parent and re-dock fails with a hard error.
 */
export function prepareBanksForDeviceImport(
  banks: readonly Bank[],
  deviceBankUuids: ReadonlySet<string> = new Set(),
): Bank[] {
  const batchKeys = new Set(banks.map((b) => b.uuid.toLowerCase()));
  const deviceKeys = new Set(
    [...deviceBankUuids].map((u) => u.toLowerCase()),
  );

  return banks.map((bank) => {
    const parent = bank.attachedToUuid;
    if (!parent) return bank;
    if (!bank.attachDirection) {
      return { ...bank, attachedToUuid: null, attachDirection: null };
    }
    const parentKey = parent.toLowerCase();
    if (batchKeys.has(parentKey) || deviceKeys.has(parentKey)) {
      return bank;
    }
    return { ...bank, attachedToUuid: null, attachDirection: null };
  });
}

export interface RedockPlanEdge {
  child: Bank;
  parentLocalUuid: string;
  parentDeviceUuid: string;
  childDeviceUuid: string;
  attachDirection: AttachDirection;
}

export interface RedockPlan {
  /** Edges we can dock on the device. */
  dockable: RedockPlanEdge[];
  /**
   * Soft skips: parent was never part of this import and is not on the device.
   * Bank stays free on C15 — not an import failure.
   */
  skippedOrphan: string[];
  /** Hard failures: parent was in the send batch but never got a device mapping. */
  missingMapping: string[];
}

/**
 * Decide which attachment edges can be restored after sequential import-bank.
 * Orphan parents (single-bank / partial batch) are skipped, not failed.
 */
export function planImportRedock(
  original: readonly Bank[],
  uuidMap: ReadonlyMap<string, string>,
  deviceBankUuids: ReadonlySet<string> = new Set(),
): RedockPlan {
  const sentLocal = new Set(original.map((b) => b.uuid.toLowerCase()));
  const deviceKeys = new Set(
    [...deviceBankUuids].map((u) => u.toLowerCase()),
  );

  const dockable: RedockPlanEdge[] = [];
  const skippedOrphan: string[] = [];
  const missingMapping: string[] = [];

  for (const child of original) {
    if (!child.attachedToUuid || !child.attachDirection) continue;

    const childDevice = lookupUuidMap(uuidMap, child.uuid);
    if (!childDevice) continue; // bank itself never landed — send loop already reported

    const parentLocal = child.attachedToUuid;
    const parentKey = parentLocal.toLowerCase();
    const parentInBatch = sentLocal.has(parentKey);
    const parentDevice =
      lookupUuidMap(uuidMap, parentLocal) ??
      (deviceKeys.has(parentKey) ? parentLocal : null);

    if (parentDevice) {
      dockable.push({
        child,
        parentLocalUuid: parentLocal,
        parentDeviceUuid: parentDevice,
        childDeviceUuid: childDevice,
        attachDirection: child.attachDirection,
      });
      continue;
    }

    if (parentInBatch) {
      missingMapping.push(
        `Could not re-dock "${child.name}" — parent was sent but has no device UUID mapping`,
      );
    } else {
      // Single-bank (or partial) import: parent not imported and not already on C15.
      skippedOrphan.push(child.name);
    }
  }

  return { dockable, skippedOrphan, missingMapping };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * After sequential import-bank, restore attachments with dock-banks RPCs.
 * Uses direct sendLiveRpc (layout push is gated while the import job is active).
 *
 * Orphan attachments (parent not in this batch / not on device) are skipped —
 * the bank remains free on C15. That is expected for single-bank XML that still
 * carries a historical attached-to-bank uuid.
 */
async function redockImportedBanks(
  original: readonly Bank[],
  uuidMap: Map<string, string>,
): Promise<string[]> {
  const deviceUuids = deviceUuidSet(
    getLastDeviceLibrarySnapshot()?.banks ?? [],
  );
  // Just-imported parents are known via uuidMap values.
  for (const deviceUuid of uuidMap.values()) {
    deviceUuids.add(deviceUuid.toLowerCase());
  }

  const plan = planImportRedock(original, uuidMap, deviceUuids);

  if (plan.skippedOrphan.length > 0) {
    log(
      'C15-LIVE',
      'import re-dock skipped (orphan parent)',
      { banks: plan.skippedOrphan },
      'info',
    );
  }

  const errors = [...plan.missingMapping];
  if (plan.dockable.length === 0) return errors;

  updateLiveImportJob({
    phase: 'redocking',
    label: 'Restoring bank attachments on C15…',
    detail: `${plan.dockable.length} link${plan.dockable.length === 1 ? '' : 's'}`,
    current: 0,
    total: plan.dockable.length,
  });

  // Parent-first: order by attachment depth within the dockable children.
  const orderedChildren = orderBanksForDeviceImport(
    plan.dockable.map((e) => e.child),
  );
  const edgeByChild = new Map(
    plan.dockable.map((e) => [e.child.uuid.toLowerCase(), e]),
  );

  let i = 0;
  for (const child of orderedChildren) {
    const edge = edgeByChild.get(child.uuid.toLowerCase());
    if (!edge) continue;
    i++;

    const params = dockParamsFromAttach(
      edge.parentDeviceUuid,
      edge.childDeviceUuid,
      edge.attachDirection,
    );
    const childBank = original.find(
      (b) => b.uuid.toLowerCase() === child.uuid.toLowerCase(),
    );
    const frame = rpcDockBanks({
      droppedOntoBank: params.droppedOntoBank,
      draggedBank: params.draggedBank,
      droppedAt: params.droppedAt,
      x: childBank?.x ?? 0,
      y: childBank?.y ?? 0,
    });

    updateLiveImportJob({
      current: i,
      detail: `${child.name} → parent`,
    });

    const ok = sendLiveRpc(frame);
    if (!ok) {
      errors.push(`dock-banks failed to send for "${child.name}"`);
    } else {
      log('C15-LIVE', 'import re-dock', {
        child: child.name,
        edge: params.droppedAt,
      });
    }
    // Small gap so playground can process before the next dock.
    await sleep(80);
  }

  updateLiveImportJob({
    phase: 'waiting-sync',
    label: 'Waiting for C15 to confirm attachments…',
    detail: null,
  });
  // Give playground time to process docks + push a document; don't fail hard.
  await sleep(REDOCK_SETTLE_MS);
  await waitForDeviceCondition(
    (snap) => snap.at > Date.now() - REDOCK_SETTLE_MS - 500,
    { timeoutMs: 8_000 },
  );

  return errors;
}

/**
 * Sequential import-bank for merge / single-file paths.
 * Holds bank XML from the pre-send snapshot (device echo will rewrite the store).
 * Waits for a **post-send** device document before the next bank — never piles
 * uploads onto a still-busy playground.
 */
export async function pushBanksToDeviceSequential(
  banksToSend: readonly Bank[],
): Promise<LiveDeviceImportResult> {
  const uuidMap = new Map<string, string>();
  const errors: string[] = [];

  if (!isLiveReadyForImport()) {
    return {
      ok: false,
      mode: 'merge',
      sent: 0,
      failed: banksToSend.length,
      errors: ['Not live — cannot send banks to C15'],
      uuidMap,
    };
  }

  if (banksToSend.length === 0) {
    return { ok: true, mode: 'merge', sent: 0, failed: 0, errors: [], uuidMap };
  }

  // Drop dangling attach-to when parent is not in this batch and not on the device
  // (common for single-bank XML that still carries historical attachment metadata).
  const deviceIds = deviceUuidSet(getLastDeviceLibrarySnapshot()?.banks ?? []);
  const prepared = prepareBanksForDeviceImport(banksToSend, deviceIds);
  const ordered = orderBanksForDeviceImport(prepared);
  const settings = getLiveSettingsSnapshot();
  const serializeDate = formatSerializeDate();

  ensureLiveImportJob({
    phase: 'sending',
    label: 'Sending banks to C15…',
    detail: 'Waiting for the synth after each bank before sending the next',
    total: ordered.length,
  });

  let sent = 0;

  try {
    for (let i = 0; i < ordered.length; i++) {
      const bank = ordered[i]!;
      // Device identity only — never use the local canvas (local import already
      // placed optimistic banks that are not on the C15 yet).
      const before =
        getLastDeviceLibrarySnapshot()?.banks.map((b) => b.uuid.toLowerCase()) ??
        [];
      const beforeSet = new Set(before);
      const baselineUpdateId = getLastDeviceLibrarySnapshot()?.updateId ?? null;

      updateLiveImportJob({
        phase: 'sending',
        label: `Sending bank ${i + 1} of ${ordered.length} to C15…`,
        detail: bank.name,
        current: i + 1,
        total: ordered.length,
      });

      let xml: string;
      try {
        xml = serializeSingleBankXml(bank, {
          serializeDate,
          attributeOverrides: {
            'Date of Export File': serializeDate,
            'Name of Export File': `${bank.name}.xml`,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${bank.name}: serialize failed — ${msg}`);
        continue;
      }

      const sentAt = Date.now();
      try {
        await importBankHttp(settings, {
          xml,
          x: Math.round(bank.x),
          y: Math.round(bank.y),
          fileName: `${bank.name}.xml`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${bank.name}: ${msg}`);
        log('C15-LIVE', 'import-bank HTTP failed', { name: bank.name, msg }, 'error');
        continue;
      }

      updateLiveImportJob({
        phase: 'waiting-sync',
        label: `Waiting for C15 to finish “${bank.name}”…`,
        detail: 'Device is creating the bank — next bank waits until this is confirmed',
        current: i + 1,
      });

      const synced = await waitForDeviceCondition(
        (snap) =>
          matchNewDeviceBank(beforeSet, snap, {
            name: bank.name,
            x: bank.x,
            y: bank.y,
          }) != null,
        {
          timeoutMs: PER_BANK_SYNC_MS,
          // Require a document produced after this HTTP send (not a poisoned pre-send snap).
          // checkLastSnapshot stays true so docs that landed during the HTTP await still count.
          notBeforeMs: sentAt,
          minUpdateId: baselineUpdateId,
        },
      );

      const snap = getLastDeviceLibrarySnapshot();
      const matched = snap
        ? matchNewDeviceBank(beforeSet, snap, {
            name: bank.name,
            x: bank.x,
            y: bank.y,
          })
        : null;

      if (matched) {
        uuidMap.set(bank.uuid, matched.uuid);
        sent++;
        log('C15-LIVE', 'import-bank synced', {
          local: bank.uuid.slice(0, 8),
          device: matched.uuid.slice(0, 8),
          name: bank.name,
        });
      } else if (synced) {
        // Predicate true but rematch failed — still count as sent.
        sent++;
      } else {
        errors.push(
          `${bank.name}: sent to C15 but device did not confirm in time`,
        );
        // Best-effort: if exactly one new uuid appeared after send, map it.
        if (snap && snap.at >= sentAt) {
          const newcomers = snap.banks.filter(
            (b) => !beforeSet.has(b.uuid.toLowerCase()),
          );
          if (newcomers.length === 1) {
            uuidMap.set(bank.uuid, newcomers[0]!.uuid);
            sent++;
            errors.pop();
          }
        }
      }
    }

    const dockErrors = await redockImportedBanks(ordered, uuidMap);
    errors.push(...dockErrors);

    const failed = ordered.length - sent;
    const ok = errors.length === 0 && failed === 0;
    finishLiveImportJob({
      error: ok
        ? null
        : errors.slice(0, 3).join('; ') + (errors.length > 3 ? '…' : ''),
      label: ok
        ? `Sent ${sent} bank${sent === 1 ? '' : 's'} to C15`
        : undefined,
      // Always reapply after a device send attempt so reminted UUIDs land.
      // uuidMap lets reapply keep full local content under device-minted ids.
      reapplyDeviceDocument: true,
      uuidMap,
    });

    return {
      ok,
      mode: 'merge',
      sent,
      failed: Math.max(0, failed),
      errors,
      uuidMap,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishLiveImportJob({
      error: msg,
      reapplyDeviceDocument: true,
      uuidMap,
    });
    return {
      ok: false,
      mode: 'merge',
      sent,
      failed: ordered.length - sent,
      errors: [...errors, msg],
      uuidMap,
    };
  }
}

/** Begin job if none active; otherwise update the existing preparing job. */
function ensureLiveImportJob(opts: {
  phase?: Parameters<typeof beginLiveImportJob>[0]['phase'];
  label: string;
  detail?: string | null;
  total?: number;
}): void {
  if (getLiveImportBusy()) {
    updateLiveImportJob({
      phase: opts.phase ?? 'preparing',
      label: opts.label,
      detail: opts.detail ?? null,
      total: opts.total,
      current: 0,
    });
    return;
  }
  beginLiveImportJob(opts);
}

/**
 * End job. Optionally re-apply the last device document (use after a device
 * mutation so the canvas catches up). Do **not** reapply when the user cancelled
 * a Live replace before any local mutation (canvas still matches device).
 *
 * When `uuidMap` is provided (merge / import-bank remints), rewrite local bank
 * UUIDs onto device ids **before** reapply so shell banks keep full preset bodies.
 */
function finishLiveImportJob(opts?: {
  error?: string | null;
  label?: string;
  /** Re-apply deferred WS document after unfreeze (default false). */
  reapplyDeviceDocument?: boolean;
  /**
   * localUuid → deviceUuid from sequential import-bank. Applied to the session
   * before reapply so content is not dropped on UUID remint.
   */
  uuidMap?: ReadonlyMap<string, string>;
}): void {
  endLiveImportJob(opts);
  if (!opts?.reapplyDeviceDocument) return;
  // Store applies were deferred while the job was active.
  queueMicrotask(() => {
    try {
      if (opts.uuidMap && opts.uuidMap.size > 0) {
        applyImportUuidMapToSession(opts.uuidMap);
      }
      reapplyLastLiveDocument();
    } catch (err) {
      log('C15-LIVE', 'reapply after import failed', String(err), 'warn');
    }
  });
}

/**
 * Delete every bank currently on the C15 (from the device snapshot).
 *
 * Mirrors multi-select + delete in the app: fire `/presets/delete-bank` for each
 * UUID. Uses {@link sendLiveRpc} directly because layout push is frozen while
 * the import job is active. Waits until the device reports an empty library,
 * then pauses {@link PRE_REPLACE_POST_CLEAR_PAUSE_MS} before the caller uploads.
 *
 * @returns null on success, or an error message.
 */
export async function clearDeviceLibraryBeforeReplace(): Promise<string | null> {
  const snap = getLastDeviceLibrarySnapshot();
  const deviceBanks = snap?.banks ?? [];
  if (deviceBanks.length === 0) {
    log('C15-LIVE', 'pre-replace clear skipped — device library already empty');
    return null;
  }

  const uuids = deviceBanks.map((b) => b.uuid);
  const baselineUpdateId = snap?.updateId ?? null;

  updateLiveImportJob({
    phase: 'replacing',
    label: 'Deleting all banks on C15…',
    detail: `${uuids.length} bank${uuids.length === 1 ? '' : 's'} (same as select-all + delete)`,
    current: 0,
    total: uuids.length,
  });

  log('C15-LIVE', 'pre-replace clear: deleting device banks', {
    count: uuids.length,
  });

  // Timestamp before any delete so docs that land mid-loop still satisfy wait.
  const clearStartedAt = Date.now();

  // Device is single-select; select the first bank so HWUI/selection state is
  // coherent, then delete every bank UUID (app multi-delete does the same).
  const first = uuids[0]!;
  if (!sendLiveRpc(rpcSelectBank(first))) {
    return 'Could not select banks on C15 before delete (WebSocket not open)';
  }

  let sent = 0;
  for (const uuid of uuids) {
    const ok = sendLiveRpc(rpcDeleteBank(uuid));
    if (!ok) {
      return `Failed to send delete-bank for ${uuid.slice(0, 8)}… (WebSocket not open)`;
    }
    sent++;
    updateLiveImportJob({
      current: sent,
      detail: `Deleted ${sent} of ${uuids.length}…`,
    });
  }

  updateLiveImportJob({
    phase: 'waiting-sync',
    label: 'Waiting for C15 to finish deleting banks…',
    detail: 'Device must be empty before the backup upload',
    current: uuids.length,
    total: uuids.length,
  });

  const emptied = await waitForDeviceCondition(
    (s) => s.banks.length === 0,
    {
      timeoutMs: PRE_REPLACE_CLEAR_SYNC_MS,
      notBeforeMs: clearStartedAt,
      minUpdateId: baselineUpdateId,
    },
  );

  if (!emptied) {
    const remaining = getLastDeviceLibrarySnapshot()?.banks.length ?? -1;
    return (
      `C15 did not finish clearing banks before replace ` +
      `(still ${remaining} bank${remaining === 1 ? '' : 's'} on device) — try again or reconnect Live`
    );
  }

  updateLiveImportJob({
    phase: 'replacing',
    label: 'C15 library empty — pausing before upload…',
    detail: `${PRE_REPLACE_POST_CLEAR_PAUSE_MS / 1000}s settle so the synth is idle`,
  });
  log('C15-LIVE', 'pre-replace clear: device empty, pausing before upload', {
    pauseMs: PRE_REPLACE_POST_CLEAR_PAUSE_MS,
  });
  await sleep(PRE_REPLACE_POST_CLEAR_PAUSE_MS);
  return null;
}

/**
 * Full library replace via import-all-banks (HWUI splash on device).
 * Clears the existing device library first (delete every bank, wait empty, 2s
 * settle), then uploads. Uses the provided session banks (already locally
 * replaced) — never a mid-race canvas read that may have been partially
 * overwritten by a live document.
 */
export async function replaceDeviceLibraryFromSession(
  sessionBanks?: readonly Bank[],
): Promise<LiveDeviceImportResult> {
  const uuidMap = new Map<string, string>();
  const list = sessionBanks ? [...sessionBanks] : getBanksSnapshot();

  if (!isLiveReadyForImport()) {
    return {
      ok: false,
      mode: 'replace',
      sent: 0,
      failed: list.length,
      errors: ['Not live — cannot replace C15 library'],
      uuidMap,
    };
  }

  if (list.length === 0) {
    return {
      ok: false,
      mode: 'replace',
      sent: 0,
      failed: 0,
      errors: ['No banks to send'],
      uuidMap,
    };
  }

  ensureLiveImportJob({
    phase: 'replacing',
    label: 'Replacing C15 library…',
    detail: 'Synth is busy — do not power off or disconnect',
    total: list.length,
  });

  const settings = getLiveSettingsSnapshot();
  const expectedUuids = new Set(list.map((b) => b.uuid.toLowerCase()));
  const expectedCount = list.length;

  try {
    // 1) Nuke existing C15 banks so import-all-banks does not thrash against
    // a large library (read/write loop). Must finish before the gzip upload.
    const clearError = await clearDeviceLibraryBeforeReplace();
    if (clearError) {
      throw new Error(clearError);
    }

    // Snapshot after clear (empty) for post-upload minUpdateId gating.
    const baselineUpdateId = getLastDeviceLibrarySnapshot()?.updateId ?? null;

    updateLiveImportJob({
      phase: 'sending',
      label: 'Uploading full backup to C15…',
      detail: `${expectedCount} bank${expectedCount === 1 ? '' : 's'}`,
      current: 0,
      total: expectedCount,
    });

    const xml = serializePresetManagerXml({
      banks: list,
      serializeDate: formatSerializeDate(),
      selectedBankUuid: list[0]?.uuid,
    });
    const bytes = compressString(xml);
    // Copy to ArrayBuffer for fetch body typing.
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    // Drop any pre-upload snapshot so wait cannot succeed on the old library
    // (count-only match used to unfreeze while the device was still writing).
    invalidateDeviceLibrarySnapshot('before import-all-banks');
    const sentAt = Date.now();

    const responseText = await importAllBanksHttp(settings, ab);
    if (responseText.trim()) {
      // Firmware returns human error (busy / invalid / version).
      throw new Error(responseText.trim());
    }

    updateLiveImportJob({
      phase: 'waiting-sync',
      label: 'Waiting for C15 to finish loading banks…',
      detail: 'Device splash / loading lock — this can take a while',
      current: expectedCount,
      total: expectedCount,
    });

    // Strict: full UUID set from a document produced after the upload started.
    // Never accept "same bank count" alone — that matched the pre-replace library.
    const synced = await waitForDeviceCondition(
      (snap) => {
        if (snap.banks.length < expectedCount) return false;
        const have = deviceUuidSet(snap.banks);
        let matched = 0;
        for (const u of expectedUuids) {
          if (have.has(u)) matched++;
        }
        return matched === expectedUuids.size;
      },
      {
        timeoutMs: FULL_REPLACE_SYNC_MS,
        // Docs that arrive during the HTTP await are eligible (notBeforeMs filter).
        notBeforeMs: sentAt,
        minUpdateId: baselineUpdateId,
      },
    );

    if (!synced) {
      throw new Error(
        'C15 did not confirm the full library in time — check NonMaps / reconnect Live',
      );
    }

    const snap = getLastDeviceLibrarySnapshot();
    if (snap) {
      for (const b of list) {
        if (snap.banks.some((d) => d.uuid.toLowerCase() === b.uuid.toLowerCase())) {
          uuidMap.set(b.uuid, b.uuid);
        }
      }
    }

    finishLiveImportJob({
      label: `C15 library replaced (${expectedCount} banks)`,
      reapplyDeviceDocument: true,
    });

    return {
      ok: true,
      mode: 'replace',
      sent: expectedCount,
      failed: 0,
      errors: [],
      uuidMap,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Reapply even on failure: HTTP may have partially run or device state moved.
    finishLiveImportJob({ error: msg, reapplyDeviceDocument: true });
    return {
      ok: false,
      mode: 'replace',
      sent: 0,
      failed: list.length,
      errors: [msg],
      uuidMap,
    };
  }
}

/**
 * Confirm a Live full-library replace **before** any local canvas mutation.
 * Cancel means abort the whole import (app + C15 unchanged).
 *
 * Call while a preparing job is active so layout/select cannot push mid-dialog.
 */
export async function confirmLiveLibraryReplace(opts?: {
  /** Optional bank count for the dialog (files × banks once known). */
  bankCount?: number;
}): Promise<boolean> {
  if (!isLiveReadyForImport()) return false;

  ensureLiveImportJob({
    phase: 'preparing',
    label: 'Confirm C15 library replace…',
    detail: 'Device updates are paused until you choose',
    total: opts?.bankCount,
  });

  const n = opts?.bankCount;
  const countPhrase =
    n != null && n > 0
      ? `these ${n} bank${n === 1 ? '' : 's'}`
      : 'the imported banks';

  const proceed = await confirmAppDialog({
    title: 'Replace C15 library',
    message:
      `Live is on: replace the entire C15 library (and this app) with ${countPhrase}?\n\n` +
      `Existing banks on the C15 are deleted first (select-all + delete), then after a short pause the full backup is uploaded. The synth UI will freeze (splash) while banks are created. Do not power off.\n\n` +
      `Cancel aborts the import entirely — nothing changes in the app or on the C15.`,
    confirmLabel: 'Replace on C15',
    cancelLabel: 'Cancel',
    danger: true,
  });

  if (!proceed) {
    log('C15-LIVE', 'user declined Live library replace — aborting entire import');
  }
  return proceed;
}

/**
 * Option B entry: after a successful local import while Live, push to device.
 * @param importedBanks banks that were just added (merge) or the full new set (replace)
 * @param canvasMode local import mode
 *
 * Callers should already have started a preparing job (freeze) before local
 * canvas mutation when Live is on; this continues that job.
 *
 * For **replace**, the Live confirm must already have been accepted
 * (`confirmLiveLibraryReplace`) before the local canvas was mutated — this
 * path only sends to the device.
 */
export async function autoSendImportToDevice(
  importedBanks: readonly Bank[],
  canvasMode: 'merge' | 'replace',
): Promise<LiveDeviceImportResult | null> {
  if (!isLiveReadyForImport()) {
    if (getLiveImportBusy()) finishLiveImportJob();
    return null;
  }
  if (importedBanks.length === 0) {
    if (getLiveImportBusy()) finishLiveImportJob();
    return null;
  }

  const thin = banksMissingFullSoundData(importedBanks);
  if (thin.length > 0) {
    log(
      'C15-LIVE',
      'import push skipped — banks lack full sound data (live shells?)',
      { names: thin.map((b) => b.name) },
      'warn',
    );
    // File imports always have parameters; skip only if truly thin.
    const allThin = thin.length === importedBanks.length;
    if (allThin) {
      if (getLiveImportBusy()) {
        finishLiveImportJob({
          error:
            'Banks have no full preset parameter data — export from offline files, or Download from C15 first',
        });
      }
      return {
        ok: false,
        mode: canvasMode,
        sent: 0,
        failed: importedBanks.length,
        errors: [
          'Banks have no full preset parameter data — export from offline files, or Download from C15 first',
        ],
        uuidMap: new Map(),
      };
    }
  }

  if (canvasMode === 'replace') {
    // Confirm already happened before local mutation (confirmLiveLibraryReplace).
    return replaceDeviceLibraryFromSession(importedBanks);
  }

  return pushBanksToDeviceSequential(importedBanks);
}

/**
 * Freeze Live push + document apply before a local import mutates the canvas.
 * Prevents select/layout RPCs and canvas-as-device snapshot poisoning while
 * the user is still in the mass-import / confirm path.
 */
export function beginLiveImportPrepare(label = 'Preparing Live import…'): void {
  if (!isLiveReadyForImport()) return;
  ensureLiveImportJob({
    phase: 'preparing',
    label,
    detail: 'Pausing device sync until the import is ready to send',
  });
}

/** Cancel a preparing freeze when local import fails or sends nothing. */
export function cancelLiveImportPrepare(): void {
  if (getLiveImportBusy()) {
    finishLiveImportJob();
  }
}
