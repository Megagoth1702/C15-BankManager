import type { Bank } from '../types/bank';

/**
 * Canvas layout constants — aligned with NonMaps `Bank.java` / `Label.java`.
 * XML x/y are outer bank origins (include 40-unit tape margin on each side).
 *
 * @see projects/web/static/nonmaps/.../bank/Bank.java
 */

/**
 * Screen pixels per C15 coordinate unit at viewport zoom 100%.
 * Does not change XML/layout math — only how large banks appear on screen.
 * NonMaps uses dynamic zoom; we pick a comfortable default for ~130px bank width.
 */
export const C15_SCALE = 0.55;

/** NonMaps layout units (same coordinate space as bank `<x>` / `<y>`). */
export const BANK_LAYOUT = {
  /** Inner card body width (`Label.getNonWidth`). */
  innerWidth: 180,
  /** Attachment tape margin per side (`Bank.getAttachArea`). */
  tapeSize: 40,
  /** Drawn tape strip width (`Bank.getVisibleAttachArea`). */
  visibleAttachArea: 20,
  /** Gap between attached bank bodies (`Bank.getSlaveDistance`). */
  slaveDistance: 30,
  /** Canvas snap grid (`PresetManager.getSnapGridResolution`). */
  snapGrid: 15,
  headerHeight: 30,
  presetRowHeight: 30,
  /** Inner content margin (`Bank.getXMargin` / `getYMargin`). */
  innerMargin: 2,
  /** Visible body border (`Bank.draw` → `drawRoundedRect` stroke). */
  bodyBorderWidth: 3,
  /** Top corner radius on header/body (`Header` / `Bank.draw`). */
  bodyCornerRadiusTop: 6,
  /** Preset number column (`preset.Number` layout width). */
  presetNumberWidth: 32.5,
  /** Header label font height (`Header.getFontHeight`). */
  headerFontHeight: 20,
  /** Body rows shown when `preset-order` is empty (`EmptyLabel` in NonMaps). */
  emptyBankBodyRows: 1,
};

/**
 * Proximity helpers for **synth border snap** (`borderSnapHitTest`).
 * Bank–bank docking uses attach-corridor rectangle overlap instead
 * (`attachCorridors` + `dockHitTest`) and does not read these fields.
 */
export const DOCK_DETECTION = {
  /** Centered band (fraction of outer/placement span) for perpendicular alignment. */
  alignBandRatio: 0.5,
  /** Max separation to a synth border edge (C15 units). */
  proximityThreshold: BANK_LAYOUT.tapeSize * 0.75,
  /** Max penetration past a facing edge (fraction of smaller bank width/height). */
  maxOverlapRatio: 0.85,
  /** Min overlap on perpendicular axis within the align band. */
  minAlignOverlap: BANK_LAYOUT.headerHeight * 0.5,
};

/** Outer bank width: inner 180 + tapes 40×2 = 260. */
export function bankOuterWidth(): number {
  return BANK_LAYOUT.innerWidth + 2 * BANK_LAYOUT.tapeSize;
}

/** Full logical outer box at stored/display origin (XML placement). */
export function bankOuterRectAt(
  originX: number,
  originY: number,
  bank: Bank,
): { x: number; y: number; width: number; height: number } {
  return {
    x: originX,
    y: originY,
    width: bankOuterWidth(),
    height: bankOuterHeight(bank),
  };
}

/**
 * Visible flush chrome on canvas — fills effective placement span (240/255) from `bank.x`,
 * inset by top tape only. West/east attach strips sit outside this width.
 */
export function bankChromeRectAt(
  originX: number,
  originY: number,
  bank: Bank,
): { x: number; y: number; width: number; height: number } {
  return {
    x: originX,
    y: originY + BANK_LAYOUT.tapeSize,
    width: effectiveFacingWidth(bank),
    height: bankInnerBodyHeight(bank),
  };
}

/** Effective east/west placement span from stored origin (WidthCalib 240/255). */
export function bankPlacementRectAt(
  originX: number,
  originY: number,
  bank: Bank,
): { x: number; y: number; width: number; height: number } {
  return {
    x: originX,
    y: originY,
    width: effectiveFacingWidth(bank),
    height: bankOuterHeight(bank),
  };
}

/** C15 grid placement span east/west from `bank.x` (WidthCalib hardware). */
export function effectiveFacingWidth(bank: Bank): number {
  const emptySpan = bankOuterWidth() - BANK_LAYOUT.visibleAttachArea;
  return bank.presetOrder.length > 0
    ? emptySpan + BANK_LAYOUT.snapGrid
    : emptySpan;
}

/**
 * C15 painted chrome width — can extend east past placement (border stroke / preset row).
 * Attach math uses {@link effectiveFacingWidth}; cards draw this width.
 */
export function visualPaintedWidth(bank: Bank): number {
  const placement = effectiveFacingWidth(bank);
  if (bank.presetOrder.length === 0) return placement;
  return placement + BANK_LAYOUT.bodyBorderWidth;
}

/**
 * Horizontal origin step for left/right attaches — matches persisted backup XML
 * (e.g. NL Percussion → NL Mallets ΔX=270), not the tighter live `layoutSlaves` offset.
 */
export function horizontalAttachStep(): number {
  return (
    bankOuterWidth() +
    BANK_LAYOUT.slaveDistance -
    BANK_LAYOUT.visibleAttachArea
  );
}

/**
 * NonMaps outer-box `layoutSlaves` step (slave-right). Positions outer origins when
 * visible chrome is inset by tape — not used for flush 240/255 chrome from `bank.x`.
 * Empty parent → 190; preset parent → 205.
 */
export function layoutSlavesHorizontalStep(parent: Bank): number {
  return (
    effectiveFacingWidth(parent) -
    2 * BANK_LAYOUT.tapeSize +
    BANK_LAYOUT.slaveDistance
  );
}

/** Gap between parent flush chrome east edge and child flush chrome west edge. */
export function chromeGapAfterParent(parent: Bank): number {
  return (
    BANK_LAYOUT.slaveDistance +
    (parent.presetOrder.length > 0 ? 0 : BANK_LAYOUT.snapGrid)
  );
}

/**
 * Display horizontal step when flush chrome spans `effectiveFacingWidth` from `bank.x`.
 * Preset parent → +285 (30-unit gap); empty parent → +285 (45-unit gap).
 */
export function layoutSlavesChromeHorizontalStep(parent: Bank): number {
  return effectiveFacingWidth(parent) + chromeGapAfterParent(parent);
}

/**
 * Live on-screen vertical step — NonMaps `Bank.layoutSlaves()` for slave-bottom.
 */
export function layoutSlavesVerticalStep(bank: Bank): number {
  return (
    bankOuterHeight(bank) -
    2 * BANK_LAYOUT.tapeSize +
    BANK_LAYOUT.slaveDistance
  );
}

/**
 * Vertical origin step for top/bottom attaches — matches persisted XML
 * (e.g. horizontal attach ΔX≈270 on `Test Bank With A Preset.nlbackup`).
 */
export function verticalAttachStep(bank: Bank): number {
  return (
    bankOuterHeight(bank) +
    BANK_LAYOUT.slaveDistance -
    BANK_LAYOUT.visibleAttachArea
  );
}

/** Preset rows driving body height (empty banks still show one “- empty -” row). */
export function bankBodyRowCount(bank: Bank): number {
  const slots = presetSlotCount(bank);
  return slots > 0 ? slots : BANK_LAYOUT.emptyBankBodyRows;
}

/** Inner card body height (header + preset rows; excludes tape margins). */
export function bankInnerBodyHeight(bank: Bank): number {
  return (
    BANK_LAYOUT.headerHeight +
    bankBodyRowCount(bank) * BANK_LAYOUT.presetRowHeight
  );
}

/** Outer bank height: tapes + inner body (no prev/next bar in this app). */
export function bankOuterHeight(bank: Bank): number {
  return 2 * BANK_LAYOUT.tapeSize + bankInnerBodyHeight(bank);
}

/** Outer height for a new empty bank (header + “- empty -” row). */
export function emptyBankOuterHeight(): number {
  return (
    2 * BANK_LAYOUT.tapeSize +
    BANK_LAYOUT.headerHeight +
    BANK_LAYOUT.emptyBankBodyRows * BANK_LAYOUT.presetRowHeight
  );
}

/** @deprecated Use bankOuterWidth — kept for older call sites. */
export const BANK_LAYOUT_WIDTH = bankOuterWidth();

/** Number of preset slots (= vertical extent driver). Uses preset-order length. */
export function presetSlotCount(bank: Bank): number {
  return bank.presetOrder.length;
}

/** @deprecated Use bankOuterHeight */
export function bankCardHeightUnits(bank: Bank): number {
  return bankOuterHeight(bank);
}

export function bankToWorldRect(bank: Bank): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return bankToWorldRectAt(bank, bank.x, bank.y);
}

export function bankToWorldRectAt(
  bank: Bank,
  originX: number,
  originY: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: originX * C15_SCALE,
    y: originY * C15_SCALE,
    width: bankOuterWidth() * C15_SCALE,
    height: bankOuterHeight(bank) * C15_SCALE,
  };
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeWorldBounds(banks: Bank[]): WorldBounds | null {
  return computeWorldBoundsAt(banks, (bank) => ({ x: bank.x, y: bank.y }));
}

export function computeWorldBoundsAt(
  banks: Bank[],
  originFor: (bank: Bank) => { x: number; y: number },
): WorldBounds | null {
  if (banks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const bank of banks) {
    const origin = originFor(bank);
    const rect = bankToWorldRectAt(bank, origin.x, origin.y);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return { minX, minY, maxX, maxY };
}

/** @deprecated Use presetSlotCount */
export const visibleSlotCount = presetSlotCount;