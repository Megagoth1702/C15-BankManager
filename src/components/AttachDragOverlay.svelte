<script lang="ts">
  import { C15_SCALE } from '../lib/canvas/geometry';
  import type { AttachDirection } from '../lib/types/bank';

  interface Props {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    direction: AttachDirection;
    hoverValid: boolean;
  }

  let { fromX, fromY, toX, toY, direction, hoverValid }: Props = $props();

  const scale = C15_SCALE;
</script>

<svg
  class="pointer-events-none absolute left-0 top-0 z-[2] overflow-visible"
  style:width="1px"
  style:height="1px"
>
  <line
    x1={fromX * scale}
    y1={fromY * scale}
    x2={toX * scale}
    y2={toY * scale}
    stroke={hoverValid ? 'rgba(0, 200, 255, 0.9)' : 'rgba(255, 180, 0, 0.85)'}
    stroke-width="2"
    stroke-dasharray="6 4"
  />
  <circle
    cx={toX * scale}
    cy={toY * scale}
    r="5"
    fill={hoverValid ? 'rgba(0, 200, 255, 0.5)' : 'rgba(255, 180, 0, 0.5)'}
  />
  <text
    x={(fromX * scale + toX * scale) / 2}
    y={(fromY * scale + toY * scale) / 2 - 6}
    text-anchor="middle"
    class="fill-c15-text text-[9px]"
    style:font-size="{9 * scale}px"
  >
    {direction}
  </text>
</svg>