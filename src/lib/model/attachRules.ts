import { slaveSlotForAttach, type AttachmentSlaveSlot } from '../canvas/attachSemantics';
import type { AttachDirection, Bank } from '../types/bank';
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

  return { ok: true };
}