<script lang="ts">
  import { tick } from 'svelte';
  import { presetColorFromName } from '../lib/canvas/presetColors';
  import { focusRenameInput } from '../lib/ui/focusRenameInput';
  import {
    bankMeta,
    cancelRenamePreset,
    renamePreset,
    selectBank,
    selectPreset,
  } from '../lib/model/bankStore';
  import {
    formatPresetSearchLabel,
    type PresetSearchEntry,
    type PresetSearchMatchFields,
    type PresetSearchResult,
  } from '../lib/search/presetSearch';
  import PresetSearchMatchBadges from './PresetSearchMatchBadges.svelte';

  interface Props {
    /** Filtered/sorted preset rows (full list when query empty). */
    results: PresetSearchResult[];
    /** True when the user has typed a non-empty search query. */
    queryActive?: boolean;
    /** Parent-owned info tooltip. */
    onrowpointerenter?: (entry: PresetSearchEntry, event: PointerEvent) => void;
    onrowpointermove?: (event: PointerEvent) => void;
    onrowpointerleave?: () => void;
    /** ArrowUp on the first row: return keyboard focus to the search field. */
    onrequestfocussearch?: () => void;
  }

  let {
    results,
    queryActive = false,
    onrowpointerenter,
    onrowpointermove,
    onrowpointerleave,
    onrequestfocussearch,
  }: Props = $props();

  let presetRenameDraft = $state('');
  let listScrollEl: HTMLDivElement | undefined = $state();

  const entries = $derived(results.map((r) => r.entry));

  const renamingEntry = $derived.by(() => {
    const target = $bankMeta.renamingPreset;
    if (!target || $bankMeta.renameSurface !== 'sidebar') return null;
    return (
      entries.find((e) => e.presetUuid.toLowerCase() === target.presetUuid.toLowerCase()) ??
      null
    );
  });

  $effect(() => {
    if (!renamingEntry) return;
    presetRenameDraft = renamingEntry.name;
  });

  /** Canvas selection → keep the matching browse row in view (mirror of focusPreset). */
  $effect(() => {
    const revealUuid = $bankMeta.revealSidebarPresetUuid;
    if (!revealUuid) return;
    const needle = revealUuid.toLowerCase();
    // Depend on results so we retry after filter/index rebuild or tab mount.
    void results;
    void tick().then(() => {
      const root = listScrollEl;
      if (!root) {
        bankMeta.update((m) =>
          m.revealSidebarPresetUuid === revealUuid
            ? { ...m, revealSidebarPresetUuid: null }
            : m,
        );
        return;
      }
      const row = root.querySelector<HTMLElement>(
        `[data-sidebar-preset-uuid="${CSS.escape(revealUuid)}"]`,
      );
      // Case-insensitive fallback if attribute casing differs.
      const el =
        row ??
        Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar-preset-uuid]')).find(
          (node) =>
            (node.getAttribute('data-sidebar-preset-uuid') ?? '').toLowerCase() === needle,
        );
      el?.scrollIntoView({ block: 'nearest' });
      bankMeta.update((m) =>
        m.revealSidebarPresetUuid === revealUuid
          ? { ...m, revealSidebarPresetUuid: null }
          : m,
      );
    });
  });

  function isSelected(entry: PresetSearchEntry): boolean {
    return (
      $bankMeta.presetSelectionBankUuid === entry.bankUuid &&
      $bankMeta.selectedPresetUuids.some(
        (u) => u.toLowerCase() === entry.presetUuid.toLowerCase(),
      )
    );
  }

  function isRenaming(entry: PresetSearchEntry): boolean {
    const target = $bankMeta.renamingPreset;
    return (
      $bankMeta.renameSurface === 'sidebar' &&
      target?.bankUuid === entry.bankUuid &&
      target.presetUuid.toLowerCase() === entry.presetUuid.toLowerCase()
    );
  }

  function entryHasComment(entry: PresetSearchEntry): boolean {
    return Boolean(entry.comment?.trim());
  }

  function activate(entry: PresetSearchEntry): void {
    onrowpointerleave?.();
    const target = $bankMeta.renamingPreset;
    if (
      target &&
      $bankMeta.renameSurface === 'sidebar' &&
      (target.bankUuid !== entry.bankUuid ||
        target.presetUuid.toLowerCase() !== entry.presetUuid.toLowerCase())
    ) {
      cancelRenamePreset();
    }
    selectBank(entry.bankUuid, 'replace', 'sidebar');
    selectPreset(entry.bankUuid, entry.presetUuid, { surface: 'sidebar' });
    bankMeta.update((m) => ({
      ...m,
      focusBankUuid: entry.bankUuid,
      focusPresetUuid: entry.presetUuid,
    }));
  }

  function selectedIndexInResults(): number {
    return results.findIndex((r) => isSelected(r.entry));
  }

  function scrollRowIntoView(presetUuid: string): void {
    const root = listScrollEl;
    if (!root) return;
    const row = root.querySelector<HTMLElement>(
      `[data-sidebar-preset-uuid="${CSS.escape(presetUuid)}"]`,
    );
    row?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Select previous/next preset in the visible list (arrows select, not scroll).
   * Returns where keyboard focus should land afterwards.
   */
  function moveSelection(delta: number): 'list' | 'search' | 'none' {
    if (results.length === 0 || $bankMeta.renamingPreset) return 'none';

    let idx = selectedIndexInResults();
    if (idx < 0) {
      // Nothing in the current list is selected → land on first (↓) or last (↑).
      idx = delta > 0 ? 0 : results.length - 1;
    } else {
      const next = idx + delta;
      if (next < 0) return 'search';
      if (next >= results.length) {
        // Clamp at end; still keep list focus and row visible.
        scrollRowIntoView(results[idx]!.entry.presetUuid);
        return 'list';
      }
      idx = next;
    }

    const entry = results[idx]!.entry;
    // Avoid second-click load when the sole selection is already this row.
    const alreadySole =
      isSelected(entry) && $bankMeta.selectedPresetUuids.length === 1;
    if (!alreadySole) {
      activate(entry);
    } else {
      bankMeta.update((m) => ({
        ...m,
        focusBankUuid: entry.bankUuid,
        focusPresetUuid: entry.presetUuid,
      }));
    }
    void tick().then(() => scrollRowIntoView(entry.presetUuid));
    return 'list';
  }

  /** Called from the search field (ArrowDown/Up) — move selection and take list focus. */
  export function navigateFromSearch(delta: number): boolean {
    const where = moveSelection(delta);
    if (where === 'none') return false;
    if (where === 'search') {
      onrequestfocussearch?.();
      return true;
    }
    listScrollEl?.focus({ preventScroll: true });
    return true;
  }

  function focusList(): void {
    listScrollEl?.focus({ preventScroll: true });
  }

  export function focus(): void {
    focusList();
  }

  function onListKeyDown(event: KeyboardEvent): void {
    if ($bankMeta.renamingPreset) return;
    // Let rename / other inputs keep their keys (bubble from nested controls).
    const t = event.target;
    if (
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    ) {
      return;
    }

    if (event.code === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(1);
      // Keep focus on the list container so further arrows don't stick to a row button.
      listScrollEl?.focus({ preventScroll: true });
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const where = moveSelection(-1);
      if (where === 'search') {
        onrequestfocussearch?.();
      } else if (where === 'list') {
        listScrollEl?.focus({ preventScroll: true });
      }
      return;
    }
  }

  function commitRename(entry: PresetSearchEntry): void {
    const target = $bankMeta.renamingPreset;
    if (
      !target ||
      $bankMeta.renameSurface !== 'sidebar' ||
      target.presetUuid.toLowerCase() !== entry.presetUuid.toLowerCase()
    ) {
      return;
    }
    if (presetRenameDraft.trim() === entry.name) {
      cancelRenamePreset();
      return;
    }
    renamePreset(entry.bankUuid, entry.presetUuid, presetRenameDraft);
  }

  function emptyMessage(): string {
    if (queryActive) return 'No matching presets';
    return 'No presets match filters';
  }
</script>

<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
  <div
    class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
    bind:this={listScrollEl}
    tabindex="-1"
    role="listbox"
    aria-label="Preset list"
    onkeydown={onListKeyDown}
  >
    {#if results.length === 0}
      <div class="px-3 py-4 text-center text-xs text-c15-text-muted">{emptyMessage()}</div>
    {:else}
      <ul class="py-1">
        {#each results as result (result.entry.presetUuid)}
          {@const entry = result.entry}
          {@const matched: PresetSearchMatchFields = result.matchedFields}
          {@const tag = presetColorFromName(entry.color)}
          {@const selected = isSelected(entry)}
          {@const renaming = isRenaming(entry)}
          {@const showCommentMark = entryHasComment(entry)}
          <li data-sidebar-preset-uuid={entry.presetUuid}>
            {#if renaming}
              <div class="flex items-stretch border-b border-c15-border/40 px-1 py-0.5">
                <span
                  class="w-1 shrink-0 self-stretch"
                  style:background-color={tag ?? 'transparent'}
                ></span>
                <input
                  use:focusRenameInput
                  type="text"
                  class="min-w-0 flex-1 rounded border border-c15-accent bg-c15-bg px-2 py-1 text-xs text-c15-text outline-none ring-1 ring-c15-accent/40"
                  bind:value={presetRenameDraft}
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.code === 'Enter') {
                      e.preventDefault();
                      commitRename(entry);
                    } else if (e.code === 'Escape') {
                      e.preventDefault();
                      cancelRenamePreset();
                    }
                  }}
                  onblur={() => commitRename(entry)}
                />
              </div>
            {:else}
              <button
                type="button"
                class="flex w-full min-w-0 items-stretch text-left text-xs transition-colors
                  {selected
                  ? 'bg-c15-preset-selected text-c15-text'
                  : 'text-c15-text hover:bg-c15-surface-raised'}"
                onclick={() => activate(entry)}
                onpointerenter={(e) => onrowpointerenter?.(entry, e)}
                onpointermove={(e) => onrowpointermove?.(e)}
                onpointerleave={() => onrowpointerleave?.()}
              >
                <span
                  class="w-1 shrink-0"
                  style:background-color={tag ?? 'transparent'}
                ></span>
                <span class="min-w-0 flex-1 truncate py-1.5 pl-2 pr-1">
                  {formatPresetSearchLabel(entry)}
                </span>
                <PresetSearchMatchBadges matched={matched} highlighted={selected} />
                {#if showCommentMark}
                  <span
                    class="pointer-events-none shrink-0 self-center pr-1.5 text-[10px] font-bold leading-none text-yellow-400"
                    aria-hidden="true"
                    title="Has comment"
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
  </div>

  {#if results.length > 0 || queryActive}
    <div class="shrink-0 border-t border-c15-border px-3 py-1.5 text-[10px] text-c15-text-muted">
      {#if queryActive}
        Results: {results.length}
        {#if results.length > 0}
          · N/C/D = name/comment/device
        {/if}
      {:else}
        {results.length} preset{results.length === 1 ? '' : 's'}
      {/if}
    </div>
  {/if}
</div>
