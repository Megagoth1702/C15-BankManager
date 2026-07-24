<script lang="ts">
  import { tick } from 'svelte';
  import { presetColorFromName } from '../lib/canvas/presetColors';
  import {
    banks,
    setPresetColor,
    setPresetComment,
    sortPresetsInBankStore,
    startRenamePreset,
    type PresetSortBy,
  } from '../lib/model/bankStore';
  import { portalBody } from '../lib/ui/portalBody';
  import { uiScale } from '../lib/ui/uiScale';
  import { PRESET_COLOR_NAMES, type PresetColorName } from '../lib/xml/presetAttributes';

  interface Props {
    clientX: number;
    clientY: number;
    bankUuid: string;
    presetUuids: string[];
    onduplicate?: () => void;
    ondelete?: () => void;
    onclose?: () => void;
  }

  let {
    clientX,
    clientY,
    bankUuid,
    presetUuids,
    onduplicate,
    ondelete,
    onclose,
  }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let commentInput: HTMLTextAreaElement | undefined = $state();
  let showColorMenu = $state(false);
  let showSortMenu = $state(false);
  let showCommentDialog = $state(false);
  let commentDraft = $state('');

  const count = $derived(presetUuids.length);
  const canRename = $derived(count === 1);
  const bankPresetCount = $derived(
    $banks.find((b) => b.uuid === bankUuid)?.presetOrder.length ?? 0,
  );
  const canSort = $derived(bankPresetCount >= 2);

  /** Cursor-anchored popups must not use `.app-ui { zoom }` — it offsets fixed coords. */
  function placeMenuAtCursor(): void {
    if (!menuEl) return;

    const scale = $uiScale;
    const pad = 8;
    let left = clientX;
    let top = clientY;

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.transform = `scale(${scale})`;
    menuEl.style.transformOrigin = 'top left';

    const rect = menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth - pad) {
      left -= rect.right - (window.innerWidth - pad);
    }
    if (rect.bottom > window.innerHeight - pad) {
      top -= rect.bottom - (window.innerHeight - pad);
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  $effect(() => {
    clientX;
    clientY;
    $uiScale;
    placeMenuAtCursor();
  });

  function handleRename(): void {
    if (!canRename) return;
    startRenamePreset(bankUuid, presetUuids[0]!, 'canvas');
    onclose?.();
  }

  function handleColor(color: PresetColorName): void {
    setPresetColor(bankUuid, presetUuids, color);
    onclose?.();
  }

  function handleSort(sortBy: PresetSortBy): void {
    if (!canSort) return;
    sortPresetsInBankStore(bankUuid, sortBy);
    onclose?.();
  }

  function openCommentDialog(): void {
    if (count !== 1) return;
    const bank = $banks.find((b) => b.uuid === bankUuid);
    const preset = bank?.presets.find(
      (p) => p.uuid.toLowerCase() === presetUuids[0]!.toLowerCase(),
    );
    commentDraft = preset?.comment ?? '';
    showCommentDialog = true;
  }

  function closeCommentDialog(): void {
    showCommentDialog = false;
  }

  function saveComment(): void {
    if (count === 1) {
      setPresetComment(bankUuid, presetUuids[0]!, commentDraft);
    }
    showCommentDialog = false;
    onclose?.();
  }

  $effect(() => {
    if (!showCommentDialog) return;
    void tick().then(() => commentInput?.focus());
  });
</script>

{#if showCommentDialog}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-preset-comment-dialog="true"
    class="app-ui fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <div
      class="w-full max-w-sm rounded border border-c15-border bg-c15-surface-raised p-4 shadow-xl"
      role="dialog"
      aria-labelledby="preset-comment-dialog-title"
      aria-modal="true"
    >
      <h3 id="preset-comment-dialog-title" class="mb-2 text-sm font-medium text-c15-text">
        Change comment
      </h3>
      <textarea
        bind:this={commentInput}
        class="mb-3 w-full rounded border border-c15-border bg-c15-bg px-2 py-1.5 text-xs text-c15-text focus:border-c15-accent focus:outline-none"
        rows="3"
        bind:value={commentDraft}
        placeholder="Preset comment…"
        onkeydown={(e) => {
          if (e.code === 'Escape') {
            e.stopPropagation();
            closeCommentDialog();
          }
        }}
      ></textarea>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded border border-c15-border px-3 py-1 text-xs text-c15-text-muted"
          onclick={closeCommentDialog}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded border border-c15-accent px-3 py-1 text-xs text-c15-accent"
          onclick={saveComment}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{/if}

{#if !showCommentDialog}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={menuEl}
  use:portalBody
  data-preset-context-menu="true"
  class="fixed z-[110] min-w-[160px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
  onclick={(e) => e.stopPropagation()}
>
  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent
      {!canRename ? 'cursor-not-allowed opacity-40' : ''}"
    disabled={!canRename}
    onclick={handleRename}
  >
    Rename
  </button>

  <!-- Flyouts flush to parent (no ml gap) so mouseleave does not dismiss mid-travel -->
  <div
    class="relative"
    onmouseenter={() => {
      showColorMenu = true;
      showSortMenu = false;
    }}
    onmouseleave={() => {
      showColorMenu = false;
    }}
  >
    <button
      type="button"
      class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
    >
      Assign color
      <span class="text-c15-text-muted">▸</span>
    </button>
    {#if showColorMenu}
      <div
        class="absolute left-full top-0 min-w-[120px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
      >
        {#each PRESET_COLOR_NAMES as color (color)}
          {@const rgb = presetColorFromName(color)}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-c15-text hover:bg-c15-surface"
            onclick={() => handleColor(color)}
          >
            <span
              class="h-3 w-3 shrink-0 rounded-sm border border-c15-border/60"
              style:background-color={rgb ?? 'transparent'}
            ></span>
            {color === 'none' ? 'None' : color.charAt(0).toUpperCase() + color.slice(1)}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div
    class="relative"
    onmouseenter={() => {
      showSortMenu = true;
      showColorMenu = false;
    }}
    onmouseleave={() => {
      showSortMenu = false;
    }}
  >
    <button
      type="button"
      class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent
        {!canSort ? 'cursor-not-allowed opacity-40' : ''}"
      disabled={!canSort}
    >
      Sort by
      <span class="text-c15-text-muted">▸</span>
    </button>
    {#if showSortMenu && canSort}
      <div
        class="absolute left-full top-0 min-w-[140px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
      >
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-xs text-c15-text hover:bg-c15-surface"
          onclick={() => handleSort('name')}
          title="Sort by preset name (A→Z; click again for Z→A)"
        >
          Name
        </button>
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left text-xs text-c15-text hover:bg-c15-surface"
          onclick={() => handleSort('storeTime')}
          title="Sort by StoreTime creation date (oldest→newest; click again for newest→oldest)"
        >
          Creation date
        </button>
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent
      {count !== 1 ? 'cursor-not-allowed opacity-40' : ''}"
    disabled={count !== 1}
    onclick={openCommentDialog}
  >
    Change comment…
  </button>

  <div class="my-1 border-t border-c15-border/60"></div>

  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
    onclick={() => {
      onduplicate?.();
      onclose?.();
    }}
  >
    Duplicate {count === 1 ? 'preset' : `${count} presets`}
  </button>
  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-red-300 transition-colors hover:bg-c15-surface hover:text-red-200"
    onclick={() => {
      ondelete?.();
      onclose?.();
    }}
  >
    Delete {count === 1 ? 'preset' : `${count} presets`}
  </button>
</div>
{/if}
