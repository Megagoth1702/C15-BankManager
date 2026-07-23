import { BANK_LAYOUT, C15_SCALE } from './geometry';

/**
 * Canvas level-of-detail for bank cards.
 *
 * Full cards mount every preset row (heavy DOM). Lite cards are header+body shells.
 * Below the active full-zoom threshold, banks simplify.
 *
 * Screen row height ≈ presetRowHeight × C15_SCALE × viewport.zoom
 * (cards are laid out in C15×scale, then the world layer is CSS-scaled by zoom).
 */

/** Min on-screen preset row height (CSS px) used for the built-in default threshold. */
export const MIN_FULL_ROW_SCREEN_PX = 12;

/**
 * Default zoom where preset rows become ~MIN_FULL_ROW_SCREEN_PX tall.
 * ≈ 12 / (30 × 0.55) ≈ 0.727. User can change via the Bank detail slider.
 */
export const BANK_LOD_FULL_ZOOM =
  MIN_FULL_ROW_SCREEN_PX / (BANK_LAYOUT.presetRowHeight * C15_SCALE);

/** Hysteresis band so wheel zoom does not thrash full↔lite at the threshold. */
export const BANK_LOD_HYSTERESIS = 0.06;

/**
 * Slider / clamp range for the user-facing bank-detail threshold.
 * Step 0.01 keeps the built-in default (~0.73) without snapping to 0.75.
 */
export const BANK_LOD_THRESHOLD = {
  /** Clean percent default matching the pixel policy (≈73%). */
  default: Math.round(BANK_LOD_FULL_ZOOM * 100) / 100,
  min: 0.25,
  max: 1.5,
  step: 0.01,
} as const;

export type BankLodMode = 'lite' | 'full';
export type BankCardVariant = 'lite' | 'full';

/** Active threshold (module state; keep in sync with appSettings.bankDetailMinZoom). */
let activeFullZoom = BANK_LOD_THRESHOLD.default;

/** Sticky mode for hysteresis across wheel ticks (module-local; reset on tests). */
let stickyLodMode: BankLodMode | null = null;

export function clampBankLodFullZoom(value: number): number {
  if (!Number.isFinite(value)) return BANK_LOD_THRESHOLD.default;
  const stepped =
    Math.round(value / BANK_LOD_THRESHOLD.step) * BANK_LOD_THRESHOLD.step;
  // Avoid float noise (e.g. 0.7300000001).
  const rounded = Math.round(stepped * 100) / 100;
  return Math.max(
    BANK_LOD_THRESHOLD.min,
    Math.min(BANK_LOD_THRESHOLD.max, rounded),
  );
}

export function getBankLodFullZoom(): number {
  return activeFullZoom;
}

/** Drop to lite when zoom falls below this. */
export function getBankLodEnterLiteZoom(): number {
  return activeFullZoom;
}

/** Return to full only after zoom rises past threshold + hysteresis. */
export function getBankLodEnterFullZoom(): number {
  return activeFullZoom + BANK_LOD_HYSTERESIS;
}

/**
 * Set the simplify threshold (viewport zoom). Resets hysteresis so the next
 * mode evaluation uses the new value immediately.
 */
export function setBankLodFullZoom(zoom: number): void {
  const next = clampBankLodFullZoom(zoom);
  if (next === activeFullZoom) return;
  activeFullZoom = next;
  stickyLodMode = null;
}

/** Clear hysteresis (tests, or after intentional full recompute). */
export function resetBankLodHysteresis(): void {
  stickyLodMode = null;
}

/** Absolute mode — no hysteresis (debug labels, unit checks). */
export function bankLodModeAbsolute(viewportZoom: number): BankLodMode {
  return viewportZoom < activeFullZoom ? 'lite' : 'full';
}

/**
 * Sticky LOD with hysteresis around the active threshold.
 * - full → lite when zoom &lt; enterLite
 * - lite → full when zoom ≥ enterFull
 * - first call / after reset: absolute against active threshold
 */
export function bankLodMode(viewportZoom: number): BankLodMode {
  if (stickyLodMode === null) {
    stickyLodMode = bankLodModeAbsolute(viewportZoom);
    return stickyLodMode;
  }

  const enterLite = getBankLodEnterLiteZoom();
  const enterFull = getBankLodEnterFullZoom();

  if (stickyLodMode === 'full' && viewportZoom < enterLite) {
    stickyLodMode = 'lite';
  } else if (stickyLodMode === 'lite' && viewportZoom >= enterFull) {
    stickyLodMode = 'full';
  }

  return stickyLodMode;
}

/** Which card component to mount, or null when off-screen (viewport-culled). */
export function bankCardVariant(
  viewportZoom: number,
  bankUuid: string,
  visibleUuids: ReadonlySet<string>,
): BankCardVariant | null {
  if (visibleUuids.size > 0 && !visibleUuids.has(bankUuid)) return null;
  return bankLodMode(viewportZoom);
}

/** On-screen preset row height at the given viewport zoom (CSS px). */
export function presetRowScreenPx(viewportZoom: number): number {
  return BANK_LAYOUT.presetRowHeight * C15_SCALE * viewportZoom;
}

export function formatBankDetailZoomPercent(zoom: number): string {
  return `${Math.round(clampBankLodFullZoom(zoom) * 100)}%`;
}
