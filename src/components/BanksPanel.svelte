<script lang="ts">
  import {
    bankMeta,
    banks,
    cancelRenameBank,
    createBank,
    deleteBank,
    detachBank,
    renameBank,
    startRenameBank,
  } from '../lib/model/bankStore';
  import { buildBankForest, flattenBankForest } from '../lib/model/bankTree';
  import BankTreeCluster from './BankTreeCluster.svelte';

  const selectedBank = $derived.by(() => {
    const uuids = $bankMeta.selectedBankUuids;
    if (uuids.length !== 1) return undefined;
    return $banks.find((bank) => bank.uuid === uuids[0]);
  });
  const treeForest = $derived(buildBankForest($banks));
  const treeOrderUuids = $derived(
    flattenBankForest(treeForest).map((node) => node.bank.uuid),
  );
  const bankIndexByUuid = $derived(
    new Map($banks.map((bank, index) => [bank.uuid, index])),
  );

  let renameDraft = $state('');
  let filterQuery = $state('');

  $effect(() => {
    const renamingUuid = $bankMeta.renamingBankUuid;
    if (!renamingUuid || $bankMeta.renameSurface !== 'sidebar') return;
    const bank = $banks.find((b) => b.uuid === renamingUuid);
    if (bank) renameDraft = bank.name;
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
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
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
    {:else}
      <ul class="py-1">
        {#each treeForest as root (root.bank.uuid)}
          <BankTreeCluster
            {root}
            {bankIndexByUuid}
            {treeOrderUuids}
            {filterQuery}
            renamingUuid={$bankMeta.renamingBankUuid}
            renameValue={renameDraft}
            onrenameinput={(value) => {
              renameDraft = value;
            }}
            onrenamecommit={commitRename}
            onrenamecancel={cancelRenameBank}
            onstartrename={handleStartRename}
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
          onclick={() => deleteBank(selectedBank.uuid)}
        >
          Delete
        </button>
      </div>
      <p class="mt-2 text-[10px] leading-snug text-c15-text-muted">
        Tree shows attachment hierarchy. Shift range · Ctrl toggle · F2 rename · Del delete.
      </p>
    </div>
  {/if}
</div>