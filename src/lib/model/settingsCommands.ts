import { get } from 'svelte/store';
import { log } from '../debug/sessionLog';
import { saveSidebarSettings, type SidebarTab } from '../ui/sidebarSettings';
import { appSettings } from './bankState';

export function setSidebarTab(tab: SidebarTab): void {
  const width = get(appSettings).sidebarWidthPx;
  appSettings.update((s) => ({ ...s, sidebarTab: tab }));
  saveSidebarSettings({ widthPx: width, tab });
}

export function setShowSynthZone(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showSynthZone: enabled }));
  log('store', 'setShowSynthZone', { enabled });
}

export function setShowDebugShapes(enabled: boolean): void {
  appSettings.update((s) => ({ ...s, showDebugShapes: enabled }));
  log('store', 'setShowDebugShapes', { enabled });
}
