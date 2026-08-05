<script lang="ts">
  import { tick } from 'svelte';
  import { presetColorFromName } from '../lib/canvas/presetColors';
  import {
    bankMeta,
    banks,
    selectBank,
    selectPreset,
  } from '../lib/model/bankStore';
  import { buildBankForest, flattenBankForest } from '../lib/model/bankTree';
  import {
    buildPresetSearchIndex,
    performPresetSearch,
    type PresetSearchEntry,
    type SortBy,
  } from '../lib/search/presetSearch';
  import {
    pendingFocusPresetSearch,
    presetSearchQuery,
    presetSearchState,
  } from '../lib/search/searchState';
  import { PRESET_COLOR_NAMES } from '../lib/xml/presetAttributes';
  import PresetBrowseList from './PresetBrowseList.svelte';
  import SidebarPresetInfoTooltip from './SidebarPresetInfoTooltip.svelte';

  let showSettings = $state(true);
  let showBankScope = $state(false);
  let infoTooltip = $state<{
    bankName: string;
    comment: string;
    x: number;
    y: number;
  } | null>(null);

  let searchInput: HTMLInputElement | undefined = $state();
  let browseList: {
    navigateFromSearch: (delta: number) => boolean;
    focus: () => void;
  } | undefined = $state();

  const index = $derived(buildPresetSearchIndex($banks));
  /** Single list path: empty query = full filtered browse; non-empty = search hits. */
  const results = $derived(
    performPresetSearch(index, $presetSearchQuery, $presetSearchState),
  );
  const queryActive = $derived($presetSearchQuery.trim().length > 0);

  /** Banks in sidebar tree order for scope multi-select. */
  const banksInOrder = $derived(
    flattenBankForest(buildBankForest([...$banks])).map((node, i) => ({
      uuid: node.bank.uuid,
      name: node.bank.name,
      order: i + 1,
    })),
  );

  const bankScopeLabel = $derived.by(() => {
    const selected = $presetSearchState.bankUuids;
    if (selected.length === 0) return 'All Banks';
    if (selected.length === 1 && selected[0] === '__none__') return 'No banks';
    if (selected.length === 1) {
      const hit = banksInOrder.find((b) => b.uuid === selected[0]);
      return hit ? hit.name : '1 bank';
    }
    return `${selected.length} banks`;
  });

  const isAllBanksScope = $derived($presetSearchState.bankUuids.length === 0);

  /** Anchor for Shift+click range select in the bank-scope list. */
  let lastBankScopeAnchorUuid = $state<string | null>(null);

  function setAllBanksScope(): void {
    lastBankScopeAnchorUuid = null;
    presetSearchState.update((s) => ({ ...s, bankUuids: [] }));
  }

  function setNoBanksScope(): void {
    // Sentinel: non-empty list that matches nothing → empty results (C15 "none").
    // Use a never-present uuid so length > 0.
    lastBankScopeAnchorUuid = null;
    presetSearchState.update((s) => ({
      ...s,
      bankUuids: ['__none__'],
    }));
  }

  function bankScopeIndex(uuid: string): number {
    return banksInOrder.findIndex((b) => b.uuid === uuid);
  }

  function normalizeBankScopeSelection(uuids: string[]): string[] {
    if (uuids.length === 0) return [];
    if (uuids.length === banksInOrder.length) return [];
    return uuids;
  }

  function toggleBankScope(uuid: string): void {
    presetSearchState.update((s) => {
      // Leaving "all" mode: start from empty selection then add this bank.
      if (s.bankUuids.length === 0) {
        return { ...s, bankUuids: [uuid] };
      }
      // Leaving "none" sentinel.
      if (s.bankUuids.length === 1 && s.bankUuids[0] === '__none__') {
        return { ...s, bankUuids: [uuid] };
      }
      const has = s.bankUuids.includes(uuid);
      const next = has
        ? s.bankUuids.filter((id) => id !== uuid)
        : [...s.bankUuids, uuid];
      return { ...s, bankUuids: normalizeBankScopeSelection(next) };
    });
  }

  /** Select inclusive range from anchor → target (adds to current multi-select). */
  function selectBankScopeRange(fromUuid: string, toUuid: string): void {
    const from = bankScopeIndex(fromUuid);
    const to = bankScopeIndex(toUuid);
    if (from < 0 || to < 0) {
      toggleBankScope(toUuid);
      lastBankScopeAnchorUuid = toUuid;
      return;
    }
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const rangeUuids = banksInOrder.slice(lo, hi + 1).map((b) => b.uuid);

    presetSearchState.update((s) => {
      let base: string[];
      if (s.bankUuids.length === 0) {
        // "All" → range becomes the explicit selection (not every bank).
        base = [];
      } else if (s.bankUuids.length === 1 && s.bankUuids[0] === '__none__') {
        base = [];
      } else {
        base = [...s.bankUuids];
      }
      const set = new Set(base);
      for (const id of rangeUuids) set.add(id);
      return { ...s, bankUuids: normalizeBankScopeSelection([...set]) };
    });
  }

  function onBankScopeClick(uuid: string, event: MouseEvent): void {
    if (event.shiftKey && lastBankScopeAnchorUuid) {
      event.preventDefault();
      selectBankScopeRange(lastBankScopeAnchorUuid, uuid);
      // Keep original anchor so further Shift+clicks extend from the same start.
      return;
    }
    toggleBankScope(uuid);
    lastBankScopeAnchorUuid = uuid;
  }

  function isBankInScope(uuid: string): boolean {
    const selected = $presetSearchState.bankUuids;
    if (selected.length === 0) return true;
    if (selected.length === 1 && selected[0] === '__none__') return false;
    return selected.includes(uuid);
  }

  /** Sidebar collapsed → search icon: expand + Presets tab then land focus here. */
  $effect(() => {
    if (!$pendingFocusPresetSearch) return;
    void tick()
      .then(() => tick())
      .then(() => {
        if (!$pendingFocusPresetSearch) return;
        searchInput?.focus();
        pendingFocusPresetSearch.set(false);
      });
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
    searchInput?.blur();
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

  function focusSearchInput(): void {
    searchInput?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent): void {
    if (event.code === 'ArrowDown') {
      // Leave the search field → select first/next visible preset and focus the list.
      if (results.length === 0) return;
      event.preventDefault();
      const moved = browseList?.navigateFromSearch(1) ?? false;
      if (moved) searchInput?.blur();
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      const first = results[0];
      if (first) activate(first.entry);
      return;
    }
    if (event.code === 'Escape') {
      if (queryActive) {
        event.preventDefault();
        presetSearchQuery.set('');
        return;
      }
      searchInput?.blur();
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

    <div class="relative mb-2">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded border px-2 py-1 text-left text-[10px] transition-colors
          {isAllBanksScope
          ? 'border-c15-border text-c15-text-muted hover:border-c15-accent'
          : 'border-c15-accent bg-c15-accent/10 text-c15-accent'}"
        title="Limit search and browse list to selected banks"
        onclick={() => (showBankScope = !showBankScope)}
      >
        <span class="min-w-0 truncate">{bankScopeLabel}</span>
        <span class="shrink-0 opacity-70">{showBankScope ? '▲' : '▼'}</span>
      </button>
      {#if showBankScope}
        <div
          class="absolute left-0 right-0 z-20 mt-1 flex max-h-48 flex-col rounded border border-c15-border bg-c15-surface-raised p-2 shadow-lg"
        >
          <div class="mb-1.5 flex shrink-0 gap-1">
            <button
              type="button"
              class="rounded border border-c15-border px-1.5 py-0.5 text-[10px] text-c15-text hover:border-c15-accent"
              onclick={setAllBanksScope}
            >
              All
            </button>
            <button
              type="button"
              class="rounded border border-c15-border px-1.5 py-0.5 text-[10px] text-c15-text hover:border-c15-accent"
              onclick={setNoBanksScope}
            >
              None
            </button>
          </div>
          {#if banksInOrder.length === 0}
            <p class="text-[10px] text-c15-text-muted">No banks loaded</p>
          {:else}
            <ul class="min-h-0 flex-1 overflow-y-auto flex flex-col select-none">
              {#each banksInOrder as bank (bank.uuid)}
                {@const inScope = isBankInScope(bank.uuid)}
                <li class="-mt-px first:mt-0">
                  <button
                    type="button"
                    class="block w-full min-w-0 truncate border px-1.5 py-px text-left text-[10px] leading-none transition-colors
                      {inScope
                      ? 'relative z-[1] border-c15-accent bg-c15-accent/10 text-c15-text'
                      : 'border-transparent text-c15-text-muted hover:z-[1] hover:border-c15-border hover:bg-c15-surface hover:text-c15-text'}"
                    title={inScope
                      ? `${bank.name} (in search) · Shift+click for range`
                      : `${bank.name} (click to include) · Shift+click for range`}
                    aria-pressed={inScope}
                    onclick={(e) => onBankScopeClick(bank.uuid, e)}
                  >
                    {String(bank.order).padStart(2, '0')} · {bank.name}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

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
          placeholder:text-c15-text-muted focus:border-c15-accent focus:outline-none"
        placeholder="Search presets"
        bind:value={$presetSearchQuery}
        onkeydown={onInputKeyDown}
      />
      {#if $presetSearchQuery}
        <button
          type="button"
          class="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs text-c15-text-muted hover:text-c15-text"
          title="Clear search"
          onclick={() => {
            presetSearchQuery.set('');
          }}
        >
          ×
        </button>
      {/if}
    </div>
  </div>

  {#if $banks.length === 0}
    <div class="flex flex-1 items-center justify-center px-3 py-3">
      <p class="text-center text-xs text-c15-text-muted">Import banks to search presets</p>
    </div>
  {:else}
    <PresetBrowseList
      bind:this={browseList}
      results={results}
      queryActive={queryActive}
      onrowpointerenter={showInfoTooltip}
      onrowpointermove={moveInfoTooltip}
      onrowpointerleave={hideInfoTooltip}
      onrequestfocussearch={focusSearchInput}
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
