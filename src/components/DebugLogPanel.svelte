<script lang="ts">
  import { CURRENT_BUCKET } from '../lib/debug/bucket';
  import {
    downloadLayoutImportLog,
    hasLayoutImportLog,
  } from '../lib/layout/layoutImportReport';
  import {
    downloadLogFile,
    getLogBucket,
    getLogEntries,
    logVersion,
  } from '../lib/debug/sessionLog';

  let expanded = $state(false);

  const levelColor: Record<string, string> = {
    info: 'text-c15-text-muted',
    warn: 'text-yellow-500',
    error: 'text-red-400',
    debug: 'text-c15-accent-dim',
  };

  const entries = $derived.by(() => {
    $logVersion;
    return getLogEntries();
  });

  const showLayoutLogButton = $derived.by(() => {
    $logVersion;
    return hasLayoutImportLog();
  });
</script>

<div class="app-ui border-t border-c15-border bg-c15-surface">
  <div class="flex h-7 items-center gap-2 px-3 text-xs">
    <button
      type="button"
      class="text-c15-text-muted hover:text-c15-accent"
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? '▼' : '▶'} Debug log ({entries.length}) · {getLogBucket() || CURRENT_BUCKET}
    </button>
    {#if showLayoutLogButton}
      <button
        type="button"
        class="ml-auto text-c15-text-muted hover:text-c15-accent"
        title="Layout-only log from the last mass import"
        onclick={() => downloadLayoutImportLog()}
      >
        Layout report
      </button>
    {/if}
    <button
      type="button"
      class="{showLayoutLogButton ? '' : 'ml-auto '}text-c15-text-muted hover:text-c15-accent"
      onclick={downloadLogFile}
      disabled={entries.length === 0}
    >
      Download log
    </button>
  </div>

  {#if expanded}
    <div
      class="max-h-36 overflow-y-auto border-t border-c15-border/50 bg-c15-bg px-3 py-1 font-mono text-[10px] leading-relaxed"
    >
      {#if entries.length === 0}
        <p class="py-2 text-c15-text-muted">No log entries yet.</p>
      {:else}
        {#each entries as entry (entry.id)}
          <div class="py-0.5 {levelColor[entry.level]}">
            <span class="text-c15-text-muted">{entry.time}</span>
            <span class="mx-1 text-c15-accent">[{entry.step}]</span>
            {entry.message}
            {#if entry.detail}
              <span class="text-c15-text-muted"> — {entry.detail}</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>