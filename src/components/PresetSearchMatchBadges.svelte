<script lang="ts">
  import type { PresetSearchMatchFields } from '../lib/search/presetSearch';

  interface Props {
    matched: PresetSearchMatchFields;
    highlighted?: boolean;
  }

  let { matched, highlighted = false }: Props = $props();

  const hasMatch = $derived(matched.name || matched.comment || matched.device);

  const badgeClass = $derived(
    highlighted
      ? 'border-white/25 bg-black/20 text-c15-text'
      : 'border-c15-border/50 bg-c15-bg/80 text-c15-text-muted',
  );
</script>

{#if hasMatch}
  <span class="ml-auto flex shrink-0 items-center gap-0.5 self-center px-1.5">
    {#if matched.name}
      <span
        title="Matched in preset name"
        class="rounded border px-1 py-px text-[9px] font-semibold leading-none {badgeClass}"
      >N</span>
    {/if}
    {#if matched.comment}
      <span
        title="Matched in comment"
        class="rounded border px-1 py-px text-[9px] font-semibold leading-none {badgeClass}"
      >C</span>
    {/if}
    {#if matched.device}
      <span
        title="Matched in device name"
        class="rounded border px-1 py-px text-[9px] font-semibold leading-none {badgeClass}"
      >D</span>
    {/if}
  </span>
{/if}