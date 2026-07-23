/**
 * Pure helpers for bank-drag pointer apply + end commit (Canvas holds session state).
 */
import type { Bank } from '../types/bank';
import type { DisplayPositionMap } from './displayPosition';
import { resolveDisplayPositions } from './displayPosition';
import {
  findBorderSnapForDraggedBank,
  type SynthBorderEdge,
} from './borderSnapHitTest';
import { findDockTargetForDragCluster, type ClusterDockHit } from './dockHitTest';
import { snapToGrid } from '../model/bankFactory';

export type BankDragPointerResult = {
  dragX: number;
  dragY: number;
  borderSnapEdge: SynthBorderEdge | null;
  borderSnapRole: 'outer' | 'inner' | null;
};

/**
 * Snap drag origin to grid; optionally snap to synth border when zone is shown.
 */
export function applyBankDragPointerPosition(
  dragged: Bank,
  rawX: number,
  rawY: number,
  options: { showSynthZone: boolean },
): BankDragPointerResult {
  let dragX = rawX;
  let dragY = rawY;
  let borderSnapEdge: SynthBorderEdge | null = null;
  let borderSnapRole: 'outer' | 'inner' | null = null;

  if (options.showSynthZone) {
    const borderSnap = findBorderSnapForDraggedBank(dragged, dragX, dragY);
    if (borderSnap) {
      dragX = borderSnap.snappedX;
      dragY = borderSnap.snappedY;
      borderSnapEdge = borderSnap.edge;
      borderSnapRole = borderSnap.role;
    }
  }

  return {
    dragX: snapToGrid(dragX),
    dragY: snapToGrid(dragY),
    borderSnapEdge,
    borderSnapRole,
  };
}

export type BankDragEndDock = {
  dock: ClusterDockHit;
  memberUuid: string;
  targetUuid: string;
};

/**
 * After store move, find proximity dock target outside the move cluster (if any).
 */
export function resolveBankDragEndDock(
  list: readonly Bank[],
  cluster: ReadonlySet<string>,
  display?: DisplayPositionMap,
): BankDragEndDock | null {
  const committedDisplay = display ?? resolveDisplayPositions(list as Bank[]);
  const dock = findDockTargetForDragCluster(list as Bank[], cluster, committedDisplay, {
    excludeClusterUuids: cluster,
  });
  if (!dock) return null;
  if (cluster.has(dock.target.uuid)) return null;
  return {
    dock,
    memberUuid: dock.memberUuid,
    targetUuid: dock.target.uuid,
  };
}
