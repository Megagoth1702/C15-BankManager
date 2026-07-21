<script lang="ts">
  import { portalBody } from '../lib/ui/portalBody';
  import { uiScale } from '../lib/ui/uiScale';

  interface Props {
    clientX: number;
    clientY: number;
    oncreatebank?: () => void;
    onclose?: () => void;
  }

  let { clientX, clientY, oncreatebank, onclose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  /** Cursor-anchored popups must not use `.app-ui { zoom }` — it offsets fixed coords. */
  function placeMenuAtCursor(): void {
    if (!menuEl) return;

    const scale = $uiScale;
    const pad = 8;
    let left = clientX;
    let top = clientY;

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.transform = `scale(${scale})`;
    menuEl.style.transformOrigin = 'top left';

    const rect = menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth - pad) {
      left -= rect.right - (window.innerWidth - pad);
    }
    if (rect.bottom > window.innerHeight - pad) {
      top -= rect.bottom - (window.innerHeight - pad);
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  $effect(() => {
    clientX;
    clientY;
    $uiScale;
    placeMenuAtCursor();
  });

  function handleCreateBank(): void {
    oncreatebank?.();
    onclose?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={menuEl}
  use:portalBody
  data-canvas-context-menu="true"
  class="fixed z-[110] min-w-[160px] rounded border border-c15-border bg-c15-surface-raised py-1 shadow-lg"
  onclick={(e) => e.stopPropagation()}
>
  <button
    type="button"
    class="w-full px-3 py-1.5 text-left text-xs text-c15-text transition-colors hover:bg-c15-surface hover:text-c15-accent"
    onclick={handleCreateBank}
  >
    Create new bank
  </button>
</div>
