export type SidebarTab = 'banks' | 'presets';

/** Banks tab list sort; `none` = attachment parent–child tree. */
export type BankSidebarSortBy =
  | 'none'
  | 'name'
  | 'lastChanged'
  | 'importDate'
  | 'exportDate'
  | 'id';
export type BankSidebarSortDirection = 'asc' | 'desc';

export const SIDEBAR_WIDTH = {
  default: 224,
  min: 180,
  max: 480,
} as const;

const STORAGE_KEY = 'c15-sidebar-settings';

const BANK_SORT_BY_VALUES = new Set<BankSidebarSortBy>([
  'none',
  'name',
  'lastChanged',
  'importDate',
  'exportDate',
  'id',
]);

export interface SidebarSettings {
  widthPx: number;
  tab: SidebarTab;
  /** When true, Banks/Presets panel is hidden; width is kept for expand. */
  collapsed: boolean;
  /** Banks tab sort mode (survives tab switches and remounts). */
  bankSortBy: BankSidebarSortBy;
  bankSortDirection: BankSidebarSortDirection;
}

export function clampSidebarWidth(widthPx: number): number {
  return Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, Math.round(widthPx)));
}

function normalizeBankSortBy(value: unknown): BankSidebarSortBy {
  return typeof value === 'string' && BANK_SORT_BY_VALUES.has(value as BankSidebarSortBy)
    ? (value as BankSidebarSortBy)
    : 'none';
}

function normalizeBankSortDirection(value: unknown): BankSidebarSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

export function normalizeSidebarSettings(
  partial: Partial<SidebarSettings> | null | undefined,
): SidebarSettings {
  return {
    widthPx: clampSidebarWidth(partial?.widthPx ?? SIDEBAR_WIDTH.default),
    tab: partial?.tab === 'presets' ? 'presets' : 'banks',
    collapsed: partial?.collapsed === true,
    bankSortBy: normalizeBankSortBy(partial?.bankSortBy),
    bankSortDirection: normalizeBankSortDirection(partial?.bankSortDirection),
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

/** Merge a partial update into stored settings (preserves fields not passed). */
export function updateSidebarSettings(partial: Partial<SidebarSettings>): SidebarSettings {
  const next = normalizeSidebarSettings({ ...loadSidebarSettings(), ...partial });
  saveSidebarSettings(next);
  return next;
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
