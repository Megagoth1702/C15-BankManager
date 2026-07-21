<script lang="ts">
  interface Props {
    clientX: number;
    clientY: number;
    bankLabel: string;
  }

  let { clientX, clientY, bankLabel }: Props = $props();
</script>

<div
  class="pointer-events-none fixed z-[110] max-w-[280px] overflow-hidden rounded-md border border-c15-border bg-c15-surface-raised shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
  style:left="{clientX}px"
  style:top="{clientY}px"
  style:transform="translate(-50%, calc(-100% - 12px))"
  role="tooltip"
>
  <div
    class="border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-c15-text-muted"
  >
    Bank:
  </div>
  <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
    Zoom in to drop into <span class="font-medium">{bankLabel}</span>
  </div>
</div>