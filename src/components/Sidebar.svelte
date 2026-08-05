<script lang="ts">
  import { onMount } from 'svelte';
  import { appSettings, bankMeta, createBank, setSidebarTab } from '../lib/model/bankStore';
  import {
    clampSidebarWidth,
    loadSidebarSettings,
    saveSidebarSettings,
    type SidebarTab,
  } from '../lib/ui/sidebarSettings';
  import BanksPanel from './BanksPanel.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import ResizeHandle from './ResizeHandle.svelte';

  let sidebarWidth = $state(loadSidebarSettings().widthPx);

  const activeTab = $derived($appSettings.sidebarTab);

  onMount(() => {
    const saved = loadSidebarSettings();
    sidebarWidth = saved.widthPx;
    appSettings.update((s) => ({
      ...s,
      sidebarWidthPx: saved.widthPx,
      sidebarTab: saved.tab,
    }));
  });

  function persistWidth(): void {
    saveSidebarSettings({ widthPx: sidebarWidth, tab: activeTab });
    appSettings.update((s) => ({ ...s, sidebarWidthPx: sidebarWidth }));
  }

  function setTab(tab: SidebarTab): void {
    setSidebarTab(tab);
  }

  function handleResize(deltaX: number): void {
    sidebarWidth = clampSidebarWidth(sidebarWidth + deltaX);
    appSettings.update((s) => ({ ...s, sidebarWidthPx: sidebarWidth }));
  }

  function handleResizeEnd(): void {
    persistWidth();
  }

  function handleCreateBank(): void {
    createBank();
  }
</script>

<div class="app-ui flex shrink-0" style:width="{sidebarWidth}px">
  <aside class="flex min-w-0 flex-1 flex-col bg-c15-surface">
    <div class="flex items-center gap-1 border-b border-c15-border px-2 py-2">
      <div
        class="flex min-w-0 flex-1 rounded border border-c15-border bg-c15-bg p-0.5 text-[10px]"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'banks'}
          class="min-w-0 flex-1 rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors
            {activeTab === 'banks'
            ? 'bg-c15-surface-raised text-c15-accent'
            : 'text-c15-text-muted hover:text-c15-text'}"
          onclick={() => setTab('banks')}
        >
          Banks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'presets'}
          class="min-w-0 flex-1 rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors
            {activeTab === 'presets'
            ? 'bg-c15-surface-raised text-c15-accent'
            : 'text-c15-text-muted hover:text-c15-text'}"
          onclick={() => setTab('presets')}
        >
          Presets
        </button>
      </div>
      {#if activeTab === 'banks'}
        <button
          type="button"
          class="shrink-0 rounded border border-c15-border px-2 py-0.5 text-[10px] text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent"
          title="New empty bank (Ctrl+Shift+N)"
          onclick={handleCreateBank}
        >
          + New
        </button>
      {/if}
    </div>

    {#if $bankMeta.error}
      <div class="border-b border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
        {$bankMeta.error}
      </div>
    {/if}

    {#if activeTab === 'banks'}
      <BanksPanel />
    {:else}
      <PresetsPanel />
    {/if}
  </aside>

  <ResizeHandle onresize={handleResize} onresizeend={handleResizeEnd} />
</div>