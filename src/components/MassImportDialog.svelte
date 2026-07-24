<script lang="ts">
  import type { ImportableFile } from '../lib/io/folderPicker';
  import type { FolderBankSort } from '../lib/layout/smartLayout';
  import type { MassImportCanvasMode } from '../lib/model/massImport';
  import type { MassImportScanResult } from '../lib/model/massImportScan';

  interface Props {
    open: boolean;
    scanning: boolean;
    importing: boolean;
    importProgress: number;
    importTotal: number;
    scanResult: MassImportScanResult | null;
    hasExistingBanks: boolean;
    onconfirm?: (options: {
      canvasMode: MassImportCanvasMode;
      showSynthZone: boolean;
      sortBy: FolderBankSort;
    }) => void;
    oncancel?: () => void;
  }

  let {
    open,
    scanning,
    importing,
    importProgress,
    importTotal,
    scanResult,
    hasExistingBanks,
    onconfirm,
    oncancel,
  }: Props = $props();

  let canvasMode = $state<MassImportCanvasMode>('replace');
  let showSynthZone = $state(true);
  let sortByCreationDate = $state(false);
  let groupsExpanded = $state(false);

  $effect(() => {
    if (open && hasExistingBanks) {
      canvasMode = 'merge';
    }
    if (open && !hasExistingBanks) {
      canvasMode = 'replace';
    }
  });

  function handleConfirm(): void {
    onconfirm?.({
      canvasMode,
      showSynthZone,
      sortBy: sortByCreationDate ? 'creationDate' : 'alphabetic',
    });
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (importing) return;
    if (event.target === event.currentTarget) oncancel?.();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="app-ui fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    onclick={handleBackdropClick}
  >
    <div
      class="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-c15-border bg-c15-surface shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mass-import-title"
    >
      <div class="border-b border-c15-border px-5 py-4">
        <h2 id="mass-import-title" class="text-base font-semibold text-c15-text">
          Import banks
        </h2>
        <p class="mt-1 text-xs text-c15-text-muted">
          Banks in each folder attach together and pack around the synth parameter zone (red no-go).
        </p>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4">
        {#if scanning}
          <div class="flex flex-col items-center py-8">
            <div
              class="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-c15-border border-t-c15-accent"
            ></div>
            <p class="text-sm text-c15-text">Scanning folder…</p>
          </div>
        {:else if scanResult}
          <div class="mb-4 rounded border border-c15-border bg-c15-surface-raised px-3 py-2">
            <p class="text-sm font-medium text-c15-text">
              {scanResult.totalFiles} files · {scanResult.groups.length} folders · {scanResult.totalPresets.toLocaleString()} presets
            </p>
            <p class="text-xs text-c15-text-muted">
              {scanResult.totalBanks} banks from <span class="text-c15-accent">{scanResult.folderLabel}</span>
            </p>
            {#if scanResult.errorCount > 0}
              <p class="mt-1 text-xs text-amber-400">
                {scanResult.errorCount} file{scanResult.errorCount === 1 ? '' : 's'} could not be parsed
              </p>
            {/if}
          </div>

          <button
            type="button"
            class="mb-4 flex w-full items-center justify-between rounded border border-c15-border px-3 py-2 text-left text-xs text-c15-text-muted hover:border-c15-accent"
            onclick={() => (groupsExpanded = !groupsExpanded)}
          >
            <span>Folder breakdown ({scanResult.groups.length})</span>
            <span>{groupsExpanded ? '▲' : '▼'}</span>
          </button>

          {#if groupsExpanded}
            <ul class="mb-4 max-h-32 space-y-1 overflow-y-auto text-xs text-c15-text-muted">
              {#each scanResult.groups as group}
                <li class="flex justify-between gap-2">
                  <span class="truncate">{group.folder}</span>
                  <span class="shrink-0 tabular-nums">
                    {group.fileCount} files · {group.presetCount} presets
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if !importing}
            <fieldset class="mb-4">
              <legend class="mb-2 text-xs font-medium uppercase tracking-wide text-c15-text-muted">
                Canvas
              </legend>
              <div class="flex gap-3">
                <label class="flex flex-1 cursor-pointer items-start gap-2 rounded border border-c15-border px-3 py-2 text-xs hover:border-c15-accent {canvasMode === 'replace' ? 'border-c15-accent bg-c15-accent/10' : ''}">
                  <input
                    type="radio"
                    name="canvas-mode"
                    value="replace"
                    class="mt-0.5 accent-c15-accent"
                    bind:group={canvasMode}
                  />
                  <span>
                    <span class="block font-medium text-c15-text">Replace canvas</span>
                    <span class="text-c15-text-muted">Clear existing banks and import fresh</span>
                  </span>
                </label>
                <label class="flex flex-1 cursor-pointer items-start gap-2 rounded border border-c15-border px-3 py-2 text-xs hover:border-c15-accent {canvasMode === 'merge' ? 'border-c15-accent bg-c15-accent/10' : ''} {!hasExistingBanks ? 'opacity-50' : ''}">
                  <input
                    type="radio"
                    name="canvas-mode"
                    value="merge"
                    class="mt-0.5 accent-c15-accent"
                    bind:group={canvasMode}
                    disabled={!hasExistingBanks}
                  />
                  <span>
                    <span class="block font-medium text-c15-text">Merge</span>
                    <span class="text-c15-text-muted">Keep existing banks; place new ones in free space</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset class="mb-4">
              <legend class="mb-2 text-xs font-medium uppercase tracking-wide text-c15-text-muted">
                Bank order within each folder
              </legend>
              <label class="flex cursor-pointer items-start gap-2 rounded border border-c15-border px-3 py-2 text-xs hover:border-c15-accent {!sortByCreationDate ? 'border-c15-accent bg-c15-accent/10' : ''}">
                <input
                  type="radio"
                  name="sort-mode"
                  class="mt-0.5 accent-c15-accent"
                  checked={!sortByCreationDate}
                  onchange={() => (sortByCreationDate = false)}
                />
                <span>
                  <span class="block font-medium text-c15-text">Alphabetic (default)</span>
                  <span class="text-c15-text-muted">Honors bank names like “Fuxi A 03”, “Fuxi B 02”</span>
                </span>
              </label>
              <label class="mt-2 flex cursor-pointer items-start gap-2 rounded border border-c15-border px-3 py-2 text-xs hover:border-c15-accent {sortByCreationDate ? 'border-c15-accent bg-c15-accent/10' : ''}">
                <input
                  type="radio"
                  name="sort-mode"
                  class="mt-0.5 accent-c15-accent"
                  checked={sortByCreationDate}
                  onchange={() => (sortByCreationDate = true)}
                />
                <span>
                  <span class="block font-medium text-c15-text">Creation date</span>
                  <span class="text-c15-text-muted">Uses import / serialize timestamps when available</span>
                </span>
              </label>
            </fieldset>

            <label class="flex cursor-pointer items-center gap-2 text-xs text-c15-text-muted">
              <input
                type="checkbox"
                class="accent-c15-accent"
                bind:checked={showSynthZone}
              />
              Show synth parameter zone (BORDERS overlay)
            </label>
          {:else}
            <div class="py-4">
              <p class="mb-2 text-sm text-c15-text">
                Importing… {importProgress} / {importTotal}
              </p>
              <div class="h-2 overflow-hidden rounded-full bg-c15-border">
                <div
                  class="h-full bg-c15-accent transition-all duration-150"
                  style:width="{importTotal > 0 ? (importProgress / importTotal) * 100 : 0}%"
                ></div>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <div class="flex justify-end gap-2 border-t border-c15-border px-5 py-3">
        <button
          type="button"
          class="rounded border border-c15-border px-4 py-1.5 text-xs text-c15-text hover:border-c15-accent disabled:opacity-50"
          disabled={importing}
          onclick={() => oncancel?.()}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded border border-c15-accent bg-c15-accent/20 px-4 py-1.5 text-xs font-medium text-c15-accent hover:bg-c15-accent/30 disabled:opacity-50"
          disabled={scanning || importing || !scanResult || scanResult.totalBanks === 0}
          onclick={handleConfirm}
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  </div>
{/if}