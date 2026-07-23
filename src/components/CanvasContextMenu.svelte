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
    oncreatebank?: () => void;
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
    oncreatebank,
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
    placeMenuAtCursor();
  });

  function handleCreateBank(): void {
    oncreatebank?.();
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
  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
    onclick={handleCreateBank}
  >
    Create new bank
  </button>

  {#if showExportSection}
    <div class="my-1 border-t border-c15-border/60" role="separator"></div>
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
