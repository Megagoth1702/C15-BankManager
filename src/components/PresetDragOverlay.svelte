<script lang="ts">
  interface Props {
    clientX: number;
    clientY: number;
    label: string;
    count: number;
    moveMode: boolean;
  }

  let { clientX, clientY, label, count, moveMode }: Props = $props();
</script>

<div
  class="pointer-events-none fixed z-[100] max-w-[220px] rounded border border-c15-accent/80 bg-c15-surface-raised px-2 py-1 shadow-lg"
  style:left="{clientX}px"
  style:top="{clientY}px"
>
  <div class="truncate text-xs font-medium text-c15-text">
    {label}{count > 1 ? ` (+${count - 1})` : ''}
  </div>
  <div class="text-xs text-c15-text-muted">
    {moveMode ? 'Ctrl: move (remove from source)' : 'Copy to insert at line · hold Ctrl to move'}
  </div>
</div>