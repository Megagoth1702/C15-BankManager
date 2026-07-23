<script lang="ts">
  import { C15_SCALE } from '../lib/canvas/geometry';
  import { getSynthNoGoRect } from '../lib/layout/noGoZones';

  const noGo = getSynthNoGoRect();
  const scale = C15_SCALE;

  // Static geometry (markers + layout constants) — no reactive inputs.
  const zoneStyle = {
    left: `${noGo.x * scale}px`,
    top: `${noGo.y * scale}px`,
    width: `${noGo.width * scale}px`,
    height: `${noGo.height * scale}px`,
  } as const;
</script>

<div class="pointer-events-none absolute inset-0" aria-hidden="true">
  <div
    class="absolute rounded-sm border-2 border-dashed border-red-400/50 bg-red-500/8"
    style:left={zoneStyle.left}
    style:top={zoneStyle.top}
    style:width={zoneStyle.width}
    style:height={zoneStyle.height}
  >
    <span
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium tracking-wide text-red-400/60"
    >
      Synth parameters
    </span>
  </div>
</div>
