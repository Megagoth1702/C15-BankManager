export type SidebarTab = 'banks' | 'presets';

export const SIDEBAR_WIDTH = {
  default: 224,
  min: 180,
  max: 480,
} as const;

const STORAGE_KEY = 'c15-sidebar-settings';

export interface SidebarSettings {
  widthPx: number;
  tab: SidebarTab;
}

export function clampSidebarWidth(widthPx: number): number {
  return Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, Math.round(widthPx)));
}

export function normalizeSidebarSettings(
  partial: Partial<SidebarSettings> | null | undefined,
): SidebarSettings {
  return {
    widthPx: clampSidebarWidth(partial?.widthPx ?? SIDEBAR_WIDTH.default),
    tab: partial?.tab === 'presets' ? 'presets' : 'banks',
  };
}

export function loadSidebarSettings(): SidebarSettings {
  if (typeof localStorage === 'undefined') {
    return normalizeSidebarSettings(null);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeSidebarSettings(null);
    return normalizeSidebarSettings(JSON.parse(raw) as Partial<SidebarSettings>);
  } catch {
    return normalizeSidebarSettings(null);
  }
}

export function saveSidebarSettings(settings: SidebarSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSidebarSettings(settings)));
}

export function serializeSidebarSettings(settings: SidebarSettings): string {
  return JSON.stringify(normalizeSidebarSettings(settings));
}

export function parseSidebarSettings(json: string): SidebarSettings {
  try {
    return normalizeSidebarSettings(JSON.parse(json) as Partial<SidebarSettings>);
  } catch {
    return normalizeSidebarSettings(null);
  }
}