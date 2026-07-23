import { slaveSlotForAttach } from './attachSemantics';
import {
  bankPlacementRectAt,
  layoutSlavesChromeHorizontalStep,
  layoutSlavesVerticalStep,
} from './geometry';
import {
  buildBankMap,
  collectClusterDescendantUuids,
  type Position2D,
} from '../model/positioning';
import type { AttachDirection, Bank } from '../types/bank';

export type DisplayPositionMap = Map<string, Position2D>;

function attachmentDepth(bank: Bank, byUuid: Map<string, Bank>): number {
  let depth = 0;
  let current: Bank | undefined = bank;
  while (current?.attachedToUuid) {
    const parent = byUuid.get(current.attachedToUuid);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return depth;
}

/**
 * On-screen child origin from parent display position.
 * Horizontal: flush chrome gap (`effectiveFacingWidth + 30/45`) — matches stored XML.
 */
export function computeDisplayPositionFromParent(
  parent: Bank,
  parentDisplay: Position2D,
  attachDirection: AttachDirection,
): Position2D {
  const slot = slaveSlotForAttach(attachDirection);

  if (slot === 'right') {
    return {
      x: parentDisplay.x + layoutSlavesChromeHorizontalStep(parent),
      y: parentDisplay.y,
    };
  }

  return {
    x: parentDisplay.x,
    y: parentDisplay.y + layoutSlavesVerticalStep(parent),
  };
}

/**
 * Shift display positions while dragging — dragged bank + attachment descendants.
 */
function applyStoredDragOverrides(
  bankList: Bank[],
  display: DisplayPositionMap,
  storedOverrides: ReadonlyMap<string, Position2D>,
  byUuid: Map<string, Bank>,
): void {
  for (const [uuid, storedDrag] of storedOverrides) {
    const bank = byUuid.get(uuid);
    if (!bank) continue;

    const dx = storedDrag.x - bank.x;
    const dy = storedDrag.y - bank.y;
    if (dx === 0 && dy === 0) continue;

    const cluster = new Set([
      uuid,
      ...collectClusterDescendantUuids(uuid, bankList),
    ]);

    for (const clusterUuid of cluster) {
      const pos = display.get(clusterUuid);
      if (!pos) continue;
      display.set(clusterUuid, { x: pos.x + dx, y: pos.y + dy });
    }
  }
}

/**
 * Resolve C15 on-screen positions for every bank.
 * Roots use stored `<x>` / `<y>`; attached children use flush-chrome placement gap.
 * Stored `bank.x` / `bank.y` in the store remain device XML (wider persisted step).
 *
 * Optional `storedOverrides` (live drag) shift the dragged bank + attachment subtree.
 */
export function resolveDisplayPositions(
  bankList: Bank[],
  storedOverrides?: ReadonlyMap<string, Position2D>,
): DisplayPositionMap {
  const byUuid = buildBankMap(bankList);
  const result: DisplayPositionMap = new Map();

  for (const bank of bankList) {
    if (!bank.attachedToUuid || !byUuid.has(bank.attachedToUuid)) {
      result.set(bank.uuid, { x: bank.x, y: bank.y });
    }
  }

  const attached = bankList.filter((b) => b.attachedToUuid && b.attachDirection);
  attached.sort(
    (a, b) => attachmentDepth(a, byUuid) - attachmentDepth(b, byUuid),
  );

  for (const child of attached) {
    const parent = byUuid.get(child.attachedToUuid!);
    if (!parent || !child.attachDirection) {
      result.set(child.uuid, { x: child.x, y: child.y });
      continue;
    }

    const parentDisplay = result.get(parent.uuid);
    if (!parentDisplay) {
      result.set(child.uuid, { x: child.x, y: child.y });
      continue;
    }

    result.set(
      child.uuid,
      computeDisplayPositionFromParent(
        parent,
        parentDisplay,
        child.attachDirection,
      ),
    );
  }

  for (const bank of bankList) {
    if (!result.has(bank.uuid)) {
      result.set(bank.uuid, { x: bank.x, y: bank.y });
    }
  }

  if (storedOverrides && storedOverrides.size > 0) {
    applyStoredDragOverrides(bankList, result, storedOverrides, byUuid);
  }

  return result;
}

/**
 * Hot path during bank drag: rewrite only cluster keys on a live map from frozen
 * base positions + primary display Δ. O(cluster) — no full Map copy, no bank scan.
 * Returns whether any cluster entry changed (for reactivity triggers).
 */
export function applyDragClusterDisplayPositions(
  live: DisplayPositionMap,
  baseDisplay: DisplayPositionMap,
  draggedUuid: string,
  dragX: number,
  dragY: number,
  moveUuids: ReadonlySet<string>,
): boolean {
  const basePrimary = baseDisplay.get(draggedUuid);
  if (!basePrimary) return false;

  const dx = dragX - basePrimary.x;
  const dy = dragY - basePrimary.y;
  let changed = false;

  for (const uuid of moveUuids) {
    const basePos = baseDisplay.get(uuid);
    if (!basePos) continue;
    const nx = basePos.x + dx;
    const ny = basePos.y + dy;
    const cur = live.get(uuid);
    if (cur && cur.x === nx && cur.y === ny) continue;
    live.set(uuid, { x: nx, y: ny });
    changed = true;
  }
  return changed;
}

/**
 * Immutable variant: shift the move set on a frozen base map by primary **display** Δ.
 * Prefer {@link applyDragClusterDisplayPositions} on the drag hot path (avoids O(n) copy).
 * When `moveUuids` is omitted, descendants of the primary are collected (O(n) scan).
 */
export function resolveDragClusterDisplayPositions(
  bankList: Bank[],
  draggedUuid: string,
  dragX: number,
  dragY: number,
  baseDisplay: DisplayPositionMap,
  moveUuids?: ReadonlySet<string>,
): DisplayPositionMap {
  const basePrimary = baseDisplay.get(draggedUuid);
  if (!basePrimary) {
    // Missing primary in base — only then fall back to bank list lookup.
    const bank = bankList.find((b) => b.uuid === draggedUuid);
    if (!bank) return baseDisplay;
    const base = { x: bank.x, y: bank.y };
    const dx = dragX - base.x;
    const dy = dragY - base.y;
    if (dx === 0 && dy === 0) return baseDisplay;
    const cluster =
      moveUuids ??
      new Set([
        draggedUuid,
        ...collectClusterDescendantUuids(draggedUuid, bankList),
      ]);
    const result = new Map(baseDisplay);
    for (const uuid of cluster) {
      const pos = result.get(uuid) ?? (uuid === draggedUuid ? base : undefined);
      if (!pos) continue;
      result.set(uuid, { x: pos.x + dx, y: pos.y + dy });
    }
    return result;
  }

  const dx = dragX - basePrimary.x;
  const dy = dragY - basePrimary.y;
  if (dx === 0 && dy === 0) return baseDisplay;

  const cluster =
    moveUuids ??
    new Set([
      draggedUuid,
      ...collectClusterDescendantUuids(draggedUuid, bankList),
    ]);

  const result = new Map(baseDisplay);
  for (const uuid of cluster) {
    const pos = result.get(uuid);
    if (!pos) continue;
    result.set(uuid, { x: pos.x + dx, y: pos.y + dy });
  }
  return result;
}

export function getDisplayPosition(
  bank: Bank,
  displayByUuid: DisplayPositionMap,
): Position2D {
  return displayByUuid.get(bank.uuid) ?? { x: bank.x, y: bank.y };
}

/**
 * Clear parent links while writing the current on-screen origin into stored x/y.
 * Attached banks ignore stored coords for canvas placement; without baking, a
 * detach/delete jumps them to (often stale) XML coordinates.
 */
export function mapDetachedKeepingDisplay(
  bankList: readonly Bank[],
  shouldDetach: (bank: Bank) => boolean,
): Bank[] {
  if (!bankList.some(shouldDetach)) {
    return bankList.map((b) => b);
  }

  const display = resolveDisplayPositions([...bankList]);
  return bankList.map((bank) => {
    if (!shouldDetach(bank)) return bank;
    const pos = display.get(bank.uuid) ?? { x: bank.x, y: bank.y };
    return {
      ...bank,
      x: pos.x,
      y: pos.y,
      attachedToUuid: null,
      attachDirection: null,
    };
  });
}

export function displayOffset(
  bank: Bank,
  displayByUuid: DisplayPositionMap,
): Position2D {
  const display = getDisplayPosition(bank, displayByUuid);
  return { x: display.x - bank.x, y: display.y - bank.y };
}

/** Placement span from display origin (connection lines, facing edges). */
export function bankRectAtDisplay(
  bank: Bank,
  display: Position2D,
): { x: number; y: number; width: number; height: number } {
  return bankPlacementRectAt(display.x, display.y, bank);
}