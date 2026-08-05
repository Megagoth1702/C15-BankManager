/**
 * Phase 3–4: push local mutations to the C15 playground while Live.
 * Device remains authority — WS document echo reconciles (Phase 2 apply).
 *
 * Call only from bankStore / selectionCommands (user-command paths), never from
 * applyLiveDocument (which writes the store directly).
 */

import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import type { DockEdge } from '../model/attachOperation';
import type { AttachDirection } from '../types/bank';
import type { Bank } from '../types/bank';
import { findByUuid } from '../uuid/uuidKey';
import {
  rpcAppendPresetToBank,
  rpcCopyPresetBelow,
  rpcCreateNewBankFromPreset,
  rpcCreateNewBankFromPresets,
  rpcDeleteBank,
  rpcDeletePreset,
  rpcDeletePresets,
  rpcDockBanks,
  rpcDropPresetsAbove,
  rpcDropPresetsBelow,
  rpcDropPresetsOnBank,
  rpcLoadPreset,
  rpcMoveCluster,
  rpcMovePresetAbove,
  rpcMovePresetBelow,
  rpcNewBank,
  rpcRenameBank,
  rpcRenamePreset,
  rpcSelectBank,
  rpcRedo,
  rpcSelectPreset,
  rpcSetPosition,
  rpcSetPresetAttribute,
  rpcUndockBank,
  rpcUndo,
} from './liveRpc';
import { getLiveImportBusy } from './liveImportJob';
import { liveMode, sendLiveRpc } from './liveMode';

/** True when we should send layout/preset RPCs (socket open + library painted). */
export function isLivePushActive(): boolean {
  const m = get(liveMode);
  if (m.connection !== 'live' || !m.libraryReady) return false;
  // Freeze layout/preset pushes while the device is busy with import.
  if (getLiveImportBusy()) return false;
  return true;
}

function send(frame: string, label: string, detail?: Record<string, unknown>): boolean {
  if (!isLivePushActive()) return false;
  const ok = sendLiveRpc(frame);
  if (ok) {
    log('C15-LIVE', `push ${label}`, detail);
  } else {
    log('C15-LIVE', `push ${label} failed (not open)`, detail, 'warn');
  }
  return ok;
}

// ─── Bank layout (Phase 3) ───────────────────────────────────────────────────

/** Single bank position (NonMaps uses isOracle for set-position). */
export function pushSetPosition(uuid: string, x: number, y: number): boolean {
  return send(rpcSetPosition(uuid, x, y, true), 'set-position', {
    uuid: uuid.slice(0, 8),
    x,
    y,
  });
}

/**
 * Move one or many banks. One bank → set-position; several → move-cluster
 * so attached siblings keep absolute coords in sync with our store.
 */
export function pushBankPositions(
  list: readonly Bank[],
  uuids: readonly string[],
): boolean {
  if (!isLivePushActive() || uuids.length === 0) return false;

  const entries: Array<{ uuid: string; x: number; y: number }> = [];
  for (const uuid of uuids) {
    const bank = findByUuid(list, uuid);
    if (!bank) continue;
    entries.push({ uuid: bank.uuid, x: bank.x, y: bank.y });
  }
  if (entries.length === 0) return false;

  if (entries.length === 1) {
    const e = entries[0]!;
    return pushSetPosition(e.uuid, e.x, e.y);
  }

  return send(rpcMoveCluster(entries), 'move-cluster', {
    count: entries.length,
    uuids: entries.map((e) => e.uuid.slice(0, 8)),
  });
}

export function pushDockBanks(opts: {
  droppedOntoBank: string;
  draggedBank: string;
  droppedAt: DockEdge;
  x: number;
  y: number;
}): boolean {
  return send(
    rpcDockBanks({
      droppedOntoBank: opts.droppedOntoBank,
      draggedBank: opts.draggedBank,
      droppedAt: opts.droppedAt,
      x: opts.x,
      y: opts.y,
    }),
    'dock-banks',
    {
      onto: opts.droppedOntoBank.slice(0, 8),
      dragged: opts.draggedBank.slice(0, 8),
      edge: opts.droppedAt,
      x: opts.x,
      y: opts.y,
    },
  );
}

/**
 * Map a resolved parent/child attach to a dock-banks RPC that creates the
 * same link on device.
 *
 * Firmware `Bank::attachBank` makes the **callee** the child. For
 * parent | child (left) that is East: dragged(child)->attach(onto=parent, left).
 * For parent above child (top) that is South: dragged(child)->attach(onto=parent, top).
 * West/North invert roles and are not used when parent/child are already known.
 */
export function dockParamsFromAttach(
  parentUuid: string,
  childUuid: string,
  attachDirection: AttachDirection,
): { droppedOntoBank: string; draggedBank: string; droppedAt: DockEdge } {
  switch (attachDirection) {
    case 'top':
    case 'bottom':
      return {
        droppedOntoBank: parentUuid,
        draggedBank: childUuid,
        droppedAt: 'south',
      };
    case 'left':
    case 'right':
      return {
        droppedOntoBank: parentUuid,
        draggedBank: childUuid,
        droppedAt: 'east',
      };
  }
}

export function pushUndockBank(uuid: string, x: number, y: number): boolean {
  return send(rpcUndockBank(uuid, x, y), 'undock-bank', {
    uuid: uuid.slice(0, 8),
    x,
    y,
  });
}

// ─── Device undo / redo (Phase 6) ────────────────────────────────────────────
// Never apply local history then push — C15 runs the transaction; WS echo mirrors.

/** Send `/undo/undo` so the playground reverts its own transaction stack. */
export function pushUndo(): boolean {
  return send(rpcUndo(), 'undo');
}

/** Send `/undo/redo` (default way) so the playground redoes. */
export function pushRedo(way = -1): boolean {
  return send(rpcRedo(way), 'redo', { way });
}

export function pushNewBank(x: number, y: number, name: string): boolean {
  return send(rpcNewBank(x, y, name), 'new-bank', { x, y, name });
}

/**
 * Drop presets on empty canvas → new free bank (C15 copy semantics).
 * Device mints bank + preset UUIDs; document echo reconciles optimistic local bank.
 */
export function pushCreateBankFromPresets(
  presetUuids: readonly string[],
  x: number,
  y: number,
): boolean {
  if (!isLivePushActive() || presetUuids.length === 0) return false;
  if (presetUuids.length === 1) {
    return send(
      rpcCreateNewBankFromPreset(presetUuids[0]!, x, y),
      'create-new-bank-from-preset',
      { uuid: presetUuids[0]!.slice(0, 8), x, y },
    );
  }
  const csv = presetUuids.join(',');
  return send(rpcCreateNewBankFromPresets(csv, x, y), 'create-new-bank-from-presets', {
    count: presetUuids.length,
    x,
    y,
  });
}

export function pushRenameBank(uuid: string, name: string): boolean {
  return send(rpcRenameBank(uuid, name), 'rename-bank', {
    uuid: uuid.slice(0, 8),
    name,
  });
}

export function pushDeleteBank(uuid: string): boolean {
  return send(rpcDeleteBank(uuid), 'delete-bank', { uuid: uuid.slice(0, 8) });
}

export function pushSelectBank(uuid: string): boolean {
  return send(rpcSelectBank(uuid), 'select-bank', { uuid: uuid.slice(0, 8) });
}

// ─── Preset ops (Phase 4) ────────────────────────────────────────────────────

export function pushSelectPreset(uuid: string): boolean {
  return send(rpcSelectPreset(uuid), 'select-preset', { uuid: uuid.slice(0, 8) });
}

/** Load preset into the device edit buffer (plays sound). */
export function pushLoadPreset(uuid: string): boolean {
  return send(rpcLoadPreset(uuid), 'load-preset', { uuid: uuid.slice(0, 8) });
}

export function pushRenamePreset(uuid: string, name: string): boolean {
  return send(rpcRenamePreset(uuid, name), 'rename-preset', {
    uuid: uuid.slice(0, 8),
    name,
  });
}

export function pushDeletePresets(uuids: readonly string[]): boolean {
  if (!isLivePushActive() || uuids.length === 0) return false;
  if (uuids.length === 1) {
    return send(rpcDeletePreset(uuids[0]!, false), 'delete-preset', {
      uuid: uuids[0]!.slice(0, 8),
    });
  }
  return send(rpcDeletePresets(uuids, false), 'delete-presets', {
    count: uuids.length,
    uuids: uuids.map((u) => u.slice(0, 8)),
  });
}

export function pushSetPresetAttribute(
  uuid: string,
  key: string,
  value: string,
): boolean {
  return send(rpcSetPresetAttribute(uuid, key, value), 'set-preset-attribute', {
    uuid: uuid.slice(0, 8),
    key,
    value: value.slice(0, 40),
  });
}

export function pushPresetColor(uuid: string, color: string): boolean {
  return pushSetPresetAttribute(uuid, 'color', color);
}

export function pushPresetComment(uuid: string, comment: string): boolean {
  return pushSetPresetAttribute(uuid, 'Comment', comment);
}

/**
 * Resolve drop-presets-* placement from an insert index into
 * `targetOrderBefore` (order without the movers for reorder; full target for copy/move).
 */
export function resolveDropAnchor(
  targetOrderBefore: readonly string[],
  insertIndex: number,
):
  | { kind: 'on-bank' }
  | { kind: 'above'; anchorUuid: string }
  | { kind: 'below'; anchorUuid: string } {
  if (targetOrderBefore.length === 0) return { kind: 'on-bank' };
  const at = Math.max(0, Math.min(insertIndex, targetOrderBefore.length));
  if (at <= 0) {
    return { kind: 'above', anchorUuid: targetOrderBefore[0]! };
  }
  return {
    kind: 'below',
    anchorUuid: targetOrderBefore[at - 1]!,
  };
}

function csvPresets(uuids: readonly string[]): string {
  return uuids.join(',');
}

/**
 * Same-bank reorder or cross-bank copy via drop-presets-* (firmware semantics:
 * same parent → move; other parent → copy with new UUIDs).
 */
export function pushDropPresetsAt(
  presetUuids: readonly string[],
  targetBankUuid: string,
  targetOrderBefore: readonly string[],
  insertIndex: number,
): boolean {
  if (!isLivePushActive() || presetUuids.length === 0) return false;
  const csv = csvPresets(presetUuids);
  const anchor = resolveDropAnchor(targetOrderBefore, insertIndex);

  if (anchor.kind === 'on-bank') {
    return send(rpcDropPresetsOnBank(targetBankUuid, csv), 'drop-presets-on-bank', {
      bank: targetBankUuid.slice(0, 8),
      count: presetUuids.length,
    });
  }
  if (anchor.kind === 'above') {
    return send(rpcDropPresetsAbove(csv, anchor.anchorUuid), 'drop-presets-above', {
      anchor: anchor.anchorUuid.slice(0, 8),
      count: presetUuids.length,
    });
  }
  return send(rpcDropPresetsBelow(csv, anchor.anchorUuid), 'drop-presets-below', {
    anchor: anchor.anchorUuid.slice(0, 8),
    count: presetUuids.length,
  });
}

/**
 * Cross-bank move: sequential move-preset-above/below (UUID preserved).
 * Empty target: drop-on-bank (copy) + delete sources (device mints new UUIDs;
 * document echo reconciles).
 */
export function pushMovePresetsTo(
  presetUuids: readonly string[],
  targetBankUuid: string,
  targetOrderBefore: readonly string[],
  insertIndex: number,
): boolean {
  if (!isLivePushActive() || presetUuids.length === 0) return false;

  const anchor = resolveDropAnchor(targetOrderBefore, insertIndex);

  if (anchor.kind === 'on-bank') {
    const csv = csvPresets(presetUuids);
    const dropped = send(
      rpcDropPresetsOnBank(targetBankUuid, csv),
      'drop-presets-on-bank (move→empty)',
      { bank: targetBankUuid.slice(0, 8), count: presetUuids.length },
    );
    // Remove originals so cross-bank drop (copy) becomes a move.
    const deleted = send(rpcDeletePresets(presetUuids, false), 'delete-presets (move source)', {
      count: presetUuids.length,
    });
    return dropped && deleted;
  }

  let placement: 'above' | 'below' = anchor.kind;
  let currentAnchor = anchor.anchorUuid;
  let any = false;

  for (const uuid of presetUuids) {
    if (placement === 'above') {
      any =
        send(rpcMovePresetAbove(uuid, currentAnchor), 'move-preset-above', {
          preset: uuid.slice(0, 8),
          anchor: currentAnchor.slice(0, 8),
        }) || any;
      // Subsequent presets go under the one we just placed.
      placement = 'below';
      currentAnchor = uuid;
    } else {
      any =
        send(rpcMovePresetBelow(uuid, currentAnchor), 'move-preset-below', {
          preset: uuid.slice(0, 8),
          anchor: currentAnchor.slice(0, 8),
        }) || any;
      currentAnchor = uuid;
    }
  }
  return any;
}

/**
 * In-bank duplicate (copy-preset-below). Reverse order so device insert-at-anchor+1
 * yields the same order as local clone-after-selection.
 */
export function pushDuplicatePresets(
  orderedSourceUuids: readonly string[],
  afterUuid: string,
): boolean {
  if (!isLivePushActive() || orderedSourceUuids.length === 0) return false;
  let any = false;
  for (let i = orderedSourceUuids.length - 1; i >= 0; i--) {
    const uuid = orderedSourceUuids[i]!;
    any =
      send(rpcCopyPresetBelow(uuid, afterUuid), 'copy-preset-below', {
        preset: uuid.slice(0, 8),
        after: afterUuid.slice(0, 8),
      }) || any;
  }
  return any;
}

/** Single-preset append to (possibly empty) bank — used as fallback. */
export function pushAppendPresetToBank(bankUuid: string, presetUuid: string): boolean {
  return send(rpcAppendPresetToBank(bankUuid, presetUuid), 'append-preset-to-bank', {
    bank: bankUuid.slice(0, 8),
    preset: presetUuid.slice(0, 8),
  });
}
