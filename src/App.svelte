<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import UiScaleBar from './components/UiScaleBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Canvas from './components/Canvas.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import DebugLogPanel from './components/DebugLogPanel.svelte';
  import LiveImportOverlay from './components/LiveImportOverlay.svelte';
  import AppDialogHost from './components/AppDialogHost.svelte';
  import { isAppDebugEnabled } from './lib/debug/debugFlags';
  import { shouldIgnoreKeyboardShortcut } from './lib/keyboard';
  import { getLiveImportBusy } from './lib/live/liveImportJob';
  import {
    bankMeta,
    cancelRenameBank,
    cancelRenamePreset,
    createBank,
    handleDeleteKeyPress,
    getPrimarySelectedUuid,
    loadSelectedPreset,
    selectBank,
    sessionDirty,
    startRenameBank,
    startRenamePreset,
  } from './lib/model/bankStore';

  function onGlobalKeyDown(event: KeyboardEvent): void {
    if (shouldIgnoreKeyboardShortcut(event.target)) return;

    // Freeze editing while the C15 import job is running (Option B cold UI).
    if (getLiveImportBusy()) {
      if (
        event.code === 'Delete' ||
        event.code === 'Backspace' ||
        event.code === 'F2' ||
        event.code === 'Enter' ||
        event.code === 'KeyN'
      ) {
        event.preventDefault();
      }
      return;
    }

    if (event.code === 'Escape') {
      if ($bankMeta.renamingPreset) {
        cancelRenamePreset();
        return;
      }
      if ($bankMeta.renamingBankUuid) {
        cancelRenameBank();
        return;
      }
      if ($bankMeta.selectedBankUuids.length > 0) {
        selectBank(null);
      }
      return;
    }

    if (
      event.code === 'F2' &&
      $bankMeta.deleteFocus === 'preset' &&
      $bankMeta.selectedPresetUuids.length === 1 &&
      $bankMeta.presetSelectionBankUuid
    ) {
      event.preventDefault();
      const surface = $bankMeta.selectionSurface ?? 'canvas';
      startRenamePreset(
        $bankMeta.presetSelectionBankUuid,
        $bankMeta.selectedPresetUuids[0]!,
        surface,
      );
      return;
    }

    const uuid = getPrimarySelectedUuid();

    if (event.code === 'F2' && uuid) {
      event.preventDefault();
      const surface = $bankMeta.selectionSurface ?? 'canvas';
      startRenameBank(uuid, surface);
      return;
    }

    // NonMaps: Enter loads the selected preset into the edit buffer (Live).
    if (
      event.code === 'Enter' &&
      !$bankMeta.renamingPreset &&
      !$bankMeta.renamingBankUuid &&
      $bankMeta.deleteFocus === 'preset' &&
      $bankMeta.selectedPresetUuids.length > 0
    ) {
      event.preventDefault();
      loadSelectedPreset();
      return;
    }

    if (event.code === 'Delete' || event.code === 'Backspace') {
      const hasTarget =
        ($bankMeta.deleteFocus === 'preset' && $bankMeta.selectedPresetUuids.length > 0) ||
        ($bankMeta.deleteFocus === 'bank' && $bankMeta.selectedBankUuids.length > 0);
      if (hasTarget) {
        event.preventDefault();
        void handleDeleteKeyPress();
      }
      return;
    }

    if (event.code === 'KeyN' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
      event.preventDefault();
      createBank({ atPointer: true });
    }
  }
</script>

<svelte:window
  onkeydown={onGlobalKeyDown}
  onbeforeunload={(event) => {
    if ($sessionDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }}
/>

<div class="flex h-full flex-col">
  <UiScaleBar />
  <Toolbar />

  <div class="flex min-h-0 flex-1">
    <Sidebar />
    <Canvas />
  </div>

  <StatusBar />
  {#if isAppDebugEnabled()}
    <DebugLogPanel />
  {/if}
</div>

<LiveImportOverlay />
<AppDialogHost />