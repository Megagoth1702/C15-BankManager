import { emptyBankOuterHeight } from '../canvas/geometry';
import { snapToGrid } from '../model/bankFactory';
import { getSynthNoGoRect, LAYOUT_BANDS } from './noGoZones';

/** C15 effective flush spans from WidthCalib hardware fixtures. */
export const WIDTH_CALIB_SPANS = {
  empty: 240,
  preset: 255,
} as const;

export type WidthCalibRulerId = 'span-240' | 'span-255';

export interface WidthCalibRuler {
  id: WidthCalibRulerId;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

const STORAGE_KEY = 'c15-width-calib-rulers';

export function defaultWidthCalibRulers(): WidthCalibRuler[] {
  const noGo = getSynthNoGoRect();
  const x = snapToGrid(noGo.x + noGo.width + LAYOUT_BANDS.synthMargin);
  const y = snapToGrid(noGo.y);
  const h = emptyBankOuterHeight();
  const gap = LAYOUT_BANDS.synthMargin;

  return [
    {
      id: 'span-240',
      label: '240',
      width: WIDTH_CALIB_SPANS.empty,
      height: h,
      x,
      y,
    },
    {
      id: 'span-255',
      label: '255',
      width: WIDTH_CALIB_SPANS.preset,
      height: h,
      x,
      y: snapToGrid(y + h + gap),
    },
  ];
}

export function loadWidthCalibRulers(): WidthCalibRuler[] {
  if (typeof localStorage === 'undefined') return defaultWidthCalibRulers();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWidthCalibRulers();
    const parsed = JSON.parse(raw) as WidthCalibRuler[];
    if (!Array.isArray(parsed) || parsed.length !== 2) return defaultWidthCalibRulers();
    return parsed.map((r) => ({
      ...r,
      x: snapToGrid(r.x),
      y: snapToGrid(r.y),
    }));
  } catch {
    return defaultWidthCalibRulers();
  }
}

export function saveWidthCalibRulers(rulers: WidthCalibRuler[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rulers));
  } catch {
    /* ignore quota */
  }
}

export function resetWidthCalibRulers(): WidthCalibRuler[] {
  const defaults = defaultWidthCalibRulers();
  saveWidthCalibRulers(defaults);
  return defaults;
}