import type { AttachDirection } from '../types/bank';

/**
 * C15 `attach-direction` names which side **of the child bank** connects to the
 * parent. NonMaps routes horizontal attaches to `slaveRight` and vertical
 * attaches to `slaveBottom` regardless of left/right or top/bottom face.
 *
 * @see Bank.installRelationshipMasterSlave / Bank.layoutSlaves
 */
export type AttachmentSlaveSlot = 'right' | 'bottom';

export function slaveSlotForAttach(
  attachDirection: AttachDirection,
): AttachmentSlaveSlot {
  switch (attachDirection) {
    case 'left':
    case 'right':
      return 'right';
    case 'top':
    case 'bottom':
      return 'bottom';
  }
}

/** @deprecated Use slaveSlotForAttach */
export function placementSideForAttach(
  attachDirection: AttachDirection,
): AttachDirection {
  const slot = slaveSlotForAttach(attachDirection);
  return slot === 'right' ? 'right' : 'bottom';
}