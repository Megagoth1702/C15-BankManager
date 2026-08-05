<script lang="ts">
  import {
    exportSelectedBanksAsXmlLabel,
    exportSelectedBanksLabel,
  } from '../lib/model/bankStore';
  import { portalBody } from '../lib/ui/portalBody';
  import { uiScale } from '../lib/ui/uiScale';

  interface Props {
    clientX: number;
    clientY: number;
    /** True when the session has at least one bank to export. */
    canExportAll?: boolean;
    /** Count of selected banks; 0 hides selected-export items. */
    selectedCount?: number;
    /**
   * Empty-canvas menu includes Create new bank; bank-header menu adds Rename bank.
   * Default true for empty canvas.
   */
    showCreateBank?: boolean;
    /**
     * Sidebar bank menu (offline only): renumber document bank IDs (#N) to
     * match the current flat sort (name / last changed). Hidden on canvas / Live.
     */
    showRenumberBySort?: boolean;
    /** Label for renumber action (e.g. includes sort key). */
    renumberBySortLabel?: string;
    oncreatebank?: () => void;
    /** Bank-header menu: same as F2 — inline rename on primary selected bank. */
    onrenamebank?: () => void;
    /** Bank-header menu: open Bank Info dialog for the primary selected bank. */
    onbankinfo?: () => void;
    onrenumberbysort?: () => void;
    onexportall?: () => void;
    onexportselected?: () => void;
    onexportselectedxml?: () => void;
    onclose?: () => void;
  }

  let {
    clientX,
    clientY,
    canExportAll = false,
    selectedCount = 0,
    showCreateBank = true,
    showRenumberBySort = false,
    renumberBySortLabel = 'Renumber bank IDs by sort order',
    oncreatebank,
    onrenamebank,
    onbankinfo,
    onrenumberbysort,
    onexportall,
    onexportselected,
    onexportselectedxml,
    onclose,
  }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  const selectedBackupLabel = $derived(exportSelectedBanksLabel(selectedCount));
  const selectedXmlLabel = $derived(exportSelectedBanksAsXmlLabel(selectedCount));
  const showSelectedExport = $derived(selectedCount > 0);
  const showExportSection = $derived(canExportAll || showSelectedExport);
  /** Bank-header mode: rename / info on primary selected bank. */
  const showRenameBank = $derived(!showCreateBank && selectedCount > 0);
  const showBankInfo = $derived(!showCreateBank && selectedCount > 0);
  const showRenumber = $derived(showRenumberBySort && !showCreateBank);

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
    canExportAll;
    selectedCount;
    showCreateBank;
    showRenameBank;
    showRenumber;
    renumberBySortLabel;
    placeMenuAtCursor();
  });

  function handleCreateBank(): void {
    oncreatebank?.();
    onclose?.();
  }

  function handleRenameBank(): void {
    if (!showRenameBank) return;
    onrenamebank?.();
    onclose?.();
  }

  function handleBankInfo(): void {
    if (!showBankInfo) return;
    onbankinfo?.();
    onclose?.();
  }

  function handleRenumberBySort(): void {
    if (!showRenumber) return;
    onrenumberbysort?.();
    onclose?.();
  }

  function handleExportAll(): void {
    if (!canExportAll) return;
    onexportall?.();
    onclose?.();
  }

  function handleExportSelected(): void {
    if (!showSelectedExport) return;
    onexportselected?.();
    onclose?.();
  }

  function handleExportSelectedXml(): void {
    if (!showSelectedExport) return;
    onexportselectedxml?.();
    onclose?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={menuEl}
  use:portalBody
  data-canvas-context-menu="true"
  class="fixed z-[110] min-w-[240px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
  onclick={(e) => e.stopPropagation()}
>
  {#if showCreateBank}
    <button
      type="button"
      class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
      onclick={handleCreateBank}
    >
      Create new bank
    </button>
  {/if}

  {#if showRenameBank}
    <button
      type="button"
      class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
      onclick={handleRenameBank}
    >
      Rename bank
    </button>
  {/if}

  {#if showBankInfo}
    <button
      type="button"
      class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
      onclick={handleBankInfo}
    >
      Bank info…
    </button>
  {/if}

  {#if showRenumber}
    <button
      type="button"
      class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
      title="Offline only. Assign bank ID #1 to the first bank in the current list order, #2 to the next, and so on"
      onclick={handleRenumberBySort}
    >
      {renumberBySortLabel}
    </button>
  {/if}

  {#if showExportSection}
    {#if showCreateBank || showRenameBank || showBankInfo || showRenumber}
      <div class="my-1 border-t border-c15-border/60" role="separator"></div>
    {/if}
    {#if canExportAll}
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
        onclick={handleExportAll}
      >
        Export all as backup
      </button>
    {/if}
    {#if showSelectedExport}
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
        onclick={handleExportSelected}
      >
        {selectedBackupLabel}
      </button>
      <button
        type="button"
        class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
        onclick={handleExportSelectedXml}
      >
        {selectedXmlLabel}
      </button>
    {/if}
  {/if}
</div>
