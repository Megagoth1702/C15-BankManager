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
  import { formatPresetSearchLabel, type PresetSearchEntry } from '../lib/search/presetSearch';

  interface Props {
    entries: PresetSearchEntry[];
    /** Parent-owned info tooltip (same path as search dropdown). */
    onrowpointerenter?: (entry: PresetSearchEntry, event: PointerEvent) => void;
    onrowpointermove?: (event: PointerEvent) => void;
    onrowpointerleave?: () => void;
  }

  let {
    entries,
    onrowpointerenter,
    onrowpointermove,
    onrowpointerleave,
  }: Props = $props();

  let presetRenameDraft = $state('');
  let listScrollEl: HTMLDivElement | undefined = $state();

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
    // Depend on entries so we retry after filter/index rebuild or tab mount.
    void entries;
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
</script>

<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
  <div
    class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
    bind:this={listScrollEl}
  >
    {#if entries.length === 0}
      <div class="px-3 py-4 text-center text-xs text-c15-text-muted">No presets match filters</div>
    {:else}
      <ul class="py-1">
        {#each entries as entry (entry.presetUuid)}
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
                <span class="min-w-0 flex-1 truncate py-1.5 pl-2 {showCommentMark ? 'pr-1' : 'pr-2'}">
                  {formatPresetSearchLabel(entry)}
                </span>
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

  {#if entries.length > 0}
    <div class="shrink-0 border-t border-c15-border px-3 py-1.5 text-[10px] text-c15-text-muted">
      {entries.length} preset{entries.length === 1 ? '' : 's'}
    </div>
  {/if}
</div>
