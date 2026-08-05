/**
 * Build playground WebUI RPC frames (path + query text).
 * Matches NonMaps StaticURI / firmware NetworkRequest (isOracle is "1" | "0").
 */

import type { DockEdge } from '../model/attachOperation';

export type RpcParams = Record<string, string | number | boolean | undefined | null>;

/** Capitalize dock edge for firmware `droppedAt` (North/West/South/East). */
export function dockEdgeToDroppedAt(edge: DockEdge): 'North' | 'West' | 'South' | 'East' {
  switch (edge) {
    case 'north':
      return 'North';
    case 'west':
      return 'West';
    case 'south':
      return 'South';
    case 'east':
      return 'East';
  }
}

function encodeValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return encodeURIComponent(String(value));
}

/**
 * Build `/path?k=v&isOracle=0` style frame.
 * Path should start with `/` (e.g. `/banks/set-position`).
 */
export function buildRpc(path: string, params: RpcParams = {}, isOracle = false): string {
  const base = path.startsWith('/') ? path : `/${path}`;
  const parts: string[] = [];

  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeValue(raw)}`);
  }
  parts.push(`isOracle=${isOracle ? '1' : '0'}`);

  return `${base}?${parts.join('&')}`;
}

export function rpcPing(n: number): string {
  return `/ping/${n}`;
}

export function rpcNewBank(x: number | string, y: number | string, name: string): string {
  return buildRpc('/presets/new-bank', { x, y, name });
}

/** Single preset → new free bank (copies; C15 `create-new-bank-from-preset`). */
export function rpcCreateNewBankFromPreset(
  presetUuid: string,
  x: number | string,
  y: number | string,
): string {
  return buildRpc('/banks/create-new-bank-from-preset', {
    preset: presetUuid,
    x,
    y,
  });
}

/** Multi preset CSV → new free bank (copies; C15 `create-new-bank-from-presets`). */
export function rpcCreateNewBankFromPresets(
  presetsCsv: string,
  x: number | string,
  y: number | string,
): string {
  return buildRpc('/banks/create-new-bank-from-presets', {
    presets: presetsCsv,
    x,
    y,
  });
}

export function rpcRenameBank(uuid: string, name: string): string {
  return buildRpc('/presets/rename-bank', { uuid, name });
}

export function rpcDeleteBank(uuid: string): string {
  return buildRpc('/presets/delete-bank', { uuid });
}

export function rpcSelectBank(uuid: string): string {
  return buildRpc('/presets/select-bank', { uuid });
}

export function rpcSetPosition(
  uuid: string,
  x: number | string,
  y: number | string,
  isOracle = true,
): string {
  return buildRpc('/banks/set-position', { uuid, x, y }, isOracle);
}

/** csv triples: uuid,x,y,uuid,x,y,… */
export function rpcMoveCluster(entries: Array<{ uuid: string; x: number | string; y: number | string }>): string {
  const csv = entries.map((e) => `${e.uuid},${e.x},${e.y}`).join(',');
  return buildRpc('/presets/move-cluster', { csv });
}

export function rpcDockBanks(opts: {
  droppedOntoBank: string;
  draggedBank: string;
  droppedAt: DockEdge | 'North' | 'West' | 'South' | 'East';
  x: number | string;
  y: number | string;
}): string {
  const droppedAt =
    opts.droppedAt === 'North' ||
    opts.droppedAt === 'West' ||
    opts.droppedAt === 'South' ||
    opts.droppedAt === 'East'
      ? opts.droppedAt
      : dockEdgeToDroppedAt(opts.droppedAt);

  return buildRpc('/banks/dock-banks', {
    droppedOntoBank: opts.droppedOntoBank,
    draggedBank: opts.draggedBank,
    droppedAt,
    x: opts.x,
    y: opts.y,
  });
}

export function rpcUndockBank(uuid: string, x: number | string, y: number | string): string {
  return buildRpc('/banks/undock-bank', { uuid, x, y });
}

export function rpcLoadPreset(uuid: string): string {
  return buildRpc('/banks/load-preset', { uuid });
}

export function rpcSelectPreset(uuid: string): string {
  return buildRpc('/banks/select-preset', { uuid });
}

export function rpcRenamePreset(uuid: string, name: string): string {
  return buildRpc('/banks/rename-preset', { uuid, name });
}

export function rpcDeletePreset(uuid: string, deleteBank = false): string {
  return buildRpc('/banks/delete-preset', {
    uuid,
    'delete-bank': deleteBank ? 'true' : 'false',
  });
}

export function rpcDeletePresets(uuids: readonly string[], deleteBank = false): string {
  return buildRpc('/banks/delete-presets', {
    presets: uuids.join(','),
    'delete-bank': deleteBank ? 'true' : 'false',
  });
}

/** Firmware attribute keys: `color`, `Comment`, … */
export function rpcSetPresetAttribute(uuid: string, key: string, value: string): string {
  return buildRpc('/banks/set-preset-attribute', { uuid, key, value });
}

/** Multi-drop: same bank → move; cross-bank → copy. */
export function rpcDropPresetsAbove(presetsCsv: string, anchorUuid: string): string {
  return buildRpc('/banks/drop-presets-above', { presets: presetsCsv, anchor: anchorUuid });
}

export function rpcDropPresetsBelow(presetsCsv: string, anchorUuid: string): string {
  return buildRpc('/banks/drop-presets-below', { presets: presetsCsv, anchor: anchorUuid });
}

/** Append (copy; same-bank also deletes source = move to end). */
export function rpcDropPresetsOnBank(bankUuid: string, presetsCsv: string): string {
  return buildRpc('/banks/drop-presets-on-bank', { bank: bankUuid, presets: presetsCsv });
}

export function rpcMovePresetAbove(presetToMove: string, anchorUuid: string): string {
  return buildRpc('/banks/move-preset-above', {
    presetToMove,
    anchor: anchorUuid,
  });
}

export function rpcMovePresetBelow(presetToMove: string, anchorUuid: string): string {
  return buildRpc('/banks/move-preset-below', {
    presetToMove,
    anchor: anchorUuid,
  });
}

export function rpcCopyPresetBelow(presetToCopy: string, anchorUuid: string): string {
  return buildRpc('/banks/copy-preset-below', {
    presetToCopy,
    anchor: anchorUuid,
  });
}

export function rpcAppendPresetToBank(bankUuid: string, presetUuid: string): string {
  return buildRpc('/banks/append-preset-to-bank', {
    'bank-uuid': bankUuid,
    'preset-uuid': presetUuid,
  });
}

/** Device undo stack tip (firmware UndoActions — no params). */
export function rpcUndo(): string {
  return buildRpc('/undo/undo');
}

/**
 * Device redo. `way` selects branch among successors; `-1` = default redo route
 * (firmware NetworkRequest default).
 */
export function rpcRedo(way = -1): string {
  return buildRpc('/undo/redo', { way });
}
