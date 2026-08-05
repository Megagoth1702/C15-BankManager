import type { AttachDirection } from '../types/bank';

/**
 * C15 `dock-banks` edge — matches NonMaps `Orientation` / firmware `droppedAt`.
 * @see _ref/nl-firmware/.../BankActions.cpp dock-banks
 */
export type DockEdge = 'west' | 'north' | 'east' | 'south';

export interface ResolvedAttach {
  parentUuid: string;
  childUuid: string;
  /** Stored on the child; C15 export persists only `left` or `top`. */
  attachDirection: AttachDirection;
}

/** Attach handle on the dragged bank → dock edge on the drop target. */
export function handleToDockEdge(handle: AttachDirection): DockEdge {
  switch (handle) {
    case 'left':
      return 'west';
    case 'top':
      return 'north';
    case 'right':
      return 'east';
    case 'bottom':
      return 'south';
  }
}

/**
 * Resolve parent/child roles for a dock operation.
 * `droppedOnto` = bank receiving the drop; `dragged` = bank being attached.
 */
export function resolveAttachFromDockEdge(
  dockEdge: DockEdge,
  droppedOntoUuid: string,
  draggedUuid: string,
): ResolvedAttach {
  switch (dockEdge) {
    case 'north':
      return {
        parentUuid: droppedOntoUuid,
        childUuid: draggedUuid,
        attachDirection: 'top',
      };
    case 'west':
      return {
        parentUuid: droppedOntoUuid,
        childUuid: draggedUuid,
        attachDirection: 'left',
      };
    case 'south':
      return {
        parentUuid: draggedUuid,
        childUuid: droppedOntoUuid,
        attachDirection: 'top',
      };
    case 'east':
      return {
        parentUuid: draggedUuid,
        childUuid: droppedOntoUuid,
        attachDirection: 'left',
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
 * Cyan highlight goes on the geometric target edge the user approaches,
 * which is opposite the firmware `droppedAt` tape name.
 */
export function highlightEdgeForDockEdge(dockEdge: DockEdge): DockEdge {
  switch (dockEdge) {
    case 'west':
      return 'east';
    case 'east':
      return 'west';
    case 'north':
      return 'south';
    case 'south':
      return 'north';
  }
}