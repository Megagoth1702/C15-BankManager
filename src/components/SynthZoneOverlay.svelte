<script lang="ts">
  import { C15_SCALE } from '../lib/canvas/geometry';
  import { getSynthNoGoRect } from '../lib/layout/noGoZones';
  import type { SynthBorderEdge } from '../lib/canvas/borderSnapHitTest';

  interface Props {
    activeEdge?: SynthBorderEdge | null;
  }

  let { activeEdge = null }: Props = $props();

  const noGo = getSynthNoGoRect();
  const scale = C15_SCALE;

  const zoneStyle = $derived({
    left: `${noGo.x * scale}px`,
    top: `${noGo.y * scale}px`,
    width: `${noGo.width * scale}px`,
    height: `${noGo.height * scale}px`,
  });

  const edgeHighlightStyle = $derived.by(() => {
    if (!activeEdge) return null;
    const t = Math.max(2, 3 * scale);
    switch (activeEdge) {
      case 'west':
        return `left:0;top:0;bottom:0;width:${t}px`;
      case 'east':
        return `right:0;top:0;bottom:0;width:${t}px`;
      case 'north':
        return `left:0;top:0;right:0;height:${t}px`;
      case 'south':
        return `left:0;bottom:0;right:0;height:${t}px`;
    }
  });
</script>

<div class="pointer-events-none absolute inset-0" aria-hidden="true">
  <div
    class="absolute rounded-sm border-2 border-dashed border-red-400/50 bg-red-500/8"
    style:left={zoneStyle.left}
    style:top={zoneStyle.top}
    style:width={zoneStyle.width}
    style:height={zoneStyle.height}
  >
    {#if edgeHighlightStyle}
      <div
        class="absolute z-10 bg-cyan-400/90 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
        style={edgeHighlightStyle}
      ></div>
    {/if}
    <span
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium tracking-wide text-red-400/60"
    >
      Synth parameters
    </span>
  </div>
</div>