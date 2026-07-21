import { log } from './sessionLog';
import { slaveSlotForAttach } from '../canvas/attachSemantics';
import {
  bankOuterHeight,
  horizontalAttachStep,
  verticalAttachStep,
} from '../canvas/geometry';
import {
  buildBankMap,
  getRecommendedPosition,
  isPositionDeviated,
  POSITIONING,
} from '../model/positioning';
import type { Bank } from '../types/bank';

export interface BankPositionRow {
  name: string;
  uuid: string;
  x: number;
  y: number;
  parentName: string | null;
  attachDirection: string | null;
  recommendedX: number | null;
  recommendedY: number | null;
  deltaX: number | null;
  deltaY: number | null;
  distance: number | null;
  deviated: boolean;
  slaveSlot: string | null;
  parentX: number | null;
  parentY: number | null;
  parentHeight: number | null;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function buildPositionDiagnosticRows(bankList: Bank[]): BankPositionRow[] {
  const byUuid = buildBankMap(bankList);

  return bankList.map((bank) => {
    const parent = bank.attachedToUuid
      ? byUuid.get(bank.attachedToUuid)
      : undefined;
    const recommended = getRecommendedPosition(bank, byUuid);
    const deviated =
      Boolean(bank.attachedToUuid && bank.attachDirection) &&
      isPositionDeviated(bank, byUuid);

    return {
      name: bank.name,
      uuid: bank.uuid,
      x: round(bank.x),
      y: round(bank.y),
      parentName: parent?.name ?? null,
      attachDirection: bank.attachDirection,
      recommendedX: recommended ? round(recommended.x) : null,
      recommendedY: recommended ? round(recommended.y) : null,
      deltaX: recommended ? round(bank.x - recommended.x) : null,
      deltaY: recommended ? round(bank.y - recommended.y) : null,
      distance: recommended
        ? round(Math.hypot(bank.x - recommended.x, bank.y - recommended.y))
        : null,
      deviated,
      slaveSlot: bank.attachDirection
        ? slaveSlotForAttach(bank.attachDirection)
        : null,
      parentX: parent ? round(parent.x) : null,
      parentY: parent ? round(parent.y) : null,
      parentHeight: parent ? bankOuterHeight(parent) : null,
    };
  });
}

export function logPositionSnapshot(
  step: string,
  phase: string,
  bankList: Bank[],
): void {
  const rows = buildPositionDiagnosticRows(bankList);
  log(step, phase, {
    threshold: POSITIONING.deviationThreshold,
    horizontalStep: horizontalAttachStep(),
    verticalStepEmptyBank: verticalAttachStep(
      bankList.find((b) => b.presetOrder.length === 0) ?? bankList[0]!,
    ),
    banks: rows,
  });
}

export function logPositionChanges(
  step: string,
  phase: string,
  before: Bank[],
  after: Bank[],
): void {
  const beforeByUuid = buildBankMap(before);
  const changes = after
    .map((bank) => {
      const prev = beforeByUuid.get(bank.uuid);
      if (!prev) return null;
      const dx = round(bank.x - prev.x);
      const dy = round(bank.y - prev.y);
      if (dx === 0 && dy === 0) return null;
      return {
        name: bank.name,
        uuid: bank.uuid,
        from: { x: round(prev.x), y: round(prev.y) },
        to: { x: round(bank.x), y: round(bank.y) },
        delta: { x: dx, y: dy },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  log(step, phase, {
    changedCount: changes.length,
    changes,
    after: buildPositionDiagnosticRows(after),
  });
}

/** Log import heal / realign decision for one attached child. */
export function logAttachPositionDecision(
  step: string,
  action: 'import-heal-skip' | 'import-heal-apply' | 'realign-apply',
  child: Bank,
  parent: Bank,
  before: { x: number; y: number },
  after: { x: number; y: number },
): void {
  const byUuid = buildBankMap([parent, child]);
  const recommended = getRecommendedPosition(child, byUuid);
  log(step, action, {
    child: child.name,
    parent: parent.name,
    attachDirection: child.attachDirection,
    slaveSlot: child.attachDirection
      ? slaveSlotForAttach(child.attachDirection)
      : null,
    before: { x: round(before.x), y: round(before.y) },
    after: { x: round(after.x), y: round(after.y) },
    recommended: recommended
      ? { x: round(recommended.x), y: round(recommended.y) }
      : null,
    parentPos: { x: round(parent.x), y: round(parent.y) },
    parentHeight: bankOuterHeight(parent),
    distanceBefore: recommended
      ? round(Math.hypot(before.x - recommended.x, before.y - recommended.y))
      : null,
  });
}