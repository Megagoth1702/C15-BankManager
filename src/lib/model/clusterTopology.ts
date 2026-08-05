/**
 * NonMaps bank master/slave graph + C15 empty-tape activity.
 *
 * Source of truth: `_ref/nl-firmware/.../Bank.java`
 *   - installRelationshipMasterSlave / addSlave
 *   - isTapeActive(Orientation)
 *
 * Children only occupy slaveRight (horizontal attach-direction left|right) or
 * slaveBottom (vertical top|bottom). Empty attach tapes (corridor markers /
 * exterior dock) light only where `isTapeActive` is true — not on faces already
 * used by the cluster interior.
 *
 * @see _ref/attachmentRules.png
 */
import { slaveSlotForAttach } from '../canvas/attachSemantics';
import type { DockEdge } from './attachOperation';
import type { Bank } from '../types/bank';

/** Master/slave links for one bank (NonMaps runtime fields). */
export interface ClusterNodeLinks {
  /** Parent north of this bank (this bank is parent's slaveBottom). */
  masterTop: string | null;
  /** Parent west of this bank (this bank is parent's slaveRight). */
  masterLeft: string | null;
  slaveBottom: string | null;
  slaveRight: string | null;
}

export type ClusterTopology = Map<string, ClusterNodeLinks>;

function emptyLinks(): ClusterNodeLinks {
  return {
    masterTop: null,
    masterLeft: null,
    slaveBottom: null,
    slaveRight: null,
  };
}

/**
 * Build NonMaps-style master/slave links from stored `attachedToUuid` /
 * `attachDirection`. If two children claim the same parent slot, the first
 * in list order wins (matches addSlave "only if null").
 */
export function buildClusterTopology(
  banks: readonly Bank[],
): ClusterTopology {
  const links: ClusterTopology = new Map();
  for (const bank of banks) {
    links.set(bank.uuid, emptyLinks());
  }

  for (const bank of banks) {
    if (!bank.attachedToUuid || !bank.attachDirection) continue;
    const parent = links.get(bank.attachedToUuid);
    const child = links.get(bank.uuid);
    if (!parent || !child) continue;

    const slot = slaveSlotForAttach(bank.attachDirection);
    if (slot === 'bottom') {
      child.masterTop = bank.attachedToUuid;
      if (parent.slaveBottom == null) parent.slaveBottom = bank.uuid;
    } else {
      child.masterLeft = bank.attachedToUuid;
      if (parent.slaveRight == null) parent.slaveRight = bank.uuid;
    }
  }

  return links;
}

/**
 * Whether an empty attach tape is active on this bank (corridor may light /
 * exterior dock may land here).
 *
 * Mirrors NonMaps `Bank.isTapeActive`:
 * - North / West: only cluster free ends (no master)
 * - South: only if no bottom slave yet
 * - East: no right slave on this bank or any masterTop ancestor in the column
 */
export function isTapeActive(
  topology: ClusterTopology,
  uuid: string,
  edge: DockEdge,
): boolean {
  const node = topology.get(uuid);
  if (!node) return false;

  const hasMaster = node.masterLeft != null || node.masterTop != null;

  switch (edge) {
    case 'north':
      return !hasMaster;
    case 'west':
      return !hasMaster;
    case 'south':
      return node.slaveBottom == null;
    case 'east': {
      let walker: string | null = uuid;
      while (walker != null) {
        const w = topology.get(walker);
        if (!w) break;
        if (w.slaveRight != null) return false;
        walker = w.masterTop;
      }
      return true;
    }
  }
}

/** Active empty-tape edges for UI (L/R/T/B ↔ west/east/north/south). */
export type ActiveAttachCorridorId = 'L' | 'R' | 'T' | 'B';

const EDGE_TO_CORRIDOR: Record<DockEdge, ActiveAttachCorridorId> = {
  west: 'L',
  east: 'R',
  north: 'T',
  south: 'B',
};

const ALL_EDGES: readonly DockEdge[] = ['north', 'south', 'east', 'west'];

export function activeAttachCorridorsForBank(
  topology: ClusterTopology,
  uuid: string,
): Set<ActiveAttachCorridorId> {
  const out = new Set<ActiveAttachCorridorId>();
  for (const edge of ALL_EDGES) {
    if (isTapeActive(topology, uuid, edge)) {
      out.add(EDGE_TO_CORRIDOR[edge]);
    }
  }
  return out;
}

/**
 * Parent face that must accept a new child for stored attach-direction.
 * left|right → East tape (slaveRight); top|bottom → South tape (slaveBottom).
 */
export function parentTapeForChildAttach(
  attachDirection: 'left' | 'right' | 'top' | 'bottom',
): DockEdge {
  const slot = slaveSlotForAttach(attachDirection);
  return slot === 'right' ? 'east' : 'south';
}
