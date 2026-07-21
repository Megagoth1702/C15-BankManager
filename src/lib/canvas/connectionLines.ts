import { slaveSlotForAttach } from './attachSemantics';
import type { DisplayPositionMap } from './displayPosition';
import { getDisplayPosition } from './displayPosition';
import { bankRectAtDisplay } from './displayPosition';
import { BANK_LAYOUT, C15_SCALE } from './geometry';
import type { AttachDirection, Bank } from '../types/bank';

export interface AttachmentEdge {
  childUuid: string;
  parentUuid: string;
}

export interface ConnectionLine extends AttachmentEdge {
  /** Child bank uuid — one line per parent→child link. */
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function outerMidX(rect: WorldRect): number {
  return rect.x + rect.width / 2;
}

/** Vertical center of the header band (NonMaps connection line height). */
function headerBandMidY(rect: WorldRect): number {
  return rect.y + (BANK_LAYOUT.tapeSize + BANK_LAYOUT.headerHeight / 2) * C15_SCALE;
}

/**
 * Line endpoints at outer card edges.
 * Horizontal attaches (left/right → slaveRight): parent right → child left at header Y.
 * Vertical attaches (top/bottom → slaveBottom): parent bottom → child top at center X.
 */
function anchorPoints(
  parent: WorldRect,
  child: WorldRect,
  attachDirection: AttachDirection | null,
): { x1: number; y1: number; x2: number; y2: number } {
  if (!attachDirection) {
    return {
      x1: outerMidX(parent),
      y1: headerBandMidY(parent),
      x2: outerMidX(child),
      y2: headerBandMidY(child),
    };
  }

  const slot = slaveSlotForAttach(attachDirection);
  if (slot === 'right') {
    return {
      x1: parent.x + parent.width,
      y1: headerBandMidY(parent),
      x2: child.x,
      y2: headerBandMidY(child),
    };
  }

  return {
    x1: outerMidX(parent),
    y1: parent.y + parent.height,
    x2: outerMidX(child),
    y2: child.y,
  };
}

function buildBankMap(banks: Bank[]): Map<string, Bank> {
  return new Map(banks.map((bank) => [bank.uuid, bank]));
}

function getAncestryChain(
  bankUuid: string,
  byUuid: Map<string, Bank>,
): Bank[] {
  const chain: Bank[] = [];
  let current = byUuid.get(bankUuid);
  const visited = new Set<string>();

  while (current && !visited.has(current.uuid)) {
    visited.add(current.uuid);
    chain.push(current);
    if (!current.attachedToUuid) break;
    current = byUuid.get(current.attachedToUuid);
  }

  return chain;
}

/**
 * Produces the full attachment forest (e.g. L4→L3, L3→L2, L2→L), deduped by child.
 */
export function collectAttachmentEdges(banks: Bank[]): AttachmentEdge[] {
  const byUuid = buildBankMap(banks);
  const edgeByChild = new Map<string, AttachmentEdge>();

  for (const bank of banks) {
    const chain = getAncestryChain(bank.uuid, byUuid);
    for (let i = 0; i < chain.length - 1; i++) {
      const child = chain[i]!;
      const parent = chain[i + 1]!;
      edgeByChild.set(child.uuid, {
        childUuid: child.uuid,
        parentUuid: parent.uuid,
      });
    }
  }

  return [...edgeByChild.values()];
}

/**
 * Child uuids for each parent-link on the path from `bankUuid` up to the root.
 * Used to draw solid lines toward parents; child links stay dashed.
 */
export function getParentChainEdgeChildIds(
  bankUuid: string | null | undefined,
  banks: Bank[],
): Set<string> {
  if (!bankUuid) return new Set();

  const byUuid = buildBankMap(banks);
  const chain = getAncestryChain(bankUuid, byUuid);
  const ids = new Set<string>();

  for (let i = 0; i < chain.length - 1; i++) {
    ids.add(chain[i]!.uuid);
  }

  return ids;
}

/** @deprecated Use `getParentChainEdgeChildIds` */
export const getAncestryEdgeChildIds = getParentChainEdgeChildIds;

/** Solid segments (selected bank → parents) for the current selection. */
export function getSolidParentChainEdgeIdsForSelection(
  selectedUuids: readonly string[],
  banks: Bank[],
): Set<string> {
  const ids = new Set<string>();
  for (const uuid of selectedUuids) {
    for (const id of getParentChainEdgeChildIds(uuid, banks)) {
      ids.add(id);
    }
  }
  return ids;
}

/** @deprecated Use `getSolidParentChainEdgeIdsForSelection` */
export const getAncestryEdgeChildIdsForSelection = getSolidParentChainEdgeIdsForSelection;

export function buildConnectionLines(
  banks: Bank[],
  displayByUuid: DisplayPositionMap,
): ConnectionLine[] {
  const byUuid = buildBankMap(banks);
  const lines: ConnectionLine[] = [];

  for (const edge of collectAttachmentEdges(banks)) {
    const child = byUuid.get(edge.childUuid);
    const parent = byUuid.get(edge.parentUuid);
    if (!child || !parent) continue;

    const parentOrigin = getDisplayPosition(parent, displayByUuid);
    const childOrigin = getDisplayPosition(child, displayByUuid);
    const parentC15 = bankRectAtDisplay(parent, parentOrigin);
    const childC15 = bankRectAtDisplay(child, childOrigin);
    const parentRect: WorldRect = {
      x: parentC15.x * C15_SCALE,
      y: parentC15.y * C15_SCALE,
      width: parentC15.width * C15_SCALE,
      height: parentC15.height * C15_SCALE,
    };
    const childRect: WorldRect = {
      x: childC15.x * C15_SCALE,
      y: childC15.y * C15_SCALE,
      width: childC15.width * C15_SCALE,
      height: childC15.height * C15_SCALE,
    };
    const { x1, y1, x2, y2 } = anchorPoints(
      parentRect,
      childRect,
      child.attachDirection,
    );

    lines.push({
      id: child.uuid,
      parentUuid: parent.uuid,
      childUuid: child.uuid,
      x1,
      y1,
      x2,
      y2,
    });
  }

  return lines;
}