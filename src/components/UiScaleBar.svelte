<script lang="ts">
  import {
    BANK_LOD_THRESHOLD,
    formatBankDetailZoomPercent,
  } from '../lib/canvas/lod';
  import { getCanvasScreenSize } from '../lib/canvas/pointerPosition';
  import {
    formatCanvasZoomPercent,
    setZoom,
    VIEWPORT_ZOOM,
    viewport,
  } from '../lib/canvas/viewport.svelte';
  import { appSettings } from '../lib/model/bankState';
  import { setBankDetailMinZoom } from '../lib/model/settingsCommands';
  import {
    formatUiScalePercent,
    setUiScale,
    UI_SCALE,
    uiScale,
  } from '../lib/ui/uiScale';

  function onUiScaleInput(event: Event): void {
    setUiScale(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onCanvasZoomInput(event: Event): void {
    const next = Number((event.currentTarget as HTMLInputElement).value);
    const size = getCanvasScreenSize();
    if (size) {
      setZoom(next, size.width / 2, size.height / 2, size.width, size.height);
    } else {
      setZoom(next);
    }
  }

  function onBankDetailInput(event: Event): void {
    setBankDetailMinZoom(Number((event.currentTarget as HTMLInputElement).value));
  }
</script>

<div
  class="flex h-8 shrink-0 items-center gap-4 border-b border-c15-border bg-c15-bg px-4"
>
  <div
    class="flex items-center gap-3"
    title="Scale toolbar, sidebar, status bar, and dialogs — not the bank canvas"
  >
    <label for="ui-scale-slider" class="shrink-0 text-xs font-medium text-c15-text-muted">
      UI scale
    </label>
    <input
      id="ui-scale-slider"
      type="range"
      class="h-1.5 w-36 cursor-pointer accent-c15-accent"
      min={UI_SCALE.min}
      max={UI_SCALE.max}
      step={UI_SCALE.step}
      value={$uiScale}
      oninput={onUiScaleInput}
    />
    <span class="w-10 shrink-0 text-xs tabular-nums text-c15-text">{formatUiScalePercent($uiScale)}</span>
  </div>

  <div class="h-4 w-px shrink-0 bg-c15-border" aria-hidden="true"></div>

  <div
    class="flex min-w-0 items-center gap-3"
    title="Zoom the bank canvas (same range as mouse wheel). Anchors on the center of the view."
  >
    <label for="canvas-zoom-slider" class="shrink-0 text-xs font-medium text-c15-text-muted">
      Canvas zoom
    </label>
    <input
      id="canvas-zoom-slider"
      type="range"
      class="h-1.5 w-36 cursor-pointer accent-c15-accent"
      min={VIEWPORT_ZOOM.min}
      max={VIEWPORT_ZOOM.max}
      step={VIEWPORT_ZOOM.step}
      value={viewport.zoom}
      oninput={onCanvasZoomInput}
    />
    <span class="w-10 shrink-0 text-xs tabular-nums text-c15-text">
      {formatCanvasZoomPercent(viewport.zoom)}
    </span>
  </div>

  <div class="h-4 w-px shrink-0 bg-c15-border" aria-hidden="true"></div>

  <div
    class="flex min-w-0 items-center gap-3"
    title="Below this canvas zoom, banks simplify to plain boxes (no preset rows). Higher values simplify earlier and improve performance when zoomed out."
  >
    <label for="bank-detail-slider" class="shrink-0 text-xs font-medium text-c15-text-muted">
      Bank detail
    </label>
    <input
      id="bank-detail-slider"
      type="range"
      class="h-1.5 w-36 cursor-pointer accent-c15-accent"
      min={BANK_LOD_THRESHOLD.min}
      max={BANK_LOD_THRESHOLD.max}
      step={BANK_LOD_THRESHOLD.step}
      value={$appSettings.bankDetailMinZoom}
      oninput={onBankDetailInput}
    />
    <span class="w-10 shrink-0 text-xs tabular-nums text-c15-text">
      {formatBankDetailZoomPercent($appSettings.bankDetailMinZoom)}
    </span>
  </div>
</div>
