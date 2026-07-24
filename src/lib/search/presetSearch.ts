import type { Bank, Preset } from '../types/bank';
import { buildBankForest, flattenBankForest } from '../model/bankTree';

export type SearchOperator = 'and' | 'or';
export type SortBy = 'number' | 'name' | 'time';
export type SortDirection = 'asc' | 'desc';

export interface PresetSearchOptions {
  operator: SearchOperator;
  searchInName: boolean;
  searchInComment: boolean;
  searchInDeviceName: boolean;
  colors: readonly string[];
  bankUuids: readonly string[];
  sortBy: SortBy;
  sortDirection: SortDirection;
}

export interface PresetSearchEntry {
  presetUuid: string;
  bankUuid: string;
  bankName: string;
  bankOrder: number;
  presetIndex: number;
  name: string;
  comment: string;
  deviceName: string;
  color: string;
  storeTime: string;
}

export interface PresetSearchMatchFields {
  name: boolean;
  comment: boolean;
  device: boolean;
}

export interface PresetSearchResult {
  entry: PresetSearchEntry;
  matchedFields: PresetSearchMatchFields;
}

export const DEFAULT_PRESET_SEARCH_OPTIONS: PresetSearchOptions = {
  operator: 'and',
  searchInName: true,
  searchInComment: true,
  searchInDeviceName: false,
  colors: [],
  bankUuids: [],
  sortBy: 'number',
  sortDirection: 'asc',
};

const HASHTAG_RE = /^#\S+/;
const WHITESPACE_RE = /\s+/;

type PresetMatchCb = (entry: PresetSearchEntry) => boolean;

export function buildPresetSearchIndex(banks: readonly Bank[]): PresetSearchEntry[] {
  const forest = buildBankForest([...banks]);
  const ordered = flattenBankForest(forest);
  const bankOrderByUuid = new Map(
    ordered.map((node, index) => [node.bank.uuid, index + 1]),
  );

  const entries: PresetSearchEntry[] = [];
  for (const bank of banks) {
    const bankOrder = bankOrderByUuid.get(bank.uuid) ?? 0;
    const presetsByUuid = new Map(
      bank.presets.map((preset) => [preset.uuid.toLowerCase(), preset]),
    );

    bank.presetOrder.forEach((uuid, index) => {
      const preset = presetsByUuid.get(uuid.toLowerCase());
      if (!preset) return;
      entries.push(toSearchEntry(bank.uuid, bank.name, bankOrder, index + 1, preset));
    });
  }

  return entries;
}

function toSearchEntry(
  bankUuid: string,
  bankName: string,
  bankOrder: number,
  presetIndex: number,
  preset: Preset,
): PresetSearchEntry {
  return {
    presetUuid: preset.uuid,
    bankUuid,
    bankName,
    bankOrder,
    presetIndex,
    name: preset.name,
    comment: preset.comment,
    deviceName: preset.deviceName,
    color: preset.color || 'none',
    storeTime: preset.storeTime,
  };
}

function nameMatchesWord(entry: PresetSearchEntry, word: string): boolean {
  return entry.name.toLowerCase().includes(word);
}

function deviceMatchesWord(entry: PresetSearchEntry, word: string): boolean {
  return Boolean(entry.deviceName) && entry.deviceName.toLowerCase().includes(word);
}

function commentMatchesWord(entry: PresetSearchEntry, word: string): boolean {
  if (!entry.comment) return false;
  const lower = entry.comment.toLowerCase();
  if (HASHTAG_RE.test(word)) {
    return lower.includes(word);
  }
  return lower
    .split(WHITESPACE_RE)
    .some((part) => (HASHTAG_RE.test(part) ? false : part.includes(word)));
}

export function computePresetSearchMatchFields(
  entry: PresetSearchEntry,
  words: readonly string[],
  opt: PresetSearchOptions,
): PresetSearchMatchFields {
  let name = false;
  let comment = false;
  let device = false;

  for (const word of words) {
    if (opt.searchInName && nameMatchesWord(entry, word)) name = true;
    if (opt.searchInDeviceName && deviceMatchesWord(entry, word)) device = true;
    if (opt.searchInComment && commentMatchesWord(entry, word)) comment = true;
  }

  return { name, comment, device };
}

function prepareSearchQuery(query: string[], opt: PresetSearchOptions): PresetMatchCb[] {
  return query.map((word) => {
    const queryCbs: PresetMatchCb[] = [
      ...(opt.searchInName ? [(entry: PresetSearchEntry) => nameMatchesWord(entry, word)] : []),
      ...(opt.searchInDeviceName
        ? [(entry: PresetSearchEntry) => deviceMatchesWord(entry, word)]
        : []),
      ...(opt.searchInComment
        ? [(entry: PresetSearchEntry) => commentMatchesWord(entry, word)]
        : []),
    ];

    return (entry) => (queryCbs.length === 0 ? false : queryCbs.some((cb) => cb(entry)));
  });
}

function prepareSearchFilter(
  colors: readonly string[],
  opt: PresetSearchOptions,
  query: PresetMatchCb[],
): PresetMatchCb {
  const filterCbs: PresetMatchCb[] = [
    (entry) => Boolean(entry.name),
    ...(colors.length > 0
      ? [(entry: PresetSearchEntry) => colors.includes(entry.color)]
      : []),
    ...(query.length > 0 && opt.operator === 'and'
      ? [(entry: PresetSearchEntry) => query.every((cb) => cb(entry))]
      : []),
    ...(query.length > 0 && opt.operator === 'or'
      ? [(entry: PresetSearchEntry) => query.some((cb) => cb(entry))]
      : []),
  ];

  return (entry) => filterCbs.every((cb) => cb(entry));
}

function sortKey(lhs: PresetSearchEntry, rhs: PresetSearchEntry, by: SortBy): number {
  switch (by) {
    case 'number':
      if (lhs.bankOrder !== rhs.bankOrder) return lhs.bankOrder - rhs.bankOrder;
      return lhs.presetIndex - rhs.presetIndex;
    case 'name':
      return lhs.name.localeCompare(rhs.name);
    case 'time':
      if (!lhs.storeTime || !rhs.storeTime) return 0;
      return lhs.storeTime.localeCompare(rhs.storeTime);
  }
}

const EMPTY_MATCH_FIELDS: PresetSearchMatchFields = {
  name: false,
  comment: false,
  device: false,
};

export function performPresetSearch(
  entries: readonly PresetSearchEntry[],
  searchQuery: string,
  options: PresetSearchOptions,
): PresetSearchResult[] {
  const words = searchQuery.trim().toLowerCase().split(WHITESPACE_RE).filter(Boolean);
  const queryCbs = prepareSearchQuery(words, options);
  const filter = prepareSearchFilter(options.colors, options, queryCbs);

  const bankScope =
    options.bankUuids.length > 0 ? new Set(options.bankUuids) : null;

  const dir = options.sortDirection === 'asc' ? 1 : -1;

  return entries
    .filter((entry) => (bankScope ? bankScope.has(entry.bankUuid) : true))
    .filter(filter)
    .sort((lhs, rhs) => dir * sortKey(lhs, rhs, options.sortBy))
    .map((entry) => ({
      entry,
      matchedFields:
        words.length > 0
          ? computePresetSearchMatchFields(entry, words, options)
          : EMPTY_MATCH_FIELDS,
    }));
}

export function formatPresetSearchLabel(entry: PresetSearchEntry): string {
  const bankNum = String(entry.bankOrder).padStart(2, '0');
  const presetNum = String(entry.presetIndex).padStart(3, '0');
  return `${bankNum} - ${presetNum} ${entry.name}`;
}