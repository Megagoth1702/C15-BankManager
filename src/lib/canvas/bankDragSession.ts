/**
 * Pure helpers for bank-drag pointer apply + end commit (Canvas holds session state).
 */
import type { Bank } from '../types/bank';
import type { DisplayPositionMap } from './displayPosition';
import { resolveDisplayPositions } from './displayPosition';
import {
  collectSpatialDockCandidateUuids,
  findDockTargetForDragCluster,
  type ClusterDockHit,
} from './dockHitTest';
import { snapToGrid } from '../model/bankFactory';

export type BankDragPointerResult = {
  dragX: number;
  dragY: number;
};

/**
 * Snap drag origin to the C15 grid (15 units). No synth-zone border magnet.
 */
export function applyBankDragPointerPosition(
  rawX: number,
  rawY: number,
): BankDragPointerResult {
  return {
    dragX: snapToGrid(rawX),
    dragY: snapToGrid(rawY),
  };
}

export type BankDragEndDock = {
  dock: ClusterDockHit;
  memberUuid: string;
  targetUuid: string;
};

/**
 * After store move, find proximity dock target outside the move cluster (if any).
 * Uses the same spatial candidate filter as live dock hover so chrome and commit match.
 */
export function resolveBankDragEndDock(
  list: readonly Bank[],
  cluster: ReadonlySet<string>,
  display?: DisplayPositionMap,
): BankDragEndDock | null {
  const committedDisplay = display ?? resolveDisplayPositions(list as Bank[]);
  const candidateUuids = collectSpatialDockCandidateUuids(
    list as Bank[],
    cluster,
    committedDisplay,
  );
  const dock = findDockTargetForDragCluster(list as Bank[], cluster, committedDisplay, {
    excludeClusterUuids: cluster,
    candidateUuids,
  });
  if (!dock) return null;
  if (cluster.has(dock.target.uuid)) return null;
  return {
    dock,
    memberUuid: dock.memberUuid,
    targetUuid: dock.target.uuid,
  };
}
