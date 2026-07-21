<script lang="ts">
  interface Props {
    onresize?: (deltaX: number) => void;
    onresizestart?: () => void;
    onresizeend?: () => void;
  }

  let { onresize, onresizestart, onresizeend }: Props = $props();

  let dragging = $state(false);
  let lastX = 0;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    lastX = event.clientX;
    onresizestart?.();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    if (dx !== 0) onresize?.(dx);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    onresizeend?.();
    const target = event.currentTarget as HTMLElement;
    target.releasePointerCapture(event.pointerId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize sidebar"
  class="group relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none
    {dragging ? 'bg-c15-accent/40' : 'bg-c15-border/80 hover:bg-c15-accent/25'}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <div
    class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2
      {dragging ? 'bg-c15-accent' : 'bg-c15-border group-hover:bg-c15-accent/60'}"
  ></div>
</div>