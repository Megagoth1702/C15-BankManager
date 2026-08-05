<script lang="ts">
  import {
    pickFolderViaDirectoryPicker,
    supportsDirectoryPicker,
    toImportableFiles,
    type ImportableFile,
  } from '../lib/io/folderPicker';
  import type { FolderBankSort } from '../lib/layout/smartLayout';
  import type { MassImportCanvasMode } from '../lib/model/massImport';
  import { scanMassImport, type MassImportScanResult } from '../lib/model/massImportScan';
  import {
    appSettings,
    bankMeta,
    banks,
    canRedo,
    canUndo,
    createBank,
    executeMassImport,
    exportAllAsBackup,
    exportSelectedBanks,
    exportSelectedBanksAsXml,
    exportSelectedBanksAsXmlLabel,
    exportSelectedBanksLabel,
    importFile,
    realignAttachedBanks,
    redo,
    setShowDebugShapes,
    setShowSynthZone,
    undo,
  } from '../lib/model/bankStore';
  import { countAttachedBanks } from '../lib/model/positioning';
  import MassImportDialog from './MassImportDialog.svelte';

  let realignMessage = $state<string | null>(null);
  let exportMessage = $state<string | null>(null);
  let realignTimer: ReturnType<typeof setTimeout> | undefined;
  let exportTimer: ReturnType<typeof setTimeout> | undefined;
  let exportMenuOpen = $state(false);

  /** Debug shapes toggle is a power-user control: only visible while Ctrl/Meta+Shift are held. */
  let debugShapesShortcutHeld = $state(false);

  function syncDebugShapesShortcut(event: KeyboardEvent | null): void {
    if (!event) {
      debugShapesShortcutHeld = false;
      return;
    }
    debugShapesShortcutHeld = (event.ctrlKey || event.metaKey) && event.shiftKey;
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    syncDebugShapesShortcut(event);
  }

  function onWindowKeyUp(event: KeyboardEvent): void {
    syncDebugShapesShortcut(event);
  }

  function onWindowBlur(): void {
    debugShapesShortcutHeld = false;
  }

  let massImportOpen = $state(false);
  let massImportScanning = $state(false);
  let massImportImporting = $state(false);
  let massImportProgress = $state(0);
  let massImportTotal = $state(0);
  let massImportScan = $state<MassImportScanResult | null>(null);
  let pendingImportFiles = $state<ImportableFile[]>([]);

  const attachedCount = $derived(countAttachedBanks($banks));
  const canRealign = $derived($banks.length > 0 && attachedCount > 0 && !$bankMeta.loading);
  const canExport = $derived($banks.length > 0 && !$bankMeta.loading);
  const selectedBankCount = $derived($bankMeta.selectedBankUuids.length);
  const selectedExportLabel = $derived(exportSelectedBanksLabel(selectedBankCount));
  const selectedXmlExportLabel = $derived(exportSelectedBanksAsXmlLabel(selectedBankCount));

  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;

  function openFilePicker(): void {
    fileInput?.click();
  }

  async function beginMassImportFlow(files: ImportableFile[]): Promise<void> {
    if (files.length === 0) {
      bankMeta.update((m) => ({
        ...m,
        error: 'No .xml or .nlbackup files found',
      }));
      return;
    }

    // Always show replace/merge dialog for multi-file and folder mass imports.
    pendingImportFiles = files;
    massImportOpen = true;
    massImportScanning = true;
    massImportScan = null;
    massImportProgress = 0;
    massImportTotal = files.length;

    try {
      massImportScan = await scanMassImport(files, (done, total) => {
        massImportProgress = done;
        massImportTotal = total;
      });
    } finally {
      massImportScanning = false;
    }
  }

  async function openFolderImport(): Promise<void> {
    if (supportsDirectoryPicker()) {
      try {
        const files = await pickFolderViaDirectoryPicker();
        if (!files) return;
        await beginMassImportFlow(files);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('Directory picker failed, falling back to folder input:', err);
      }
    }

    folderInput?.click();
  }

  async function onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const list = input.files ? [...input.files] : [];
    input.value = '';
    if (list.length === 0) return;

    // One file: preserve single-file semantics (viewport-center single-bank XML, etc.).
    // Multiple: mass-import pipeline + smart folder-chain layout (same as Import folder).
    if (list.length === 1) {
      await importFile(list[0]!);
      return;
    }

    await beginMassImportFlow(toImportableFiles(list));
  }

  async function onFolderSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    await beginMassImportFlow(toImportableFiles([...input.files]));
    input.value = '';
  }

  function closeMassImportDialog(): void {
    if (massImportImporting) return;
    massImportOpen = false;
    pendingImportFiles = [];
    massImportScan = null;
  }

  async function confirmMassImport(options: {
    canvasMode: MassImportCanvasMode;
    showSynthZone: boolean;
    sortBy: FolderBankSort;
  }): Promise<void> {
    if (pendingImportFiles.length === 0) return;

    massImportImporting = true;
    massImportProgress = 0;
    massImportTotal = pendingImportFiles.length;

    try {
      await executeMassImport(pendingImportFiles, options, (done, total) => {
        massImportProgress = done;
        massImportTotal = total;
      });
      massImportOpen = false;
      pendingImportFiles = [];
      massImportScan = null;
    } finally {
      massImportImporting = false;
    }
  }

  function showRealignFeedback(message: string): void {
    realignMessage = message;
    if (realignTimer) clearTimeout(realignTimer);
    realignTimer = setTimeout(() => {
      realignMessage = null;
    }, 2500);
  }

  function handleRealign(): void {
    const moved = realignAttachedBanks();
    showRealignFeedback(
      moved > 0 ? `Realigned ${moved} bank${moved === 1 ? '' : 's'}` : 'All attached banks already aligned',
    );
  }

  function showExportFeedback(message: string): void {
    exportMessage = message;
    if (exportTimer) clearTimeout(exportTimer);
    exportTimer = setTimeout(() => {
      exportMessage = null;
    }, 2500);
  }

  function closeExportMenu(): void {
    exportMenuOpen = false;
  }

  function toggleExportMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (!canExport) return;
    exportMenuOpen = !exportMenuOpen;
  }

  function handleExportAll(): void {
    closeExportMenu();
    if (exportAllAsBackup()) {
      showExportFeedback('Backup downloaded');
    }
  }

  function handleExportSelected(): void {
    closeExportMenu();
    if (exportSelectedBanks()) {
      showExportFeedback(
        selectedBankCount === 1
          ? '1 bank backup downloaded'
          : `${selectedBankCount} banks backup downloaded`,
      );
    }
  }

  async function handleExportSelectedAsXml(): Promise<void> {
    closeExportMenu();
    const result = await Promise.resolve(exportSelectedBanksAsXml());
    if (result) {
      showExportFeedback(
        selectedBankCount === 1
          ? '1 bank XML downloaded'
          : `${selectedBankCount} bank XMLs downloaded`,
      );
    }
  }

  function onWindowClick(): void {
    if (exportMenuOpen) closeExportMenu();
  }

  function onExportMenuKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && exportMenuOpen) {
      event.preventDefault();
      closeExportMenu();
    }
  }

</script>

<svelte:window
  onkeydown={(e) => {
    onWindowKeyDown(e);
    onExportMenuKeyDown(e);
  }}
  onkeyup={onWindowKeyUp}
  onblur={onWindowBlur}
  onclick={onWindowClick}
/>

<header
  class="app-ui flex h-12 shrink-0 items-center gap-3 border-b border-c15-border bg-c15-surface px-4"
>
  <h1 class="text-sm font-semibold tracking-wide text-c15-accent">C15 Bank Manager</h1>
  <span class="text-xs text-c15-text-muted">Offline preset bank arrangement</span>

  <div class="ml-auto flex items-center gap-3">
    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!$canUndo}
      title="Undo"
      onclick={() => undo()}
    >
      Undo
    </button>
    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!$canRedo}
      title="Redo"
      onclick={() => redo()}
    >
      Redo
    </button>
    <label
      class="flex cursor-pointer items-center gap-1.5 text-xs text-c15-text-muted"
      title="Show synth GUI no-go zone on canvas"
    >
      <input
        type="checkbox"
        class="accent-c15-accent"
        checked={$appSettings.showSynthZone}
        onchange={(e) => setShowSynthZone(e.currentTarget.checked)}
      />
      Synth zone
    </label>
    {#if debugShapesShortcutHeld}
      <label
        class="flex cursor-pointer items-center gap-1.5 text-xs text-c15-text-muted"
        title="Show calibration crosses, width rulers, and labeled bank geometry (Ctrl/Cmd+Shift to show this control)"
      >
        <input
          type="checkbox"
          class="accent-c15-accent"
          checked={$appSettings.showDebugShapes}
          onchange={(e) => setShowDebugShapes(e.currentTarget.checked)}
        />
        Debug shapes
      </label>
    {/if}
    {#if $banks.length > 0}
      <button
        type="button"
        class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canRealign}
        title="Snap attached banks to recommended positions"
        onclick={handleRealign}
      >
        Re-align
      </button>
      {#if realignMessage}
        <span class="text-xs text-c15-accent">{realignMessage}</span>
      {/if}
      <div class="relative">
        <button
          type="button"
          class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canExport}
          title="Export .nlbackup backup or single-bank .xml files"
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          onclick={toggleExportMenu}
        >
          Export ▾
        </button>
        {#if exportMenuOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="absolute right-0 top-full z-30 mt-1 min-w-[240px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
            onclick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
              onclick={handleExportAll}
            >
              Export all as backup
            </button>
            {#if selectedBankCount > 0}
              <button
                type="button"
                class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
                onclick={handleExportSelected}
              >
                {selectedExportLabel}
              </button>
              <button
                type="button"
                class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
                onclick={handleExportSelectedAsXml}
              >
                {selectedXmlExportLabel}
              </button>
            {/if}
          </div>
        {/if}
      </div>
      {#if exportMessage}
        <span class="text-xs text-c15-accent">{exportMessage}</span>
      {/if}
    {/if}

    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent"
      title="Create empty bank (Ctrl+Shift+N)"
      onclick={() => createBank()}
    >
      New bank
    </button>
    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={$bankMeta.loading}
      onclick={openFilePicker}
    >
      {$bankMeta.loading ? 'Importing…' : 'Import files'}
    </button>
    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={$bankMeta.loading}
      onclick={openFolderImport}
    >
      Import folder
    </button>
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept=".nlbackup,.xml,application/gzip,application/xml,text/xml"
      class="hidden"
      onchange={onFileSelected}
    />
    <input
      bind:this={folderInput}
      type="file"
      class="hidden"
      multiple
      webkitdirectory
      onchange={onFolderSelected}
    />
  </div>
</header>

<MassImportDialog
  open={massImportOpen}
  scanning={massImportScanning}
  importing={massImportImporting}
  importProgress={massImportProgress}
  importTotal={massImportTotal}
  scanResult={massImportScan}
  hasExistingBanks={$banks.length > 0}
  onconfirm={confirmMassImport}
  oncancel={closeMassImportDialog}
/>