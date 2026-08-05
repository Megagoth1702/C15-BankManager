import { get } from 'svelte/store';
import {
  clampBankLodFullZoom,
  setBankLodFullZoom,
} from '../canvas/lod';
import { log } from '../debug/sessionLog';
import {
  updateSidebarSettings,
  type SidebarTab,
} from '../ui/sidebarSettings';
import { appSettings } from './bankState';

export function setSidebarTab(tab: SidebarTab): void {
  const current = get(appSettings);
  // Avoid settings store + localStorage write when already on this tab (hot path: preset drag start).
  if (current.sidebarTab === tab) return;
  const width = current.sidebarWidthPx;
  appSettings.update((s) => ({ ...s, sidebarTab: tab }));
  // Merge so bank sort (and collapsed) are not wiped on tab switch from canvas selection.
  updateSidebarSettings({ widthPx: width, tab });
}

export function setShowSynthZone(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showSynthZone: enabled }));
  log('store', 'setShowSynthZone', { enabled });
}

export function setShowDebugShapes(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showDebugShapes: enabled }));
  log('store', 'setShowDebugShapes', { enabled });
}

/** Canvas zoom threshold: banks simplify (lite cards) below this zoom. */
export function setBankDetailMinZoom(zoom: number): void {
  const clamped = clampBankLodFullZoom(zoom);
  appSettings.update((s) => ({ ...s, bankDetailMinZoom: clamped }));
  setBankLodFullZoom(clamped);
  log('store', 'setBankDetailMinZoom', { zoom: clamped });
}
