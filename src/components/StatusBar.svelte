<script lang="ts">
  import { liveMode } from '../lib/live/liveMode';
  import { bankMeta, banks, sessionDirty } from '../lib/model/bankStore';

  const selectionSummary = $derived.by(() => {
    const meta = $bankMeta;
    const count = meta.selectedBankUuids.length;
    if (count === 0) return null;
    if (count > 1) {
      return { kind: 'multi' as const, count };
    }
    const bank = $banks.find((b) => b.uuid === meta.selectedBankUuids[0]);
    return bank ? { kind: 'single' as const, bank } : null;
  });

  const liveActive = $derived(
    $liveMode.connection === 'live' ||
      $liveMode.connection === 'connecting' ||
      $liveMode.connection === 'reconnecting',
  );
</script>

<footer
  class="app-ui flex h-7 shrink-0 items-center gap-4 border-t px-4 text-xs text-c15-text-muted {liveActive
    ? 'border-emerald-800/80 bg-emerald-950/30'
    : 'border-c15-border bg-c15-surface'}"
>
  {#if liveActive}
    <span
      class="font-medium tracking-wide text-emerald-300"
      title={$liveMode.detail ?? 'Live mode'}
    >
      {$liveMode.connection === 'live' ? 'LIVE' : $liveMode.connection.toUpperCase()}
      {#if $liveMode.connection === 'live' && !$liveMode.libraryReady}
        <span class="font-normal text-amber-200/90">· sync…</span>
      {/if}
    </span>
    <span class="text-c15-border">|</span>
  {/if}
  <span>{$banks.length} bank{$banks.length === 1 ? '' : 's'}</span>

  {#if $sessionDirty}
    <span class="text-c15-border">|</span>
    <span class="text-amber-400/90">Unsaved changes</span>
  {/if}

  {#if $bankMeta.lastImportFilename}
    <span class="text-c15-border">|</span>
    <span class="max-w-48 truncate" title={$bankMeta.lastImportFilename}>
      {$bankMeta.lastImportFilename}
      {#if $bankMeta.lastImportMode}
        <span class="text-c15-text-muted">({$bankMeta.lastImportMode})</span>
      {/if}
    </span>
  {/if}

  {#if $bankMeta.loading}
    <span class="text-c15-border">|</span>
    <span class="text-c15-accent">Importing…</span>
  {:else if $bankMeta.error}
    <span class="text-c15-border">|</span>
    <span class="truncate text-red-400" title={$bankMeta.error}>{$bankMeta.error}</span>
  {:else if selectionSummary?.kind === 'multi'}
    <span class="text-c15-border">|</span>
    <span>{selectionSummary.count} banks selected</span>
  {:else if selectionSummary?.kind === 'single'}
    <span class="text-c15-border">|</span>
    <span class="truncate">
      {selectionSummary.bank.name} · ({Math.round(selectionSummary.bank.x)}, {Math.round(selectionSummary.bank.y)}) · {selectionSummary.bank.presets.length}
      presets
    </span>
  {:else if $banks.length > 0}
    <span class="text-c15-border">|</span>
    <span>Click a bank to select</span>
  {:else}
    <span class="text-c15-border">|</span>
    <span>No banks loaded</span>
  {/if}
</footer>