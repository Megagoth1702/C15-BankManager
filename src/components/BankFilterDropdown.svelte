<script lang="ts">
  import { banks } from '../lib/model/bankStore';
  import { buildBankForest, flattenBankForest } from '../lib/model/bankTree';
  import { presetSearchState } from '../lib/search/searchState';

  let open = $state(false);

  const orderedBanks = $derived(
    flattenBankForest(buildBankForest($banks)).map((node, index) => ({
      uuid: node.bank.uuid,
      name: node.bank.name,
      order: index + 1,
    })),
  );

  const buttonLabel = $derived.by(() => {
    const selected = $presetSearchState.bankUuids;
    if (selected.length === 0 || selected.length === $banks.length) return 'All Banks';
    if (selected.length === 1) {
      const bank = orderedBanks.find((b) => b.uuid === selected[0]);
      if (bank) return `${String(bank.order).padStart(2, '0')} - ${bank.name}`;
      return '1 bank';
    }
    return 'Multiple Banks';
  });

  function toggleBank(uuid: string): void {
    presetSearchState.update((s) => {
      const next = s.bankUuids.includes(uuid)
        ? s.bankUuids.filter((id) => id !== uuid)
        : [...s.bankUuids, uuid];
      return { ...s, bankUuids: next };
    });
  }

  function selectAll(): void {
    presetSearchState.update((s) => ({
      ...s,
      bankUuids: $banks.map((b) => b.uuid),
    }));
  }

  function selectNone(): void {
    presetSearchState.update((s) => ({ ...s, bankUuids: [] }));
  }
</script>

<div class="relative">
  <button
    type="button"
    class="flex w-full items-center justify-between rounded border border-c15-border bg-c15-surface-raised px-2 py-1 text-left text-xs text-c15-text hover:border-c15-accent/50"
    onclick={() => {
      open = !open;
    }}
  >
    <span class="truncate">{buttonLabel}</span>
    <span class="ml-1 shrink-0 text-c15-text-muted">▾</span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex gap-2 border-b border-c15-border/50 px-2 py-1">
        <button type="button" class="text-[10px] text-c15-accent" onclick={selectAll}>All</button>
        <button type="button" class="text-[10px] text-c15-text-muted" onclick={selectNone}>None</button>
      </div>
      {#each orderedBanks as bank (bank.uuid)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-c15-surface"
          onclick={() => toggleBank(bank.uuid)}
        >
          <span
            class="inline-block h-3 w-3 shrink-0 rounded-sm border border-c15-border
              {$presetSearchState.bankUuids.length === 0 || $presetSearchState.bankUuids.includes(bank.uuid)
              ? 'bg-c15-accent'
              : ''}"
          ></span>
          <span class="truncate">{String(bank.order).padStart(2, '0')} - {bank.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<svelte:window
  onclick={() => {
    open = false;
  }}
/>