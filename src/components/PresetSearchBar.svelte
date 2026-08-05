<script lang="ts">
  import { tick } from 'svelte';
  import { presetColorFromName } from '../lib/canvas/presetColors';
  import {
    bankMeta,
    banks,
    cancelRenamePreset,
    renamePreset,
    selectBank,
    selectPreset,
  } from '../lib/model/bankStore';
  import {
    buildPresetSearchIndex,
    formatPresetSearchLabel,
    performPresetSearch,
    type PresetSearchEntry,
    type SortBy,
  } from '../lib/search/presetSearch';
  import { presetSearchQuery, presetSearchState } from '../lib/search/searchState';
  import { PRESET_COLOR_NAMES } from '../lib/xml/presetAttributes';
  import PresetBrowseList from './PresetBrowseList.svelte';
  import PresetSearchMatchBadges from './PresetSearchMatchBadges.svelte';
  import SidebarPresetInfoTooltip from './SidebarPresetInfoTooltip.svelte';
  import { focusRenameInput } from '../lib/ui/focusRenameInput';

  let showSettings = $state(true);
  let inputFocused = $state(false);
  let dropdownFocused = $state(false);
  let highlightIndex = $state(0);
  let presetRenameDraft = $state('');
  let infoTooltip = $state<{
    bankName: string;
    comment: string;
    x: number;
    y: number;
  } | null>(null);

  let searchInput: HTMLInputElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();

  const index = $derived(buildPresetSearchIndex($banks));
  const results = $derived(
    performPresetSearch(index, $presetSearchQuery, $presetSearchState),
  );

  const browseResults = $derived(
    performPresetSearch(index, '', $presetSearchState).map((result) => result.entry),
  );

  const showDropdown = $derived(
    $presetSearchQuery.trim().length > 0 && (inputFocused || dropdownFocused),
  );

  $effect(() => {
    $presetSearchQuery;
    $presetSearchState;
    highlightIndex = 0;
  });

  $effect(() => {
    if (!showDropdown || results.length === 0) return;
    const idx = highlightIndex;
    void tick().then(() => scrollHighlightIntoView(idx));
  });

  function scrollHighlightIntoView(index: number): void {
    if (!dropdownEl) return;
    const item = dropdownEl.querySelector<HTMLElement>(`[data-highlight-index="${index}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }

  $effect(() => {
    const target = $bankMeta.renamingPreset;
    if (!target || $bankMeta.renameSurface !== 'sidebar') return;
    const bank = $banks.find((b) => b.uuid === target.bankUuid);
    const preset = bank?.presets.find(
      (p) => p.uuid.toLowerCase() === target.presetUuid.toLowerCase(),
    );
    if (preset) presetRenameDraft = preset.name;
  });

  function toggleColor(color: string): void {
    presetSearchState.update((s) => {
      const colors = s.colors.includes(color)
        ? s.colors.filter((c) => c !== color)
        : [...s.colors, color];
      return { ...s, colors };
    });
  }

  function setSort(by: SortBy): void {
    presetSearchState.update((s) => {
      if (s.sortBy === by) {
        return {
          ...s,
          sortDirection: s.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      }
      return { ...s, sortBy: by, sortDirection: 'asc' };
    });
  }

  function activate(entry: PresetSearchEntry): void {
    hideInfoTooltip();
    selectBank(entry.bankUuid, 'replace', 'sidebar');
    selectPreset(entry.bankUuid, entry.presetUuid, { surface: 'sidebar' });
    bankMeta.update((m) => ({
      ...m,
      focusBankUuid: entry.bankUuid,
      focusPresetUuid: entry.presetUuid,
    }));
    dropdownFocused = false;
    inputFocused = false;
    searchInput?.blur();
  }

  function commitPresetRename(entry: PresetSearchEntry): void {
    const target = $bankMeta.renamingPreset;
    if (
      !target ||
      $bankMeta.renameSurface !== 'sidebar' ||
      target.presetUuid !== entry.presetUuid
    ) {
      return;
    }
    if (presetRenameDraft.trim() === entry.name) {
      cancelRenamePreset();
      return;
    }
    renamePreset(entry.bankUuid, entry.presetUuid, presetRenameDraft);
  }

  function isRenamingEntry(entry: PresetSearchEntry): boolean {
    const target = $bankMeta.renamingPreset;
    return (
      $bankMeta.renameSurface === 'sidebar' &&
      target?.bankUuid === entry.bankUuid &&
      target?.presetUuid === entry.presetUuid
    );
  }

  function entryHasComment(entry: PresetSearchEntry): boolean {
    return entry.comment.trim().length > 0;
  }

  function showInfoTooltip(entry: PresetSearchEntry, event: PointerEvent): void {
    infoTooltip = {
      bankName: entry.bankName,
      comment: entry.comment,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function moveInfoTooltip(event: PointerEvent): void {
    if (!infoTooltip) return;
    infoTooltip = {
      ...infoTooltip,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function hideInfoTooltip(): void {
    infoTooltip = null;
  }

  function onInputKeyDown(event: KeyboardEvent): void {
    if (event.code === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      dropdownFocused = true;
      highlightIndex = 0;
      queueMicrotask(() => dropdownEl?.focus());
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      const result = results[highlightIndex] ?? results[0];
      if (result) activate(result.entry);
      return;
    }
    if (event.code === 'Escape') {
      dropdownFocused = false;
      inputFocused = false;
    }
  }

  function onDropdownKeyDown(event: KeyboardEvent): void {
    if (results.length === 0) return;
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      highlightIndex = Math.min(results.length - 1, highlightIndex + 1);
    } else if (event.code === 'ArrowUp') {
      event.preventDefault();
      if (highlightIndex <= 0) {
        dropdownFocused = false;
        searchInput?.focus();
        return;
      }
      highlightIndex = highlightIndex - 1;
    } else if (event.code === 'Enter') {
      event.preventDefault();
      const result = results[highlightIndex];
      if (result) activate(result.entry);
    } else if (event.code === 'Escape') {
      event.preventDefault();
      dropdownFocused = false;
      searchInput?.focus();
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="shrink-0 border-b border-c15-border px-3 py-2">
    <div class="mb-2 flex items-center gap-1">
      {#each PRESET_COLOR_NAMES.filter((c) => c !== 'none') as color (color)}
        {@const rgb = presetColorFromName(color)}
        <button
          type="button"
          title={color}
          class="h-4 w-4 rounded-sm border transition-transform
            {$presetSearchState.colors.includes(color)
            ? 'scale-110 border-white ring-1 ring-c15-accent'
            : 'border-c15-border/60 opacity-70 hover:opacity-100'}"
          style:background-color={rgb ?? 'transparent'}
          onclick={() => toggleColor(color)}
        ></button>
      {/each}
      <button
        type="button"
        class="ml-auto rounded border border-c15-accent px-1.5 py-0.5 text-[13px] leading-none text-c15-accent
          hover:bg-c15-accent/15 hover:text-c15-accent
          {showSettings ? 'bg-c15-accent/10' : ''}"
        title="Search settings"
        onclick={() => {
          showSettings = !showSettings;
        }}
      >
        ⚙
      </button>
    </div>

    {#if showSettings}
      <div class="mb-2 space-y-2 rounded border border-c15-border/60 bg-c15-bg px-2 py-2 text-[10px]">
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1 text-c15-text-muted">
            <input
              type="radio"
              name="search-op"
              checked={$presetSearchState.operator === 'and'}
              onchange={() => presetSearchState.update((s) => ({ ...s, operator: 'and' }))}
            />
            And
          </label>
          <label class="flex items-center gap-1 text-c15-text-muted">
            <input
              type="radio"
              name="search-op"
              checked={$presetSearchState.operator === 'or'}
              onchange={() => presetSearchState.update((s) => ({ ...s, operator: 'or' }))}
            />
            Or
          </label>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          <label class="flex items-center gap-1 text-c15-text">
            <input
              type="checkbox"
              checked={$presetSearchState.searchInName}
              onchange={(e) =>
                presetSearchState.update((s) => ({
                  ...s,
                  searchInName: e.currentTarget.checked,
                }))}
            />
            Name
          </label>
          <label class="flex items-center gap-1 text-c15-text">
            <input
              type="checkbox"
              checked={$presetSearchState.searchInComment}
              onchange={(e) =>
                presetSearchState.update((s) => ({
                  ...s,
                  searchInComment: e.currentTarget.checked,
                }))}
            />
            Comment
          </label>
          <label class="flex items-center gap-1 text-c15-text">
            <input
              type="checkbox"
              checked={$presetSearchState.searchInDeviceName}
              onchange={(e) =>
                presetSearchState.update((s) => ({
                  ...s,
                  searchInDeviceName: e.currentTarget.checked,
                }))}
            />
            Device
          </label>
        </div>
      </div>
    {/if}

    <div class="mb-2 flex items-center gap-1 text-[10px]">
      <button
        type="button"
        class="rounded border px-1.5 py-0.5
          {$presetSearchState.sortBy === 'number'
          ? 'border-c15-accent text-c15-accent'
          : 'border-c15-border text-c15-text-muted'}"
        title={$presetSearchState.sortBy === 'number'
          ? `Sort by bank / preset number (${$presetSearchState.sortDirection === 'asc' ? 'low → high' : 'high → low'}). Click again to reverse.`
          : 'Sort by bank / preset number. Click again to reverse order.'}
        onclick={() => setSort('number')}
      >
        # {$presetSearchState.sortBy === 'number' ? ($presetSearchState.sortDirection === 'asc' ? '↑' : '↓') : ''}
      </button>
      <button
        type="button"
        class="rounded border px-1.5 py-0.5
          {$presetSearchState.sortBy === 'name'
          ? 'border-c15-accent text-c15-accent'
          : 'border-c15-border text-c15-text-muted'}"
        title={$presetSearchState.sortBy === 'name'
          ? `Sort by preset name (${$presetSearchState.sortDirection === 'asc' ? 'A → Z' : 'Z → A'}). Click again to reverse.`
          : 'Sort by preset name. Click again to reverse order.'}
        onclick={() => setSort('name')}
      >
        A {$presetSearchState.sortBy === 'name' ? ($presetSearchState.sortDirection === 'asc' ? '↑' : '↓') : ''}
      </button>
      <button
        type="button"
        class="rounded border px-1.5 py-0.5
          {$presetSearchState.sortBy === 'time'
          ? 'border-c15-accent text-c15-accent'
          : 'border-c15-border text-c15-text-muted'}"
        title={$presetSearchState.sortBy === 'time'
          ? `Sort by store time (${$presetSearchState.sortDirection === 'asc' ? 'oldest → newest' : 'newest → oldest'}). Click again to reverse.`
          : 'Sort by store time. Click again to reverse order.'}
        onclick={() => setSort('time')}
      >
        T {$presetSearchState.sortBy === 'time' ? ($presetSearchState.sortDirection === 'asc' ? '↑' : '↓') : ''}
      </button>
    </div>

    <div class="relative">
      <input
        bind:this={searchInput}
        type="text"
        class="w-full rounded border border-c15-border bg-c15-bg px-2 py-1.5 pr-7 text-xs text-c15-text
          placeholder:text-c15-text-muted focus:border-c15-accent focus:outline-none
          {showDropdown ? 'rounded-b-none border-b-transparent' : ''}"
        placeholder="Search presets"
        bind:value={$presetSearchQuery}
        onfocus={() => {
          inputFocused = true;
        }}
        onblur={() => {
          inputFocused = false;
        }}
        onkeydown={onInputKeyDown}
      />
      {#if $presetSearchQuery}
        <button
          type="button"
          class="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs text-c15-text-muted hover:text-c15-text"
          onclick={() => {
            presetSearchQuery.set('');
          }}
        >
          ×
        </button>
      {/if}

      {#if showDropdown}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          bind:this={dropdownEl}
          role="listbox"
          tabindex="0"
          class="absolute left-0 right-0 top-full z-20 max-h-56 overflow-y-auto rounded-b border border-t-0
            border-c15-accent/60 bg-c15-surface-raised shadow-lg outline-none"
          onfocus={() => {
            dropdownFocused = true;
          }}
          onblur={() => {
            dropdownFocused = false;
          }}
          onkeydown={onDropdownKeyDown}
        >
          {#if results.length === 0}
            <div class="px-3 py-2 text-xs text-c15-text-muted">No matching presets</div>
          {:else}
            <ul class="py-1">
              {#each results as result, i (result.entry.presetUuid)}
                {@const entry = result.entry}
                {@const tag = presetColorFromName(entry.color)}
                {@const renaming = isRenamingEntry(entry)}
                {@const comment = entryHasComment(entry)}
                <li data-highlight-index={i}>
                  {#if renaming}
                    <div class="flex items-stretch px-2 py-1">
                      <span
                        class="w-1 shrink-0 self-stretch"
                        style:background-color={tag ?? 'transparent'}
                      ></span>
                      <input
                        use:focusRenameInput
                        type="text"
                        class="min-w-0 flex-1 rounded border border-c15-accent bg-c15-bg px-1 py-0.5 text-xs text-c15-text outline-none"
                        bind:value={presetRenameDraft}
                        onkeydown={(e) => {
                          e.stopPropagation();
                          if (e.code === 'Enter') {
                            e.preventDefault();
                            commitPresetRename(entry);
                          } else if (e.code === 'Escape') {
                            e.preventDefault();
                            cancelRenamePreset();
                          }
                        }}
                        onblur={() => commitPresetRename(entry)}
                      />
                    </div>
                  {:else}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlightIndex}
                      class="relative flex w-full items-stretch text-left text-xs transition-colors
                        {i === highlightIndex
                        ? 'bg-c15-preset-selected text-c15-text'
                        : 'text-c15-text hover:bg-c15-surface'}"
                      onmousedown={(e) => e.preventDefault()}
                      onclick={() => activate(entry)}
                      onpointerenter={(e) => showInfoTooltip(entry, e)}
                      onpointermove={moveInfoTooltip}
                      onpointerleave={hideInfoTooltip}
                    >
                      <span
                        class="w-1 shrink-0"
                        style:background-color={tag ?? 'transparent'}
                      ></span>
                      <span class="min-w-0 flex-1 truncate px-2 py-1.5">
                        {formatPresetSearchLabel(entry)}
                      </span>
                      <PresetSearchMatchBadges
                        matched={result.matchedFields}
                        highlighted={i === highlightIndex}
                      />
                      {#if comment}
                        <span
                          class="pointer-events-none shrink-0 self-center pr-1.5 text-[10px] font-bold leading-none text-yellow-400"
                          aria-hidden="true"
                        >
                          C
                        </span>
                      {/if}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="border-t border-c15-border/60 px-3 py-1 text-[10px] text-c15-text-muted">
            Results: {results.length} · N/C/D = name/comment/device · ↓ enter list · Enter go to preset
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if $banks.length === 0}
    <div class="flex flex-1 items-center justify-center px-3 py-3">
      <p class="text-center text-xs text-c15-text-muted">Import banks to search presets</p>
    </div>
  {:else}
    <PresetBrowseList
      entries={browseResults}
      onrowpointerenter={showInfoTooltip}
      onrowpointermove={moveInfoTooltip}
      onrowpointerleave={hideInfoTooltip}
    />
  {/if}
</div>

{#if infoTooltip}
  <SidebarPresetInfoTooltip
    bankName={infoTooltip.bankName}
    comment={infoTooltip.comment}
    x={infoTooltip.x}
    y={infoTooltip.y}
  />
{/if}