<script lang="ts">
  import { portalBody } from '../lib/ui/portalBody';

  interface Props {
    bankName: string;
    comment: string;
    x: number;
    y: number;
  }

  let { bankName, comment, x, y }: Props = $props();

  const hasComment = $derived(comment.trim().length > 0);
</script>

<div
  use:portalBody
  class="pointer-events-none fixed z-[9999] max-w-[280px] overflow-hidden rounded-md border border-c15-border bg-c15-surface-raised shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
  style:left="{x + 12}px"
  style:top="{y + 12}px"
  role="tooltip"
>
  <div
    class="border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-c15-accent"
  >
    Bank
  </div>
  <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
    {bankName || '—'}
  </div>
  {#if hasComment}
    <div
      class="border-t border-c15-border/80 border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-yellow-400/90"
    >
      Comment
    </div>
    <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text whitespace-pre-wrap break-words">
      {comment.trim()}
    </div>
  {/if}
</div>
