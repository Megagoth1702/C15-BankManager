<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import UiScaleBar from './components/UiScaleBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Canvas from './components/Canvas.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import DebugLogPanel from './components/DebugLogPanel.svelte';
  import { shouldIgnoreKeyboardShortcut } from './lib/keyboard';
  import {
    bankMeta,
    cancelRenameBank,
    cancelRenamePreset,
    createBank,
    handleDeleteKeyPress,
    getPrimarySelectedUuid,
    selectBank,
    sessionDirty,
    startRenameBank,
    startRenamePreset,
  } from './lib/model/bankStore';

  function onGlobalKeyDown(event: KeyboardEvent): void {
    if (shouldIgnoreKeyboardShortcut(event.target)) return;

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

    if (event.code === 'Delete' || event.code === 'Backspace') {
      const hasTarget =
        ($bankMeta.deleteFocus === 'preset' && $bankMeta.selectedPresetUuids.length > 0) ||
        ($bankMeta.deleteFocus === 'bank' && $bankMeta.selectedBankUuids.length > 0);
      if (hasTarget) {
        event.preventDefault();
        handleDeleteKeyPress();
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
  <DebugLogPanel />
</div>