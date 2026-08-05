import { slaveSlotForAttach, type AttachmentSlaveSlot } from '../canvas/attachSemantics';
import type { AttachDirection, Bank } from '../types/bank';
import {
  buildClusterTopology,
  isTapeActive,
  parentTapeForChildAttach,
} from './clusterTopology';
import { collectClusterDescendantUuids } from './positioning';

export function wouldCreateAttachmentCycle(
  childUuid: string,
  parentUuid: string,
  bankList: Bank[],
): boolean {
  if (childUuid === parentUuid) return true;
  const descendants = collectClusterDescendantUuids(childUuid, bankList);
  return descendants.has(parentUuid);
}

export function getChildInParentSlot(
  parentUuid: string,
  slot: AttachmentSlaveSlot,
  bankList: Bank[],
): Bank | undefined {
  return bankList.find(
    (bank) =>
      bank.attachedToUuid === parentUuid &&
      bank.attachDirection &&
      slaveSlotForAttach(bank.attachDirection) === slot,
  );
}

export function canAttachBank(
  childUuid: string,
  parentUuid: string,
  attachDirection: AttachDirection,
  bankList: Bank[],
): { ok: true } | { ok: false; reason: string } {
  if (childUuid === parentUuid) {
    return { ok: false, reason: 'Cannot attach a bank to itself.' };
  }

  const child = bankList.find((b) => b.uuid === childUuid);
  const parent = bankList.find((b) => b.uuid === parentUuid);
  if (!child || !parent) {
    return { ok: false, reason: 'Bank not found.' };
  }

  if (wouldCreateAttachmentCycle(childUuid, parentUuid, bankList)) {
    return { ok: false, reason: 'That would create a circular attachment.' };
  }

  const slot = slaveSlotForAttach(attachDirection);
  const occupant = getChildInParentSlot(parentUuid, slot, bankList);
  if (occupant && occupant.uuid !== childUuid) {
    const label = slot === 'right' ? 'horizontal' : 'vertical';
    return {
      ok: false,
      reason: `Parent already has a ${label} attachment (${occupant.name}).`,
    };
  }

  // C15 isTapeActive: parent East/South must be free for exterior attach
  // (e.g. no East on a column bank when an ancestor already has slaveRight).
  const topology = buildClusterTopology(bankList);
  const parentTape = parentTapeForChildAttach(attachDirection);
  if (!isTapeActive(topology, parentUuid, parentTape)) {
    return {
      ok: false,
      reason:
        'That attach face is not available on this bank (C15 cluster rules).',
    };
  }

  return { ok: true };
}