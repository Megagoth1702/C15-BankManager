<script lang="ts">
  import { onMount } from 'svelte';
  import { C15_SCALE } from '../lib/canvas/geometry';
  import { clientToC15, type ViewportTransform } from '../lib/canvas/hitTest';
  import { snapToGrid } from '../lib/model/bankFactory';
  import {
    loadWidthCalibRulers,
    saveWidthCalibRulers,
    type WidthCalibRuler,
    type WidthCalibRulerId,
  } from '../lib/layout/widthCalibRulers';

  interface Props {
    viewport: ViewportTransform;
    canvasEl: HTMLElement | null;
  }

  let { viewport, canvasEl }: Props = $props();

  let rulers = $state<WidthCalibRuler[]>(loadWidthCalibRulers());
  let draggingId = $state<WidthCalibRulerId | null>(null);
  let grabOffset = { x: 0, y: 0 };

  const scale = C15_SCALE;

  onMount(() => {
    rulers = loadWidthCalibRulers();
  });

  function persist(): void {
    saveWidthCalibRulers(rulers);
  }

  function rulerStyle(r: WidthCalibRuler): string {
    return [
      `left:${r.x * scale}px`,
      `top:${r.y * scale}px`,
      `width:${r.width * scale}px`,
      `height:${r.height * scale}px`,
    ].join(';');
  }

  function accentClass(id: WidthCalibRulerId): string {
    return id === 'span-240'
      ? 'border-amber-400/80 bg-amber-500/12 text-amber-300'
      : 'border-sky-400/80 bg-sky-500/12 text-sky-300';
  }

  function onDragStart(ruler: WidthCalibRuler, event: PointerEvent): void {
    if (event.button !== 0 || !canvasEl) return;
    event.stopPropagation();
    event.preventDefault();

    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(event.clientX, event.clientY, rect, viewport);
    draggingId = ruler.id;
    grabOffset = { x: c15.x - ruler.x, y: c15.y - ruler.y };

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
  }

  function onDragMove(ruler: WidthCalibRuler, event: PointerEvent): void {
    if (draggingId !== ruler.id || !canvasEl) return;
    event.stopPropagation();

    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(event.clientX, event.clientY, rect, viewport);
    const nextX = snapToGrid(c15.x - grabOffset.x);
    const nextY = snapToGrid(c15.y - grabOffset.y);

    rulers = rulers.map((r) =>
      r.id === ruler.id ? { ...r, x: nextX, y: nextY } : r,
    );
  }

  function onDragEnd(event: PointerEvent): void {
    if (!draggingId) return;
    event.stopPropagation();
    draggingId = null;
    persist();
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
  }
</script>

<div class="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
  {#each rulers as ruler (ruler.id)}
    <div
      role="slider"
      tabindex="0"
      aria-label="{ruler.label} width ruler"
      aria-valuemin={0}
      aria-valuenow={ruler.width}
      aria-valuetext="{ruler.width} C15 units"
      class="pointer-events-auto absolute rounded-sm border-2 {accentClass(ruler.id)}
        {draggingId === ruler.id ? 'z-20 cursor-grabbing shadow-lg' : 'z-10 cursor-grab'}"
      style={rulerStyle(ruler)}
      onpointerdown={(e) => onDragStart(ruler, e)}
      onpointermove={(e) => onDragMove(ruler, e)}
      onpointerup={onDragEnd}
      onpointercancel={onDragEnd}
    >
      <div
        class="absolute inset-x-0 top-0 border-b border-current/30 bg-black/25 px-1 py-0.5 text-center font-mono text-[9px] font-semibold tracking-wide"
        style:font-size="{9 * scale}px"
      >
        {ruler.label} C15 units
      </div>
      <span
        class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono font-bold opacity-40"
        style:font-size="{14 * scale}px"
      >
        {ruler.width}
      </span>
    </div>
  {/each}
</div>