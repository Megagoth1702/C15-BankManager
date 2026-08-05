import { writable } from 'svelte/store';
import {
  DEFAULT_PRESET_SEARCH_OPTIONS,
  type PresetSearchOptions,
} from './presetSearch';

export const presetSearchState = writable<PresetSearchOptions>({
  ...DEFAULT_PRESET_SEARCH_OPTIONS,
});

export const presetSearchQuery = writable('');

/**
 * One-shot: open/focus the sidebar preset search field.
 * Set true before or while Presets tab mounts; PresetSearchBar consumes and clears.
 */
export const pendingFocusPresetSearch = writable(false);

export function requestFocusPresetSearch(): void {
  pendingFocusPresetSearch.set(true);
}