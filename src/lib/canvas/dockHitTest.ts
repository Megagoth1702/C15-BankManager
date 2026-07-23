import type { DockEdge } from '../model/attachOperation';
import { highlightEdgeForDockEdge } from '../model/attachOperation';
import type { Bank } from '../types/bank';
import {
  type AttachCorridorCache,
  type AttachCorridorId,
  attachCorridorsForBankCached,
  rectCenter,
  rectOverlapArea,
} from './attachCorridors';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';
import {
  BANK_LAYOUT,
  bankOuterHeight,
  bankOuterWidth,
} from './geometry';

export interface DockHit {
  target: Bank;
  /** Geometric edge on target for UI highlight. */
  highlightEdge: DockEdge;
  /** Edge on the dragged bank that is approaching the target. */
  draggedHighlightEdge: DockEdge;
  /** Firmware `droppedAt` for attach resolver. */
  dockEdge: DockEdge;
}

/** Dock hit where the approaching bank is a member of a multi-bank drag cluster. */
export interface ClusterDockHit extends DockHit {
  /** Cluster bank whose corridor overlapped the target (may ≠ pointer primary). */
  memberUuid: string;
}

/**
 * Complementary attach-corridor pairs only (L↔R, T↔B).
 * Tapes and outer proximity never participate.
 */
const COMPLEMENTARY_PAIRS: readonly {
  dragged: AttachCorridorId;
  target: AttachCorridorId;
  /** Approach side of the dragged bank → firmware dockEdge (unchanged mapping). */
  dockEdge: DockEdge;
  draggedHighlightEdge: DockEdge;
}[] = [
  {
    dragged: 'L',
    target: 'R',
    dockEdge: 'west',
    draggedHighlightEdge: 'west',
  },
  {
    dragged: 'R',
    target: 'L',
    dockEdge: 'east',
    draggedHighlightEdge: 'east',
  },
  {
    dragged: 'T',
    target: 'B',
    dockEdge: 'north',
    draggedHighlightEdge: 'north',
  },
  {
    dragged: 'B',
    target: 'T',
    dockEdge: 'south',
    draggedHighlightEdge: 'south',
  },
];

/**
 * Find the best dock target when complementary attach corridors overlap.
 * Uses live dragged position (pass `x`/`y` overrides while pointer-dragging).
 *
 * Eligible only when attachL/R/T/B rects of the pair have positive intersection
 * area — not outer boxes, tapes, or proximity gaps.
 */
export interface DockHitTestOptions {
  excludeUuid?: string;
  /**
   * When set, only these banks are considered as dock targets.
   * Prefer {@link collectSpatialDockCandidateUuids} for hover and commit so
   * chrome and release agree (do not mix viewport cull with full-list search).
   */
  candidateUuids?: ReadonlySet<string>;
  /** Skip targets in the same attachment cluster as the dragged bank. */
  excludeClusterUuids?: ReadonlySet<string>;
  /**
   * Optional session cache for attach corridors (reuse while display origin is
   * unchanged). Clear at drag end. Cluster members recompute on move.
   */
  corridorCache?: AttachCorridorCache;
}

/**
 * Banks that could geometrically corridor-dock with the move cluster: targets
 * whose outer rect intersects the cluster AABB expanded by one bank span + VA.
 * Shared by live dock hover and release dock so highlight and commit match.
 */
export function collectSpatialDockCandidateUuids(
  banks: readonly Bank[],
  clusterUuids: ReadonlySet<string>,
  displayByUuid: DisplayPositionMap,
): Set<string> {
  if (clusterUuids.size === 0) return new Set();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  for (const bank of banks) {
    if (!clusterUuids.has(bank.uuid)) continue;
    const o = getDisplayPosition(bank, displayByUuid);
    const w = bankOuterWidth();
    const h = bankOuterHeight(bank);
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + w);
    maxY = Math.max(maxY, o.y + h);
    any = true;
  }
  if (!any) return new Set();

  // Corridor strips stick out VA; a target body can sit one full span away.
  const pad =
    Math.max(bankOuterWidth(), BANK_LAYOUT.visibleAttachArea) +
    BANK_LAYOUT.visibleAttachArea;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const candidates = new Set<string>();
  for (const bank of banks) {
    if (clusterUuids.has(bank.uuid)) continue;
    const o = getDisplayPosition(bank, displayByUuid);
    const w = bankOuterWidth();
    const h = bankOuterHeight(bank);
    if (o.x + w < minX || o.x > maxX || o.y + h < minY || o.y > maxY) {
      continue;
    }
    candidates.add(bank.uuid);
  }
  return candidates;
}

type ScoredDockHit = DockHit & { area: number; distSq: number };

function isBetterScore(
  candidate: { area: number; distSq: number },
  best: { area: number; distSq: number } | null,
): boolean {
  if (!best) return true;
  return (
    candidate.area > best.area ||
    (candidate.area === best.area && candidate.distSq < best.distSq)
  );
}

function findDockTargetForDraggedBankScored(
  banks: Bank[],
  draggedBank: Bank,
  displayByUuid: DisplayPositionMap,
  options: DockHitTestOptions = {},
): ScoredDockHit | null {
  const draggedUuid = options.excludeUuid ?? draggedBank.uuid;
  const draggedOrigin = getDisplayPosition(draggedBank, displayByUuid);
  const cache = options.corridorCache;
  const draggedCorridors = attachCorridorsForBankCached(
    cache,
    draggedBank,
    draggedOrigin.x,
    draggedOrigin.y,
  );

  let best: ScoredDockHit | null = null;

  for (const target of banks) {
    if (target.uuid === draggedUuid) continue;
    if (options.candidateUuids && !options.candidateUuids.has(target.uuid)) {
      continue;
    }
    if (options.excludeClusterUuids?.has(target.uuid)) continue;

    const targetOrigin = getDisplayPosition(target, displayByUuid);
    const targetCorridors = attachCorridorsForBankCached(
      cache,
      target,
      targetOrigin.x,
      targetOrigin.y,
    );

    for (const pair of COMPLEMENTARY_PAIRS) {
      const a = draggedCorridors[pair.dragged];
      const b = targetCorridors[pair.target];
      const area = rectOverlapArea(a, b);
      if (area <= 0) continue;

      const ca = rectCenter(a);
      const cb = rectCenter(b);
      const dx = ca.x - cb.x;
      const dy = ca.y - cb.y;
      const distSq = dx * dx + dy * dy;

      if (!isBetterScore({ area, distSq }, best)) continue;

      best = {
        target,
        dockEdge: pair.dockEdge,
        highlightEdge: highlightEdgeForDockEdge(pair.dockEdge),
        draggedHighlightEdge: pair.draggedHighlightEdge,
        area,
        distSq,
      };
    }
  }

  return best;
}

function toDockHit(scored: ScoredDockHit): DockHit {
  return {
    target: scored.target,
    dockEdge: scored.dockEdge,
    highlightEdge: scored.highlightEdge,
    draggedHighlightEdge: scored.draggedHighlightEdge,
  };
}

export function findDockTargetForDraggedBank(
  banks: Bank[],
  draggedBank: Bank,
  displayByUuid: DisplayPositionMap,
  options: DockHitTestOptions = {},
): DockHit | null {
  const scored = findDockTargetForDraggedBankScored(
    banks,
    draggedBank,
    displayByUuid,
    options,
  );
  return scored ? toDockHit(scored) : null;
}

/**
 * Best complementary-corridor dock for any bank in a translating drag cluster.
 * Targets inside the cluster are never chosen.
 */
export function findDockTargetForDragCluster(
  banks: Bank[],
  memberUuids: ReadonlySet<string> | readonly string[],
  displayByUuid: DisplayPositionMap,
  options: Omit<DockHitTestOptions, 'excludeUuid'> = {},
): ClusterDockHit | null {
  const members =
    memberUuids instanceof Set ? memberUuids : new Set(memberUuids);
  if (members.size === 0) return null;

  const excludeCluster = options.excludeClusterUuids ?? members;
  const byUuid = new Map(banks.map((b) => [b.uuid, b]));

  let best: (ScoredDockHit & { memberUuid: string }) | null = null;

  for (const memberUuid of members) {
    const member = byUuid.get(memberUuid);
    if (!member) continue;

    const scored = findDockTargetForDraggedBankScored(
      banks,
      member,
      displayByUuid,
      {
        ...options,
        excludeUuid: memberUuid,
        excludeClusterUuids: excludeCluster,
      },
    );
    if (!scored) continue;
    if (!isBetterScore(scored, best)) continue;

    best = { ...scored, memberUuid };
  }

  if (!best) return null;

  return {
    ...toDockHit(best),
    memberUuid: best.memberUuid,
  };
}
