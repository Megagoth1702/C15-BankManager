import type { AttachDirection } from '../types/bank';

/**
 * C15 `dock-banks` edge — matches NonMaps `Orientation` / firmware `droppedAt`
 * (the tape on the bank that receives the drop).
 * @see _ref/nl-firmware/.../BankActions.cpp dock-banks
 * @see Bank::attachBank — callee becomes the *child* attached to the UUID arg.
 */
export type DockEdge = 'west' | 'north' | 'east' | 'south';

export interface ResolvedAttach {
  parentUuid: string;
  childUuid: string;
  /** Stored on the child; C15 export persists only `left` or `top`. */
  attachDirection: AttachDirection;
}

/**
 * Face on the *dragged* bank that mates with the target → NonMaps tape on the
 * drop target. Left face of the dragged bank meets the target's east tape.
 */
export function handleToDockEdge(handle: AttachDirection): DockEdge {
  switch (handle) {
    case 'left':
      return 'east';
    case 'top':
      return 'south';
    case 'right':
      return 'west';
    case 'bottom':
      return 'north';
  }
}

/**
 * Resolve parent/child roles for a dock operation.
 * Mirrors firmware `dock-banks` + `Bank::attachBank` (callee = child):
 *
 * | droppedAt | who becomes child | parent | attach-direction |
 * |-----------|-------------------|--------|------------------|
 * | East      | dragged           | onto   | left             |
 * | West      | onto              | dragged| left             |
 * | South     | dragged           | onto   | top              |
 * | North     | onto              | dragged| top              |
 *
 * Horizontal children always sit to the **right** of their parent; vertical
 * children always sit **below** (slaveRight / slaveBottom).
 */
export function resolveAttachFromDockEdge(
  dockEdge: DockEdge,
  droppedOntoUuid: string,
  draggedUuid: string,
): ResolvedAttach {
  switch (dockEdge) {
    case 'east':
      // dragged->attachBank(onto, left) → onto | dragged
      return {
        parentUuid: droppedOntoUuid,
        childUuid: draggedUuid,
        attachDirection: 'left',
      };
    case 'west':
      // onto->attachBank(dragged, left) → dragged | onto
      return {
        parentUuid: draggedUuid,
        childUuid: droppedOntoUuid,
        attachDirection: 'left',
      };
    case 'south':
      // dragged->attachBank(onto, top) → onto above, dragged below
      return {
        parentUuid: droppedOntoUuid,
        childUuid: draggedUuid,
        attachDirection: 'top',
      };
    case 'north':
      // onto->attachBank(dragged, top) → dragged above, onto below
      return {
        parentUuid: draggedUuid,
        childUuid: droppedOntoUuid,
        attachDirection: 'top',
      };
  }
}

/** Handle drag from `source` onto `target` (target = bank under pointer). */
export function resolveAttachFromHandle(
  handle: AttachDirection,
  sourceUuid: string,
  targetUuid: string,
): ResolvedAttach {
  return resolveAttachFromDockEdge(handleToDockEdge(handle), targetUuid, sourceUuid);
}

/**
 * Cyan highlight on the **target** uses the same edge as firmware `droppedAt`
 * (the tape that received the drop).
 */
export function highlightEdgeForDockEdge(dockEdge: DockEdge): DockEdge {
  return dockEdge;
}