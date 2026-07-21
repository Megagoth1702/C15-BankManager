<script lang="ts">
  import { BANK_LAYOUT, C15_SCALE } from '../lib/canvas/geometry';
  import { getSynthNoGoRect } from '../lib/layout/noGoZones';

  const noGo = getSynthNoGoRect();
  const scale = C15_SCALE;
  const arm = 45;
  const linePx = Math.max(1, 2 * scale);
  const labelPx = Math.max(8, 9 * scale);

  const centerX = noGo.x + noGo.width / 2;
  const centerY = noGo.y + noGo.height / 2;
  const visualChromeX = 0;
  const visualChromeY = BANK_LAYOUT.tapeSize;
</script>

<div class="pointer-events-none absolute inset-0" aria-hidden="true">
  <!-- C15 origin (0, 0) — outer bank coordinate anchor -->
  <div class="absolute" style:left="0" style:top="0">
    <div
      class="absolute bg-lime-400/90"
      style:left="{-arm * scale}px"
      style:top="{-linePx / 2}px"
      style:width="{arm * 2 * scale}px"
      style:height="{linePx}px"
    ></div>
    <div
      class="absolute bg-lime-400/90"
      style:left="{-linePx / 2}px"
      style:top="{-arm * scale}px"
      style:width="{linePx}px"
      style:height="{arm * 2 * scale}px"
    ></div>
    <span
      class="absolute whitespace-nowrap font-mono font-semibold text-lime-400/90"
      style:left="{4 * scale}px"
      style:top="{4 * scale}px"
      style:font-size="{labelPx}px"
    >
      stored 0,0
    </span>
  </div>

  <!-- NonMaps painted chrome origin (stored + tape on both axes) -->
  <div
    class="absolute"
    style:left="{visualChromeX * scale}px"
    style:top="{visualChromeY * scale}px"
  >
    <div
      class="absolute bg-cyan-400/90"
      style:left="{-arm * scale}px"
      style:top="{-linePx / 2}px"
      style:width="{arm * 2 * scale}px"
      style:height="{linePx}px"
    ></div>
    <div
      class="absolute bg-cyan-400/90"
      style:left="{-linePx / 2}px"
      style:top="{-arm * scale}px"
      style:width="{linePx}px"
      style:height="{arm * 2 * scale}px"
    ></div>
    <span
      class="absolute whitespace-nowrap font-mono font-semibold text-cyan-400/90"
      style:left="{4 * scale}px"
      style:top="{4 * scale}px"
      style:font-size="{labelPx}px"
    >
      chrome 0,40
    </span>
  </div>

  <!-- Synth no-go zone center -->
  <div
    class="absolute"
    style:left="{centerX * scale}px"
    style:top="{centerY * scale}px"
  >
    <div
      class="absolute bg-red-400/80"
      style:left="{-noGo.width * 0.5 * scale}px"
      style:top="{-linePx / 2}px"
      style:width="{noGo.width * scale}px"
      style:height="{linePx}px"
    ></div>
    <div
      class="absolute bg-red-400/80"
      style:left="{-linePx / 2}px"
      style:top="{-noGo.height * 0.5 * scale}px"
      style:width="{linePx}px"
      style:height="{noGo.height * scale}px"
    ></div>
    <span
      class="absolute -translate-x-1/2 whitespace-nowrap font-mono font-semibold text-red-400/80"
      style:left="0"
      style:top="{8 * scale}px"
      style:font-size="{labelPx}px"
    >
      synth center
    </span>
  </div>
</div>