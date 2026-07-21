import type { DockEdge } from '../model/attachOperation';
import { highlightEdgeForDockEdge } from '../model/attachOperation';
import type { Bank } from '../types/bank';
import {
  type AttachCorridorId,
  attachCorridorsForBank,
  rectCenter,
  rectOverlapArea,
} from './attachCorridors';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';

export interface DockHit {
  target: Bank;
  /** Geometric edge on target for UI highlight. */
  highlightEdge: DockEdge;
  /** Edge on the dragged bank that is approaching the target. */
  draggedHighlightEdge: DockEdge;
  /** Firmware `droppedAt` for attach resolver. */
  dockEdge: DockEdge;
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
  /** When set, only these banks are considered as dock targets (viewport culling). */
  candidateUuids?: ReadonlySet<string>;
  /** Skip targets in the same attachment cluster as the dragged bank. */
  excludeClusterUuids?: ReadonlySet<string>;
}

export function findDockTargetForDraggedBank(
  banks: Bank[],
  draggedBank: Bank,
  displayByUuid: DisplayPositionMap,
  options: DockHitTestOptions = {},
): DockHit | null {
  const draggedUuid = options.excludeUuid ?? draggedBank.uuid;
  const draggedOrigin = getDisplayPosition(draggedBank, displayByUuid);
  const draggedCorridors = attachCorridorsForBank(
    draggedBank,
    draggedOrigin.x,
    draggedOrigin.y,
  );

  let best: (DockHit & { area: number; distSq: number }) | null = null;

  for (const target of banks) {
    if (target.uuid === draggedUuid) continue;
    if (options.candidateUuids && !options.candidateUuids.has(target.uuid)) {
      continue;
    }
    if (options.excludeClusterUuids?.has(target.uuid)) continue;

    const targetOrigin = getDisplayPosition(target, displayByUuid);
    const targetCorridors = attachCorridorsForBank(
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

      const better =
        !best ||
        area > best.area ||
        (area === best.area && distSq < best.distSq);

      if (better) {
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
  }

  return best
    ? {
        target: best.target,
        dockEdge: best.dockEdge,
        highlightEdge: best.highlightEdge,
        draggedHighlightEdge: best.draggedHighlightEdge,
      }
    : null;
}
