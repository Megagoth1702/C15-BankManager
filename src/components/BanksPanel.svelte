<script lang="ts">
  import { tick } from 'svelte';
  import { liveMode } from '../lib/live/liveMode';
  import {
    bankMeta,
    banks,
    cancelRenameBank,
    createBank,
    deleteBank,
    detachBank,
    exportAllAsBackup,
    exportSelectedBanks,
    exportSelectedBanksAsXml,
    getPrimarySelectedUuid,
    renameBank,
    renumberBanksToOrder,
    resolveBankContextMenuSelection,
    selectBank,
    startRenameBank,
  } from '../lib/model/bankStore';
  import {
    sortBanksList,
    type SortDirection,
  } from '../lib/model/bankOrder';
  import { buildBankForest, flattenBankForest } from '../lib/model/bankTree';
  import { filterBankForest } from '../lib/model/bankTreeFilter';
  import type { Bank } from '../lib/types/bank';
  import {
    loadSidebarSettings,
    updateSidebarSettings,
    type BankSidebarSortBy,
  } from '../lib/ui/sidebarSettings';
  import BankInfoDialog from './BankInfoDialog.svelte';
  import BankTreeCluster from './BankTreeCluster.svelte';
  import BankTreeRow from './BankTreeRow.svelte';
  import CanvasContextMenu from './CanvasContextMenu.svelte';

  const SORT_OPTIONS: {
    value: BankSidebarSortBy;
    label: string;
    /** Hover tooltip explaining how this sort works. */
    title: string;
  }[] = [
    {
      value: 'none',
      label: 'Attachment order',
      title:
        'Show banks in parent–child attachment groups (same hierarchy as canvas docks). Not a date or name sort — order follows how banks are attached.',
    },
    {
      value: 'name',
      label: 'Name',
      title:
        'Alphabetical by bank name (case-insensitive). Ties keep document order. Direction: A→Z or Z→A.',
    },
    {
      value: 'lastChanged',
      label: 'Last changed',
      title:
        'By the bank’s last-changed timestamp (when bank content was last modified: rename, presets, etc.). Not the import or export date. Direction: newest or oldest first.',
    },
    {
      value: 'importDate',
      label: 'Import date',
      title:
        'By Date of Import File (when this bank was last imported). Uses import metadata only — not last changed. Banks without an import date appear last. Direction: newest or oldest first.',
    },
    {
      value: 'exportDate',
      label: 'Export date',
      title:
        'By Date of Export File (when this bank was last exported). Uses export metadata only — not last changed. Banks without an export date appear last. Direction: newest or oldest first.',
    },
    {
      value: 'id',
      label: 'Bank ID',
      title:
        'By bank number (#1, #2, …) — document order in the session. Direction: low→high or high→low.',
    },
  ];

  const selectedBank = $derived.by(() => {
    const uuids = $bankMeta.selectedBankUuids;
    if (uuids.length !== 1) return undefined;
    return $banks.find((bank) => bank.uuid === uuids[0]);
  });

  const savedBankSort = loadSidebarSettings();
  let renameDraft = $state('');
  let filterQuery = $state('');
  /** Restored from sidebar settings so canvas → Presets tab remount keeps sort. */
  let sortBy = $state<BankSidebarSortBy>(savedBankSort.bankSortBy);
  let sortDirection = $state<SortDirection>(savedBankSort.bankSortDirection);
  let listScrollEl: HTMLDivElement | undefined = $state();
  /** Same bank-header menu as canvas (rename / info / export). */
  let bankContextMenu = $state<{ clientX: number; clientY: number } | null>(null);
  let bankInfoUuid = $state<string | null>(null);
  /** Custom sort menu (native <option> titles are unreliable). */
  let sortMenuOpen = $state(false);
  /** Hovered sort option — shows explanation tooltip. */
  let sortHoverValue = $state<BankSidebarSortBy | null>(null);

  const sortHoverTitle = $derived(
    sortHoverValue
      ? (SORT_OPTIONS.find((opt) => opt.value === sortHoverValue)?.title ?? null)
      : null,
  );

  const bankIndexByUuid = $derived(
    new Map($banks.map((bank, index) => [bank.uuid, index])),
  );

  const treeForest = $derived(buildBankForest($banks));
  const visibleTreeForest = $derived(filterBankForest(treeForest, filterQuery));
  const sortingEnabled = $derived(sortBy !== 'none');
  /** No C15 bank-order RPC — renumber only when not Live / connecting. */
  const isOfflineSession = $derived(
    $liveMode.connection === 'offline' || $liveMode.connection === 'error',
  );
  /** Renumber IDs only offline + flat value sorts (not Bank ID or attachment tree). */
  const canRenumberBySort = $derived(
    isOfflineSession &&
      (sortBy === 'name' ||
        sortBy === 'lastChanged' ||
        sortBy === 'importDate' ||
        sortBy === 'exportDate'),
  );
  const renumberBySortLabel = $derived(
    sortBy === 'lastChanged'
      ? 'Renumber bank IDs by last changed'
      : sortBy === 'importDate'
        ? 'Renumber bank IDs by import date'
        : sortBy === 'exportDate'
          ? 'Renumber bank IDs by export date'
          : 'Renumber bank IDs by name',
  );

  /** Full session sorted by current key/direction (ignores filter; used for renumber). */
  const fullySortedBanks = $derived.by((): Bank[] => {
    if (sortBy === 'none') return [];
    return sortBanksList($banks, sortBy, sortDirection);
  });

  const filteredSortedBanks = $derived.by((): Bank[] => {
    if (!sortingEnabled) return [];

    const needle = filterQuery.trim().toLowerCase();
    if (!needle) return fullySortedBanks;
    return fullySortedBanks.filter((bank) => bank.name.toLowerCase().includes(needle));
  });

  const orderedUuids = $derived.by(() => {
    if (sortingEnabled) {
      return filteredSortedBanks.map((bank) => bank.uuid);
    }
    return flattenBankForest(treeForest).map((node) => node.bank.uuid);
  });

  const listIsEmpty = $derived(
    sortingEnabled
      ? filteredSortedBanks.length === 0
      : visibleTreeForest.length === 0,
  );

  const sortLabel = $derived(
    SORT_OPTIONS.find((opt) => opt.value === sortBy)?.label ?? 'Attachment order',
  );

  const sortSelectTitle = $derived(
    SORT_OPTIONS.find((opt) => opt.value === sortBy)?.title ??
      'Sort banks, or use attachment order to show parent–child groups',
  );

  function persistBankSort(nextBy: BankSidebarSortBy, nextDir: SortDirection): void {
    updateSidebarSettings({
      bankSortBy: nextBy,
      bankSortDirection: nextDir,
    });
  }

  function setSortBy(value: BankSidebarSortBy): void {
    sortBy = value;
    // Date-based sorts default to newest-first; name/id to ascending.
    if (
      value === 'lastChanged' ||
      value === 'importDate' ||
      value === 'exportDate'
    ) {
      sortDirection = 'desc';
    } else if (value !== 'none') {
      sortDirection = 'asc';
    }
    persistBankSort(sortBy, sortDirection);
    sortMenuOpen = false;
    sortHoverValue = null;
  }

  function toggleSortDirection(): void {
    if (!sortingEnabled) return;
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    persistBankSort(sortBy, sortDirection);
  }

  function onSortMenuOutsidePointerDown(event: PointerEvent): void {
    if (!sortMenuOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-bank-sort-menu]')) return;
    sortMenuOpen = false;
    sortHoverValue = null;
  }

  $effect(() => {
    if (!sortMenuOpen) return;
    window.addEventListener('pointerdown', onSortMenuOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onSortMenuOutsidePointerDown, true);
    };
  });

  $effect(() => {
    if (!sortMenuOpen) sortHoverValue = null;
  });

  $effect(() => {
    const renamingUuid = $bankMeta.renamingBankUuid;
    if (!renamingUuid || $bankMeta.renameSurface !== 'sidebar') return;
    const bank = $banks.find((b) => b.uuid === renamingUuid);
    if (bank) renameDraft = bank.name;
  });

  /** Canvas selection → keep the matching bank row in view (mirror of revealSidebarPresetUuid). */
  $effect(() => {
    const revealUuid = $bankMeta.revealSidebarBankUuid;
    if (!revealUuid) return;
    const needle = revealUuid.toLowerCase();
    // Depend on list mode + filter so we retry after tab mount / filter rebuild.
    void filteredSortedBanks;
    void visibleTreeForest;
    void sortBy;
    void filterQuery;
    void tick().then(() => {
      const root = listScrollEl;
      if (!root) {
        bankMeta.update((m) =>
          m.revealSidebarBankUuid === revealUuid
            ? { ...m, revealSidebarBankUuid: null }
            : m,
        );
        return;
      }
      const row = root.querySelector<HTMLElement>(
        `[data-sidebar-bank-uuid="${CSS.escape(revealUuid)}"]`,
      );
      const el =
        row ??
        Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar-bank-uuid]')).find(
          (node) =>
            (node.getAttribute('data-sidebar-bank-uuid') ?? '').toLowerCase() === needle,
        );
      el?.scrollIntoView({ block: 'nearest' });
      bankMeta.update((m) =>
        m.revealSidebarBankUuid === revealUuid
          ? { ...m, revealSidebarBankUuid: null }
          : m,
      );
    });
  });

  function commitRename(): void {
    const uuid = $bankMeta.renamingBankUuid;
    if (!uuid || $bankMeta.renameSurface !== 'sidebar') return;
    const bank = $banks.find((b) => b.uuid === uuid);
    if (!bank) {
      cancelRenameBank();
      return;
    }
    if (renameDraft.trim() === bank.name) {
      cancelRenameBank();
      return;
    }
    renameBank(uuid, renameDraft);
  }

  function handleCreateBank(): void {
    createBank();
  }

  function handleStartRename(uuid: string): void {
    const bank = $banks.find((b) => b.uuid === uuid);
    if (!bank) return;
    renameDraft = bank.name;
    startRenameBank(uuid, 'sidebar');
  }

  function closeBankContextMenu(): void {
    bankContextMenu = null;
  }

  function handleBankContextMenu(bankUuid: string, event: MouseEvent): void {
    const { shouldSelectClicked } = resolveBankContextMenuSelection(
      bankUuid,
      $bankMeta.selectedBankUuids,
    );
    if (shouldSelectClicked) {
      selectBank(bankUuid, 'replace');
    }
    bankContextMenu = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function handleRenameBankFromContextMenu(): void {
    const uuid = getPrimarySelectedUuid();
    if (!uuid) return;
    handleStartRename(uuid);
  }

  function handleBankInfoFromContextMenu(): void {
    const uuid = getPrimarySelectedUuid();
    if (!uuid) return;
    bankInfoUuid = uuid;
    closeBankContextMenu();
  }

  async function handleExportAllFromContextMenu(): Promise<void> {
    await exportAllAsBackup();
  }

  async function handleExportSelectedFromContextMenu(): Promise<void> {
    await exportSelectedBanks();
  }

  async function handleExportSelectedXmlFromContextMenu(): Promise<void> {
    await exportSelectedBanksAsXml();
  }

  function handleRenumberBySortFromContextMenu(): void {
    if (!canRenumberBySort || fullySortedBanks.length === 0) return;
    renumberBanksToOrder(fullySortedBanks.map((bank) => bank.uuid));
  }

  function onContextMenuOutsidePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (!bankContextMenu) return;
    if (target.closest('[data-canvas-context-menu]')) return;
    if (target.closest('[data-bank-info-dialog]')) return;
    closeBankContextMenu();
  }

  $effect(() => {
    if (!bankContextMenu) return;
    window.addEventListener('pointerdown', onContextMenuOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onContextMenuOutsidePointerDown, true);
    };
  });

  function directionTitle(): string {
    if (sortBy === 'name') {
      return sortDirection === 'asc' ? 'A→Z — click to reverse' : 'Z→A — click to reverse';
    }
    if (
      sortBy === 'lastChanged' ||
      sortBy === 'importDate' ||
      sortBy === 'exportDate'
    ) {
      const what =
        sortBy === 'lastChanged'
          ? 'last changed'
          : sortBy === 'importDate'
            ? 'import date'
            : 'export date';
      return sortDirection === 'desc'
        ? `Newest ${what} first — click to reverse`
        : `Oldest ${what} first — click to reverse`;
    }
    if (sortBy === 'id') {
      return sortDirection === 'asc'
        ? 'Low→high bank # — click to reverse'
        : 'High→low bank # — click to reverse';
    }
    return 'Sort direction';
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="border-b border-c15-border px-3 py-2">
    <div class="relative">
      <input
        type="text"
        class="w-full rounded border border-c15-border bg-c15-bg px-2 py-1 pr-7 text-xs text-c15-text
          placeholder:text-c15-text-muted focus:border-c15-accent focus:outline-none"
        placeholder="Filter banks…"
        bind:value={filterQuery}
      />
      {#if filterQuery}
        <button
          type="button"
          class="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs text-c15-text-muted hover:text-c15-text"
          title="Clear filter"
          onclick={() => {
            filterQuery = '';
          }}
        >
          ×
        </button>
      {/if}
    </div>
    <div class="mt-2 flex items-center gap-1.5" data-bank-sort-menu>
      <span class="shrink-0 text-[10px] text-c15-text-muted">Sort</span>
      <div class="relative min-w-0 flex-1">
        <button
          type="button"
          id="bank-sidebar-sort"
          class="flex w-full items-center justify-between gap-1 rounded border border-c15-border bg-c15-bg px-1.5 py-0.5
            text-left text-[10px] text-c15-text focus:border-c15-accent focus:outline-none
            hover:border-c15-accent/50"
          title={sortSelectTitle}
          aria-haspopup="listbox"
          aria-expanded={sortMenuOpen}
          onclick={() => {
            sortMenuOpen = !sortMenuOpen;
          }}
        >
          <span class="min-w-0 truncate">{sortLabel}</span>
          <span class="shrink-0 text-c15-text-muted" aria-hidden="true">▾</span>
        </button>
        {#if sortMenuOpen}
          <div class="absolute left-0 right-0 z-30 mt-0.5">
            <ul
              class="max-h-56 overflow-y-auto rounded border border-c15-border bg-c15-surface-raised py-0.5 shadow-lg"
              role="listbox"
              aria-labelledby="bank-sidebar-sort"
            >
              {#each SORT_OPTIONS as opt (opt.value)}
                <li role="option" aria-selected={sortBy === opt.value}>
                  <button
                    type="button"
                    class="w-full px-2 py-1 text-left text-[10px] text-c15-text
                      hover:bg-c15-accent/15 {sortBy === opt.value
                      ? 'bg-c15-accent/10 text-c15-accent'
                      : ''}"
                    title={opt.title}
                    onpointerenter={() => {
                      sortHoverValue = opt.value;
                    }}
                    onpointerleave={() => {
                      if (sortHoverValue === opt.value) sortHoverValue = null;
                    }}
                    onclick={() => setSortBy(opt.value)}
                  >
                    {opt.label}
                  </button>
                </li>
              {/each}
            </ul>
            {#if sortHoverTitle}
              <div
                class="mt-1 rounded border border-c15-border bg-c15-surface-raised px-2 py-1.5
                  text-[10px] leading-snug text-c15-text-muted shadow-lg"
                role="tooltip"
              >
                {sortHoverTitle}
              </div>
            {/if}
          </div>
        {/if}
      </div>
      {#if sortingEnabled}
        <button
          type="button"
          class="shrink-0 rounded border border-c15-border px-1.5 py-0.5 text-[10px] text-c15-text-muted
            hover:border-c15-accent/50 hover:text-c15-text"
          title={directionTitle()}
          onclick={toggleSortDirection}
          aria-label="Toggle sort direction"
        >
          {sortDirection === 'asc' ? '↑' : '↓'}
        </button>
      {/if}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto" bind:this={listScrollEl}>
    {#if $banks.length === 0}
      <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <p class="text-xs text-c15-text-muted">
          Import a backup or create an empty bank to get started
        </p>
        <button
          type="button"
          class="rounded border border-c15-border px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent"
          onclick={handleCreateBank}
        >
          Create bank
        </button>
      </div>
    {:else if listIsEmpty}
      <div class="p-4 text-center text-xs text-c15-text-muted">
        No banks match “{filterQuery.trim()}”
      </div>
    {:else if sortingEnabled}
      <ul class="py-1">
        {#each filteredSortedBanks as bank (bank.uuid)}
          <BankTreeRow
            {bank}
            index={bankIndexByUuid.get(bank.uuid) ?? 0}
            {orderedUuids}
            renaming={$bankMeta.renamingBankUuid === bank.uuid}
            renameValue={renameDraft}
            onrenameinput={(value) => {
              renameDraft = value;
            }}
            onrenamecommit={commitRename}
            onrenamecancel={cancelRenameBank}
            onstartrename={handleStartRename}
            onbankcontextmenu={handleBankContextMenu}
          />
        {/each}
      </ul>
    {:else}
      <ul class="py-1">
        {#each visibleTreeForest as root (root.bank.uuid)}
          <BankTreeCluster
            {root}
            {bankIndexByUuid}
            {orderedUuids}
            {filterQuery}
            renamingUuid={$bankMeta.renamingBankUuid}
            renameValue={renameDraft}
            onrenameinput={(value) => {
              renameDraft = value;
            }}
            onrenamecommit={commitRename}
            onrenamecancel={cancelRenameBank}
            onstartrename={handleStartRename}
            onbankcontextmenu={handleBankContextMenu}
          />
        {/each}
      </ul>
    {/if}
  </div>

  {#if selectedBank}
    <div class="shrink-0 border-t border-c15-border bg-c15-surface-raised px-3 py-2">
      <div class="mb-2 flex items-center gap-2">
        <div class="min-w-0 flex-1 truncate text-xs font-medium text-c15-text" title={selectedBank.name}>
          {selectedBank.name}
        </div>
        <button
          type="button"
          class="shrink-0 rounded border border-c15-border px-2 py-0.5 text-[10px] text-c15-text hover:border-c15-accent hover:text-c15-accent"
          title="Rename (F2)"
          onclick={() => handleStartRename(selectedBank.uuid)}
        >
          Rename
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if selectedBank.attachedToUuid}
          <button
            type="button"
            class="rounded border border-c15-border px-2 py-1 text-[10px] text-c15-text hover:border-c15-accent hover:text-c15-accent"
            onclick={() => detachBank(selectedBank.uuid)}
          >
            Detach
          </button>
        {/if}
        <button
          type="button"
          class="rounded border border-red-900/60 px-2 py-1 text-[10px] text-red-400 hover:border-red-500 hover:bg-red-950/40"
          title="Delete (Del)"
          onclick={() => void deleteBank(selectedBank.uuid)}
        >
          Delete
        </button>
      </div>
      <p class="mt-2 text-[10px] leading-snug text-c15-text-muted">
        {#if sortingEnabled}
          Sorted by {sortLabel.toLowerCase()}. Right-click menu · Shift range · Ctrl toggle · F2 · Del.
        {:else}
          Tree shows attachment hierarchy. Right-click menu · Shift range · Ctrl toggle · F2 · Del.
        {/if}
      </p>
    </div>
  {/if}

  {#if bankContextMenu}
    <CanvasContextMenu
      clientX={bankContextMenu.clientX}
      clientY={bankContextMenu.clientY}
      canExportAll={$banks.length > 0 && !$bankMeta.loading}
      selectedCount={$bankMeta.selectedBankUuids.length}
      showCreateBank={false}
      showRenumberBySort={canRenumberBySort && $banks.length > 0}
      renumberBySortLabel={renumberBySortLabel}
      onrenamebank={handleRenameBankFromContextMenu}
      onbankinfo={handleBankInfoFromContextMenu}
      onrenumberbysort={handleRenumberBySortFromContextMenu}
      onexportall={handleExportAllFromContextMenu}
      onexportselected={handleExportSelectedFromContextMenu}
      onexportselectedxml={handleExportSelectedXmlFromContextMenu}
      onclose={closeBankContextMenu}
    />
  {/if}

  {#if bankInfoUuid}
    <BankInfoDialog bankUuid={bankInfoUuid} onclose={() => (bankInfoUuid = null)} />
  {/if}
</div>
