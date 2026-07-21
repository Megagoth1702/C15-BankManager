<script lang="ts">
  import {
    bankDebugRegions,
    layoutBankDebugCallouts,
    type BankDebugCallout,
    type BankDebugRegion,
  } from '../lib/canvas/bankDebugGeometry';
  import { C15_SCALE } from '../lib/canvas/geometry';
  import type { Bank } from '../lib/types/bank';

  interface Props {
    banks: Bank[];
    displayByUuid: Map<string, { x: number; y: number }>;
  }

  let { banks, displayByUuid }: Props = $props();

  const scale = C15_SCALE;
  const strokePx = Math.max(1, 1.25 * scale);
  const handleR = Math.max(2.5, 3.5 * scale);
  const fontPx = Math.max(8, 9 * scale);
  const haloPx = Math.max(2.5, 3 * scale);

  interface DrawnRegion {
    bankUuid: string;
    region: BankDebugRegion;
    callout: BankDebugCallout;
  }

  const drawn = $derived.by((): DrawnRegion[] => {
    const out: DrawnRegion[] = [];
    for (const bank of banks) {
      const origin = displayByUuid.get(bank.uuid) ?? { x: bank.x, y: bank.y };
      const regions = bankDebugRegions(bank, origin.x, origin.y);
      const callouts = layoutBankDebugCallouts(regions);
      for (const region of regions) {
        const callout = callouts.get(region.id);
        if (!callout) continue;
        out.push({ bankUuid: bank.uuid, region, callout });
      }
    }
    return out;
  });
</script>

<!-- Bank geometry debug: borders + non-overlapping named callouts (C15 world space). -->
<svg
  class="pointer-events-none absolute left-0 top-0 overflow-visible"
  width="1"
  height="1"
  aria-hidden="true"
>
  {#each drawn as item (`${item.bankUuid}:${item.region.id}`)}
    {@const r = item.region}
    {@const c = item.callout}
    {@const ax = c.anchorX * scale}
    {@const ay = c.anchorY * scale}
    {@const lx = c.labelX * scale}
    {@const ly = c.labelY * scale}

    {#if r.kind === 'rect'}
      <rect
        x={r.x * scale}
        y={r.y * scale}
        width={r.width * scale}
        height={r.height * scale}
        fill={r.color}
        fill-opacity="0.05"
        stroke={r.color}
        stroke-width={strokePx}
        stroke-opacity="0.85"
      />
    {:else}
      <circle
        cx={r.x * scale}
        cy={r.y * scale}
        r={handleR}
        fill={r.color}
        fill-opacity="0.95"
        stroke="#0a0a0a"
        stroke-width={Math.max(0.5, strokePx * 0.5)}
      />
    {/if}

    <line
      x1={ax}
      y1={ay}
      x2={lx}
      y2={ly}
      stroke={r.color}
      stroke-width={strokePx}
      stroke-opacity="0.75"
    />

    <!-- Halo for readability on busy canvas -->
    <text
      x={lx}
      y={ly}
      fill="none"
      stroke="#0a0a0a"
      stroke-width={haloPx}
      stroke-linejoin="round"
      font-size={fontPx}
      font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      font-weight="600"
      text-anchor={c.textAnchor}
      dominant-baseline={c.dominantBaseline}
    >
      {r.name}
    </text>
    <text
      x={lx}
      y={ly}
      fill={r.color}
      font-size={fontPx}
      font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      font-weight="600"
      text-anchor={c.textAnchor}
      dominant-baseline={c.dominantBaseline}
    >
      {r.name}
    </text>
  {/each}
</svg>
