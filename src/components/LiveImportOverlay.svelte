<script lang="ts">
  /**
   * Full-app cold overlay while the C15 is importing banks.
   * Blocks pointer events so the user cannot thrash layout/presets mid-job.
   * Sync progress comes from liveImportJob (HTTP send + WS document wait).
   */
  import { liveImportJob } from '../lib/live/liveImportJob';

  const showLive = $derived($liveImportJob.active || $liveImportJob.phase === 'error');

  function progressText(): string {
    const j = $liveImportJob;
    if (j.total > 0 && j.current > 0) {
      return `${j.current} / ${j.total}`;
    }
    return '';
  }
</script>

{#if showLive}
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
    role="alertdialog"
    aria-modal="true"
    aria-busy="true"
    aria-label={$liveImportJob.label || 'C15 busy'}
  >
    <div
      class="app-ui mx-4 max-w-md rounded-lg border border-amber-700/60 bg-c15-surface-raised px-8 py-7 text-center shadow-2xl shadow-black/50"
    >
      {#if $liveImportJob.phase === 'error'}
        <div
          class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-500 text-red-400"
          aria-hidden="true"
        >
          !
        </div>
        <p class="text-sm font-semibold text-red-300">
          {$liveImportJob.label || 'C15 import failed'}
        </p>
        {#if $liveImportJob.detail || $liveImportJob.error}
          <p class="mt-2 text-xs leading-relaxed text-c15-text-muted">
            {$liveImportJob.detail || $liveImportJob.error}
          </p>
        {/if}
      {:else}
        <div
          class="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-amber-900/80 border-t-amber-400"
          aria-hidden="true"
        ></div>
        <p class="text-sm font-semibold tracking-wide text-amber-100">
          {$liveImportJob.label || 'C15 is busy…'}
        </p>
        {#if $liveImportJob.detail}
          <p class="mt-2 text-xs text-c15-text-muted">{$liveImportJob.detail}</p>
        {/if}
        {#if progressText()}
          <p class="mt-3 font-mono text-lg tabular-nums text-amber-300/90">
            {progressText()}
          </p>
        {/if}
        <p class="mt-4 text-[11px] leading-relaxed text-c15-text-muted">
          The synthesizer is creating or loading banks. Editing is frozen until the
          device library catches up — please wait.
        </p>
      {/if}
    </div>
  </div>
{/if}
