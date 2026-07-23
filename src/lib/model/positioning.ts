import { logAttachPositionDecision } from '../debug/positionLog';
import { slaveSlotForAttach } from '../canvas/attachSemantics';
import {
  BANK_LAYOUT,
  horizontalAttachStep,
  verticalAttachStep,
} from '../canvas/geometry';
import type { AttachDirection, Bank } from '../types/bank';

/**
 * Stored-coordinate attachment layout (persisted backup XML).
 * Horizontal step ΔX≈270; vertical step from outer height + slave gap.
 * Canvas display uses flush-chrome gap (Δx 285, 30/45 past parent span); stored XML keeps
 * the same persisted step. See `displayPosition.ts`.
 */
export const POSITIONING = {
  /** Misaligned / import-heal threshold for stored coords vs persisted formula. */
  deviationThreshold: BANK_LAYOUT.slaveDistance,
  slaveDistance: BANK_LAYOUT.slaveDistance,
  snapGrid: BANK_LAYOUT.snapGrid,
};

export interface Position2D {
  x: number;
  y: number;
}

/**
 * Horizontal slave Y — same row as parent unless parent is on a vertical branch,
 * then persisted XML uses parent.y − slaveDistance (L4 → L3: Δy = −30).
 */
function horizontalAttachY(parent: Bank): number {
  if (parent.attachDirection === 'top' || parent.attachDirection === 'bottom') {
    return parent.y - BANK_LAYOUT.slaveDistance;
  }
  return parent.y;
}

/** Recommended **stored** origin for export / re-align (persisted XML step ≈270). */
export function computeRecommendedStoredPosition(
  parent: Bank,
  _child: Bank,
  attachDirection: AttachDirection,
): Position2D {
  const slot = slaveSlotForAttach(attachDirection);

  if (slot === 'right') {
    // Horizontal attach: child to the right; tops aligned (same outer origin Y).
    return {
      x: parent.x + horizontalAttachStep(),
      y: horizontalAttachY(parent),
    };
  }

  // Vertical attach: child below; left edges aligned (same outer origin X).
  return {
    x: parent.x,
    y: parent.y + verticalAttachStep(parent),
  };
}

/** @deprecated Use `computeRecommendedStoredPosition` */
export const computeRecommendedPosition = computeRecommendedStoredPosition;

export function buildBankMap(bankList: Bank[]): Map<string, Bank> {
  return new Map(bankList.map((bank) => [bank.uuid, bank]));
}

export function getRecommendedPosition(
  child: Bank,
  banksByUuid: Map<string, Bank>,
): Position2D | null {
  if (!child.attachedToUuid || !child.attachDirection) return null;
  const parent = banksByUuid.get(child.attachedToUuid);
  if (!parent) return null;
  return computeRecommendedStoredPosition(parent, child, child.attachDirection);
}

export function isPositionDeviated(
  child: Bank,
  banksByUuid: Map<string, Bank>,
  threshold = POSITIONING.deviationThreshold,
): boolean {
  const recommended = getRecommendedPosition(child, banksByUuid);
  if (!recommended) return false;
  const dx = child.x - recommended.x;
  const dy = child.y - recommended.y;
  return Math.hypot(dx, dy) > threshold;
}

export function buildDeviatedUuidSet(
  bankList: Bank[],
  userPositioned: ReadonlySet<string>,
): Set<string> {
  const byUuid = buildBankMap(bankList);
  const deviated = new Set<string>();

  for (const bank of bankList) {
    if (!bank.attachedToUuid || userPositioned.has(bank.uuid)) continue;
    if (isPositionDeviated(bank, byUuid)) {
      deviated.add(bank.uuid);
    }
  }

  return deviated;
}

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

export interface ImportHealResult {
  banks: Bank[];
  healedCount: number;
}

/**
 * On import, attached child x/y from the device is often stale (parent moved, child coords not updated).
 * Recompute **stored** positions only when coords clearly stale (> slaveDistance).
 * Keeps authentic device XML (e.g. Δx=285) when within normal drift.
 */
export function healAttachedPositionsOnImport(bankList: Bank[]): ImportHealResult {
  const byUuid = buildBankMap(bankList);
  const working = new Map(bankList.map((bank) => [bank.uuid, { ...bank }]));

  const attached = bankList.filter((b) => b.attachedToUuid && b.attachDirection);
  attached.sort(
    (a, b) => attachmentDepth(a, byUuid) - attachmentDepth(b, byUuid),
  );

  let healedCount = 0;

  for (const original of attached) {
    const child = working.get(original.uuid);
    if (!child?.attachedToUuid || !child.attachDirection) continue;

    const parent = working.get(child.attachedToUuid);
    if (!parent) continue;

    const currentByUuid = buildBankMap([...working.values()]);
    const before = { x: child.x, y: child.y };

    if (!isPositionDeviated(child, currentByUuid, POSITIONING.deviationThreshold)) {
      logAttachPositionDecision(
        'position',
        'import-heal-skip',
        child,
        parent,
        before,
        before,
      );
      continue;
    }

    const recommended = computeRecommendedStoredPosition(
      parent,
      child,
      child.attachDirection,
    );
    child.x = recommended.x;
    child.y = recommended.y;
    logAttachPositionDecision(
      'position',
      'import-heal-apply',
      child,
      parent,
      before,
      { x: child.x, y: child.y },
    );
    healedCount++;
  }

  return {
    banks: bankList.map((b) => working.get(b.uuid)!),
    healedCount,
  };
}

export function computeRealignedBanks(bankList: Bank[]): Bank[] {
  const byUuid = buildBankMap(bankList);
  const working = new Map(bankList.map((bank) => [bank.uuid, { ...bank }]));

  const attached = bankList.filter((b) => b.attachedToUuid && b.attachDirection);
  attached.sort(
    (a, b) => attachmentDepth(a, byUuid) - attachmentDepth(b, byUuid),
  );

  for (const original of attached) {
    const child = working.get(original.uuid);
    if (!child?.attachedToUuid || !child.attachDirection) continue;

    const parent = working.get(child.attachedToUuid);
    if (!parent) continue;

    const before = { x: child.x, y: child.y };
    const recommended = computeRecommendedStoredPosition(
      parent,
      child,
      child.attachDirection,
    );
    child.x = recommended.x;
    child.y = recommended.y;
    logAttachPositionDecision(
      'position',
      'realign-apply',
      child,
      parent,
      before,
      { x: child.x, y: child.y },
    );
  }

  return bankList.map((b) => working.get(b.uuid)!);
}

export function countAttachedBanks(bankList: Bank[]): number {
  return bankList.filter((b) => b.attachedToUuid && b.attachDirection).length;
}

export function getDirectChildren(parentUuid: string, bankList: Bank[]): Bank[] {
  return bankList.filter((b) => b.attachedToUuid === parentUuid);
}

/**
 * All banks attached beneath `rootUuid` (children, grandchildren, …).
 * Mirrors NonMaps `Bank.collectCluster()` attachment subtree.
 */
export function collectClusterDescendantUuids(
  rootUuid: string,
  bankList: Bank[],
): Set<string> {
  const descendants = new Set<string>();
  let frontier = [rootUuid];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parentUuid of frontier) {
      for (const bank of bankList) {
        if (bank.attachedToUuid === parentUuid && !descendants.has(bank.uuid)) {
          descendants.add(bank.uuid);
          next.push(bank.uuid);
        }
      }
    }
    frontier = next;
  }

  return descendants;
}

/**
 * Banks that translate together during a canvas bank drag.
 *
 * - **Multi-select mode** when `selectedUuids.length ≥ 2` and primary is among
 *   them: exactly the selected banks that still exist (no parent/descendant expand).
 * - **Cluster mode** otherwise: primary + attachment descendants (children follow).
 */
export function buildBankDragMoveSet(
  primaryUuid: string,
  bankList: Bank[],
  selectedUuids?: readonly string[],
): Set<string> {
  const selected = selectedUuids ?? [];
  if (selected.length >= 2 && selected.includes(primaryUuid)) {
    const existing = new Set(bankList.map((b) => b.uuid));
    return new Set(selected.filter((u) => existing.has(u)));
  }
  return new Set([
    primaryUuid,
    ...collectClusterDescendantUuids(primaryUuid, bankList),
  ]);
}

/**
 * True when this bank's parent link crosses the drag move-set boundary
 * (exactly one of child / parent is in the set). Such edges must be severed
 * at grab so multi-select drag can leave unselected relatives behind.
 */
export function attachmentCrossesMoveSet(
  bank: Bank,
  moveSet: ReadonlySet<string>,
): boolean {
  if (!bank.attachedToUuid) return false;
  return moveSet.has(bank.uuid) !== moveSet.has(bank.attachedToUuid);
}

/**
 * Uuids that would lose their parent when applying a boundary cut for `moveSet`.
 * Pure helper for tests and previews.
 */
export function banksToDetachForMoveSet(
  bankList: readonly Bank[],
  moveSet: ReadonlySet<string>,
): string[] {
  return bankList
    .filter((b) => attachmentCrossesMoveSet(b, moveSet))
    .map((b) => b.uuid);
}

/** True when `a` and `b` are the same bank or linked in the attachment tree. */
export function banksShareAttachmentCluster(
  aUuid: string,
  bUuid: string,
  bankList: Bank[],
): boolean {
  if (aUuid === bUuid) return true;
  if (collectClusterDescendantUuids(aUuid, bankList).has(bUuid)) return true;
  if (collectClusterDescendantUuids(bUuid, bankList).has(aUuid)) return true;

  const byUuid = buildBankMap(bankList);
  let current = byUuid.get(aUuid);
  while (current?.attachedToUuid) {
    if (current.attachedToUuid === bUuid) return true;
    current = byUuid.get(current.attachedToUuid);
  }
  current = byUuid.get(bUuid);
  while (current?.attachedToUuid) {
    if (current.attachedToUuid === aUuid) return true;
    current = byUuid.get(current.attachedToUuid);
  }
  return false;
}