<script lang="ts">
  import {
    formatUiScalePercent,
    setUiScale,
    UI_SCALE,
    uiScale,
  } from '../lib/ui/uiScale';

  function onSliderInput(event: Event): void {
    setUiScale(Number((event.currentTarget as HTMLInputElement).value));
  }
</script>

<div
  class="flex h-8 shrink-0 items-center gap-3 border-b border-c15-border bg-c15-bg px-4"
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
    oninput={onSliderInput}
  />
  <span class="w-10 shrink-0 text-xs tabular-nums text-c15-text">{formatUiScalePercent($uiScale)}</span>
</div>