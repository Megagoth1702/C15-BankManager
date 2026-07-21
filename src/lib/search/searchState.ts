import { writable } from 'svelte/store';
import {
  DEFAULT_PRESET_SEARCH_OPTIONS,
  type PresetSearchOptions,
} from './presetSearch';

export const presetSearchState = writable<PresetSearchOptions>({
  ...DEFAULT_PRESET_SEARCH_OPTIONS,
});

export const presetSearchQuery = writable('');