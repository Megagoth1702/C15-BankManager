import { writable } from 'svelte/store';

export const UI_SCALE = {
  default: 1.25,
  min: 0.75,
  max: 2,
  step: 0.05,
} as const;

const STORAGE_KEY = 'c15-ui-scale';

export const uiScale = writable<number>(UI_SCALE.default);

export function clampUiScale(value: number): number {
  const stepped = Math.round(value / UI_SCALE.step) * UI_SCALE.step;
  return Math.max(UI_SCALE.min, Math.min(UI_SCALE.max, stepped));
}

export function applyUiScaleToDocument(scale: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export function loadUiScale(): number {
  if (typeof localStorage === 'undefined') return UI_SCALE.default;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return UI_SCALE.default;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampUiScale(parsed) : UI_SCALE.default;
  } catch {
    return UI_SCALE.default;
  }
}

export function saveUiScale(scale: number): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(clampUiScale(scale)));
}

export function setUiScale(scale: number): void {
  const clamped = clampUiScale(scale);
  uiScale.set(clamped);
  applyUiScaleToDocument(clamped);
  saveUiScale(clamped);
}

export function initUiScale(): void {
  const scale = loadUiScale();
  uiScale.set(scale);
  applyUiScaleToDocument(scale);
}

export function formatUiScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}