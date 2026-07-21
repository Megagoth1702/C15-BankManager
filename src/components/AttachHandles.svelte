<script lang="ts">
  import { C15_SCALE } from '../lib/canvas/geometry';
  import type { AttachDirection } from '../lib/types/bank';

  interface Props {
    disabled?: boolean;
    onstart?: (direction: AttachDirection, event: PointerEvent) => void;
  }

  let { disabled = false, onstart }: Props = $props();

  const handlePx = Math.max(8, C15_SCALE * 8);

  const handles: { direction: AttachDirection; class: string; title: string }[] = [
    { direction: 'left', class: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', title: 'Attach left side to another bank' },
    { direction: 'right', class: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', title: 'Attach right side to another bank' },
    { direction: 'top', class: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2', title: 'Attach top side to another bank' },
    { direction: 'bottom', class: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', title: 'Attach bottom side to another bank' },
  ];

  function onHandleDown(direction: AttachDirection, event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    onstart?.(direction, event);
  }
</script>

{#each handles as handle (handle.direction)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="button"
    tabindex="-1"
    data-attach-handle="true"
    class="absolute z-30 cursor-crosshair rounded-full border-2 border-c15-accent bg-c15-bg shadow-md transition-transform hover:scale-125
      {disabled ? 'pointer-events-none opacity-40' : ''}
      {handle.class}"
    style:width="{handlePx}px"
    style:height="{handlePx}px"
    title={handle.title}
    onpointerdown={(e) => onHandleDown(handle.direction, e)}
  ></div>
{/each}