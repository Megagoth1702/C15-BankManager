/**
 * Pure helpers for bank-drag pointer apply + end commit (Canvas holds session state).
 */
import type { Bank } from '../types/bank';
import type { DisplayPositionMap } from './displayPosition';
import { resolveDisplayPositions } from './displayPosition';
import {
  collectSpatialDockCandidateUuids,
  findDockTargetForDragCluster,
  validatePreferredDockHit,
  type ClusterDockHit,
  type PreferredDockSpec,
} from './dockHitTest';

export type BankDragPointerResult = {
  dragX: number;
  dragY: number;
};

/**
 * Live drag origin follows the pointer in C15 space (pixel-perfect, no grid snap).
 * Grid snap is applied on release via `moveBankTo` / `setBankOrigin`.
 * No synth-zone border magnet.
 */
export function applyBankDragPointerPosition(
  rawX: number,
  rawY: number,
): BankDragPointerResult {
  return {
    dragX: rawX,
    dragY: rawY,
  };
}

export type BankDragEndDock = {
  dock: ClusterDockHit;
  memberUuid: string;
  targetUuid: string;
};

export type ResolveBankDragEndDockOptions = {
  display?: DisplayPositionMap;
  /** Last pointer sample — only used when no preferred hover dock. */
  pointerC15?: { x: number; y: number };
  /**
   * Cyan hover pair at release. When set, commit **only** this pair if corridors
   * still overlap after the store move — never substitute a different bank that
   * also overlaps (e.g. tall side neighbor under a short middle bank).
   */
  preferredDock?: PreferredDockSpec | null;
};

/**
 * After store move, resolve the proximity dock for commit.
 *
 * Prefer the live cyan hover (`preferredDock`) so release matches what the user
 * saw. Only free-search when hover was null (e.g. throttled last frame).
 */
export function resolveBankDragEndDock(
  list: readonly Bank[],
  cluster: ReadonlySet<string>,
  displayOrOptions?: DisplayPositionMap | ResolveBankDragEndDockOptions,
  pointerC15Legacy?: { x: number; y: number },
): BankDragEndDock | null {
  // Back-compat: (list, cluster, display?, pointerC15?)
  const options: ResolveBankDragEndDockOptions =
    displayOrOptions != null &&
    typeof displayOrOptions === 'object' &&
    !(displayOrOptions instanceof Map) &&
    ('display' in displayOrOptions ||
      'pointerC15' in displayOrOptions ||
      'preferredDock' in displayOrOptions)
      ? (displayOrOptions as ResolveBankDragEndDockOptions)
      : {
          display: displayOrOptions as DisplayPositionMap | undefined,
          pointerC15: pointerC15Legacy,
        };

  const committedDisplay =
    options.display ?? resolveDisplayPositions(list as Bank[]);

  if (options.preferredDock) {
    const preferred = validatePreferredDockHit(
      list as Bank[],
      cluster,
      committedDisplay,
      options.preferredDock,
    );
    if (!preferred) return null;
    if (cluster.has(preferred.target.uuid)) return null;
    return {
      dock: preferred,
      memberUuid: preferred.memberUuid,
      targetUuid: preferred.target.uuid,
    };
  }

  const candidateUuids = collectSpatialDockCandidateUuids(
    list as Bank[],
    cluster,
    committedDisplay,
  );
  const dock = findDockTargetForDragCluster(list as Bank[], cluster, committedDisplay, {
    excludeClusterUuids: cluster,
    candidateUuids,
    pointerC15: options.pointerC15,
  });
  if (!dock) return null;
  if (cluster.has(dock.target.uuid)) return null;
  return {
    dock,
    memberUuid: dock.memberUuid,
    targetUuid: dock.target.uuid,
  };
}
