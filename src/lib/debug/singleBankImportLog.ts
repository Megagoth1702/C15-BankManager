import { getCanvasScreenSize, getViewportCenterC15 } from '../canvas/pointerPosition';
import { C15_SCALE, computeWorldBounds } from '../canvas/geometry';
import type { ViewportTransform } from '../canvas/hitTest';
import type { Bank } from '../types/bank';
import { log } from './sessionLog';

const CENTER_THRESHOLD_C15 = 15;
const CENTER_THRESHOLD_SCREEN_PX = 8;

export type SingleBankViewportPhase =
  | 'xml-original'
  | 'after-viewport-placement'
  | 'after-store';

export interface SingleBankViewportCheck {
  phase: SingleBankViewportPhase;
  fileName: string;
  bankName: string;
  viewport: { panX: number; panY: number; zoom: number };
  canvas: { width: number; height: number } | null;
  viewportCenterC15: { x: number; y: number } | null;
  bankBboxCenterC15: { x: number; y: number } | null;
  bankBboxCenterScreen: { x: number; y: number } | null;
  screenCenter: { x: number; y: number } | null;
  deltaC15: { dx: number; dy: number; distance: number } | null;
  deltaScreenPx: { dx: number; dy: number; distance: number } | null;
  centered: boolean;
  notes: string[];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function bankBboxCenters(
  banks: Bank[],
  viewport: ViewportTransform,
  canvas: { width: number; height: number } | null,
): Pick<
  SingleBankViewportCheck,
  'bankBboxCenterC15' | 'bankBboxCenterScreen' | 'screenCenter'
> {
  const bounds = computeWorldBounds(banks);
  if (!bounds) {
    return {
      bankBboxCenterC15: null,
      bankBboxCenterScreen: null,
      screenCenter: canvas ? { x: round(canvas.width / 2), y: round(canvas.height / 2) } : null,
    };
  }

  const worldCenterX = (bounds.minX + bounds.maxX) / 2;
  const worldCenterY = (bounds.minY + bounds.maxY) / 2;

  return {
    bankBboxCenterC15: {
      x: round(worldCenterX / C15_SCALE),
      y: round(worldCenterY / C15_SCALE),
    },
    bankBboxCenterScreen: {
      x: round(viewport.panX + worldCenterX * viewport.zoom),
      y: round(viewport.panY + worldCenterY * viewport.zoom),
    },
    screenCenter: canvas
      ? { x: round(canvas.width / 2), y: round(canvas.height / 2) }
      : null,
  };
}

export function buildSingleBankViewportCheck(
  banks: Bank[],
  viewport: ViewportTransform,
  phase: SingleBankViewportPhase,
  fileName: string,
  canvas: { width: number; height: number } | null,
): SingleBankViewportCheck | null {
  const bank = banks[0];
  if (!bank) return null;

  const viewportCenterC15 = getViewportCenterC15(viewport);
  const centers = bankBboxCenters(banks, viewport, canvas);
  const notes: string[] = [];

  if (!canvas) {
    notes.push('Canvas element not registered — screen-center check unavailable.');
  }
  if (!viewportCenterC15) {
    notes.push('Viewport center (C15) unavailable — canvas may not be mounted yet.');
  }

  let deltaC15: SingleBankViewportCheck['deltaC15'] = null;
  let deltaScreenPx: SingleBankViewportCheck['deltaScreenPx'] = null;
  let centered = false;

  if (viewportCenterC15 && centers.bankBboxCenterC15) {
    const dx = centers.bankBboxCenterC15.x - viewportCenterC15.x;
    const dy = centers.bankBboxCenterC15.y - viewportCenterC15.y;
    deltaC15 = { dx: round(dx), dy: round(dy), distance: round(Math.hypot(dx, dy)) };
  }

  if (centers.bankBboxCenterScreen && centers.screenCenter) {
    const dx = centers.bankBboxCenterScreen.x - centers.screenCenter.x;
    const dy = centers.bankBboxCenterScreen.y - centers.screenCenter.y;
    deltaScreenPx = {
      dx: round(dx),
      dy: round(dy),
      distance: round(Math.hypot(dx, dy)),
    };
  }

  const c15Ok =
    deltaC15 !== null && deltaC15.distance <= CENTER_THRESHOLD_C15;
  const screenOk =
    deltaScreenPx !== null && deltaScreenPx.distance <= CENTER_THRESHOLD_SCREEN_PX;

  if (phase === 'xml-original') {
    centered = false;
    notes.push('Baseline only — bank still at XML coordinates before viewport placement.');
  } else if (deltaScreenPx) {
    centered = screenOk;
    if (centered) {
      notes.push(
        `PASS: bank bbox center is within ${CENTER_THRESHOLD_SCREEN_PX}px of screen center.`,
      );
    } else {
      notes.push(
        `FAIL: bank bbox center is ${deltaScreenPx.distance}px from screen center (threshold ${CENTER_THRESHOLD_SCREEN_PX}px).`,
      );
    }
    if (deltaC15 && !c15Ok) {
      notes.push(
        `C15 delta ${deltaC15.distance} exceeds ${CENTER_THRESHOLD_C15} (snap grid may apply).`,
      );
    }
  } else {
    notes.push('Could not compute screen-center delta.');
  }

  return {
    phase,
    fileName,
    bankName: bank.name,
    viewport: {
      panX: round(viewport.panX),
      panY: round(viewport.panY),
      zoom: round(viewport.zoom),
    },
    canvas: canvas
      ? { width: round(canvas.width), height: round(canvas.height) }
      : null,
    viewportCenterC15: viewportCenterC15
      ? { x: round(viewportCenterC15.x), y: round(viewportCenterC15.y) }
      : null,
    ...centers,
    deltaC15,
    deltaScreenPx,
    centered,
    notes,
  };
}

export function logSingleBankViewportCheck(check: SingleBankViewportCheck): void {
  const tag = check.centered ? 'PASS' : check.phase === 'xml-original' ? 'BASELINE' : 'FAIL';
  log(
    'import',
    `SINGLE_BANK_VIEWPORT [${tag}] ${check.phase}`,
    {
      file: check.fileName,
      bank: check.bankName,
      centered: check.centered,
      viewport: check.viewport,
      canvas: check.canvas,
      viewportCenterC15: check.viewportCenterC15,
      bankBboxCenterC15: check.bankBboxCenterC15,
      bankBboxCenterScreen: check.bankBboxCenterScreen,
      screenCenter: check.screenCenter,
      deltaC15: check.deltaC15,
      deltaScreenPx: check.deltaScreenPx,
      thresholds: {
        c15: CENTER_THRESHOLD_C15,
        screenPx: CENTER_THRESHOLD_SCREEN_PX,
      },
      notes: check.notes,
    },
    check.centered || check.phase === 'xml-original' ? 'info' : 'warn',
  );
}

