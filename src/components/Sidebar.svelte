<script lang="ts">
  import { onMount } from 'svelte';
  import { appSettings, bankMeta, createBank, setSidebarTab } from '../lib/model/bankStore';
  import { requestFocusPresetSearch } from '../lib/search/searchState';
  import {
    clampSidebarWidth,
    loadSidebarSettings,
    updateSidebarSettings,
    type SidebarTab,
  } from '../lib/ui/sidebarSettings';
  import BanksPanel from './BanksPanel.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import ResizeHandle from './ResizeHandle.svelte';

  const savedInitial = loadSidebarSettings();
  let sidebarWidth = $state(savedInitial.widthPx);
  let collapsed = $state(savedInitial.collapsed);

  const activeTab = $derived($appSettings.sidebarTab);

  onMount(() => {
    const saved = loadSidebarSettings();
    sidebarWidth = saved.widthPx;
    collapsed = saved.collapsed;
    appSettings.update((s) => ({
      ...s,
      sidebarWidthPx: saved.widthPx,
      sidebarTab: saved.tab,
    }));
  });

  function persist(): void {
    updateSidebarSettings({
      widthPx: sidebarWidth,
      tab: activeTab,
      collapsed,
    });
    appSettings.update((s) => ({ ...s, sidebarWidthPx: sidebarWidth }));
  }

  function setTab(tab: SidebarTab): void {
    setSidebarTab(tab);
    // Persist tab even while collapsed so re-open keeps the choice.
    updateSidebarSettings({
      widthPx: sidebarWidth,
      tab,
      collapsed,
    });
  }

  function handleResize(deltaX: number): void {
    if (collapsed) return;
    sidebarWidth = clampSidebarWidth(sidebarWidth + deltaX);
    appSettings.update((s) => ({ ...s, sidebarWidthPx: sidebarWidth }));
  }

  function handleResizeEnd(): void {
    persist();
  }

  function toggleCollapsed(): void {
    collapsed = !collapsed;
    persist();
  }

  /** Collapsed shortcut: open panel on Presets and focus the search field. */
  function openPresetSearchFromCollapsed(): void {
    collapsed = false;
    setSidebarTab('presets');
    updateSidebarSettings({
      widthPx: sidebarWidth,
      tab: 'presets',
      collapsed: false,
    });
    appSettings.update((s) => ({ ...s, sidebarWidthPx: sidebarWidth }));
    requestFocusPresetSearch();
  }

  function handleCreateBank(): void {
    createBank();
  }
</script>

<div
  class="app-ui relative z-20 flex shrink-0 overflow-visible"
  style:width={collapsed ? '0px' : `${sidebarWidth}px`}
  data-sidebar-collapsed={collapsed ? '1' : '0'}
>
  {#if collapsed}
    <!-- Top-left discovery affordance when the panel is hidden. -->
    <button
      type="button"
      class="absolute left-1 top-2 z-20 flex h-8 w-8 items-center justify-center
        rounded-md border border-c15-border bg-c15-surface-raised text-c15-text-muted
        shadow-sm transition-colors hover:border-c15-accent hover:text-c15-accent
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-c15-accent"
      title="Search presets"
      aria-label="Open sidebar and search presets"
      onclick={openPresetSearchFromCollapsed}
    >
      <svg
        class="h-4 w-4 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.5 10.5 14 14" />
      </svg>
    </button>
  {/if}

  {#if !collapsed}
    <aside class="flex min-w-0 flex-1 flex-col overflow-hidden bg-c15-surface">
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
  {/if}

  <!-- Mid-edge collapse / expand control (IDE-style). -->
  <button
    type="button"
    class="absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center
      rounded-r border border-l-0 border-c15-border bg-c15-surface-raised text-c15-text-muted
      shadow-sm transition-colors hover:border-c15-accent hover:text-c15-accent
      focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-c15-accent
      {collapsed ? 'left-0 rounded-l border-l' : 'right-0 translate-x-1/2'}"
    title={collapsed ? 'Show banks & presets panel' : 'Hide banks & presets panel'}
    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    aria-expanded={!collapsed}
    onclick={toggleCollapsed}
  >
    <svg
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {#if collapsed}
        <!-- chevron right: expand -->
        <path d="M6 3.5 10.5 8 6 12.5" />
      {:else}
        <!-- chevron left: collapse -->
        <path d="M10 3.5 5.5 8 10 12.5" />
      {/if}
    </svg>
  </button>
</div>
