/**
 * Pure bank-drag planning: move-set membership, boundary detach list, undo scope.
 * Canvas / store should call this once at grab instead of re-deriving policy.
 */
import type { Bank } from '../types/bank';
import {
  attachmentCrossesMoveSet,
  banksToDetachForMoveSet,
  buildBankDragMoveSet,
} from './positioning';

export type BankDragPlan = {
  primaryUuid: string;
  /** Banks that translate with the pointer primary. */
  moveSet: Set<string>;
  /** Banks that lose a parent link at grab (boundary cut). */
  detachUuids: string[];
  /**
   * Layout history scope for the whole gesture (movers + orphans).
   * Dock targets should be merged in later via expandOpenUndoGroupUuids.
   */
  undoUuids: string[];
  /**
   * True when the primary was outside the current selection — caller should
   * replace selection with the primary alone before/while applying the plan.
   */
  selectPrimaryOnly: boolean;
};

/**
 * Resolve move set, detach list, and undo uuids for a canvas bank drag grab.
 *
 * - Multi-select: `selected.length ≥ 2` and primary ∈ selection → move selection only.
 * - Otherwise: cluster = primary + attachment descendants.
 * - If primary ∉ selection, plan as sole primary (cluster) and flag `selectPrimaryOnly`.
 */
export function planBankDrag(
  primaryUuid: string,
  bankList: readonly Bank[],
  selectedUuids: readonly string[],
): BankDragPlan {
  const selectPrimaryOnly = !selectedUuids.includes(primaryUuid);
  const selectedForMove = selectPrimaryOnly ? [primaryUuid] : selectedUuids;
  const list = bankList as Bank[];
  const moveSet = buildBankDragMoveSet(primaryUuid, list, selectedForMove);
  const detachUuids = banksToDetachForMoveSet(list, moveSet);
  const undoUuids = [...new Set([...moveSet, ...detachUuids])];

  return {
    primaryUuid,
    moveSet,
    detachUuids,
    undoUuids,
    selectPrimaryOnly,
  };
}

export { attachmentCrossesMoveSet, banksToDetachForMoveSet, buildBankDragMoveSet };
