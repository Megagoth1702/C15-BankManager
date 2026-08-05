<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    appDialog,
    dismissAppDialog,
    setAppDialogHostMounted,
    type AppDialogRequest,
  } from '../lib/ui/appDialog';

  let dialogEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let promptValue = $state('');

  const request = $derived($appDialog as AppDialogRequest | null);

  onMount(() => {
    setAppDialogHostMounted(true);
    return () => setAppDialogHostMounted(false);
  });

  onDestroy(() => {
    setAppDialogHostMounted(false);
  });

  $effect(() => {
    const req = request;
    if (!req) return;
    if (req.kind === 'prompt') {
      promptValue = req.defaultValue;
    }
    void tick().then(() => {
      if (req.kind === 'prompt') {
        inputEl?.focus();
        inputEl?.select();
      } else {
        dialogEl?.focus();
      }
    });
  });

  function onConfirm(): void {
    const req = request;
    if (!req) return;
    if (req.kind === 'confirm') {
      req.resolve(true);
    } else if (req.kind === 'prompt') {
      req.resolve(promptValue);
    } else {
      req.resolve();
    }
  }

  function onCancel(): void {
    dismissAppDialog();
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onCancel();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && request?.kind !== 'prompt') {
      // Prompt uses Enter from the input; confirm/alert accept Enter on dialog.
      if (event.target === dialogEl || event.target === event.currentTarget) {
        event.preventDefault();
        onConfirm();
      }
    }
  }

  function onPromptKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      onConfirm();
    }
  }
</script>

{#if request}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="app-ui fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3 sm:p-4"
    role="presentation"
    onclick={onBackdropClick}
    onkeydown={onKeyDown}
  >
    <!--
      Viewport-capped shell: title + actions stay visible; long messages scroll.
      max-height uses dvh so mobile browser chrome does not clip the footer.
    -->
    <div
      bind:this={dialogEl}
      class="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-c15-border bg-c15-surface shadow-xl max-h-[min(90dvh,calc(100vh-1.5rem))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="shrink-0 border-b border-c15-border/60 px-4 pt-4 pb-2">
        <h2 id="app-dialog-title" class="text-sm font-semibold text-c15-text">
          {request.title}
        </h2>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {#if request.message}
          <p class="whitespace-pre-wrap text-xs leading-relaxed text-c15-text-muted">
            {request.message}
          </p>
        {/if}

        {#if request.kind === 'prompt'}
          <label class="mt-3 block">
            <span class="sr-only">Value</span>
            <input
              bind:this={inputEl}
              bind:value={promptValue}
              type="text"
              class="w-full rounded border border-c15-border bg-c15-surface-raised px-3 py-2 text-sm text-c15-text outline-none focus:border-c15-accent"
              onkeydown={onPromptKeyDown}
            />
          </label>
        {/if}
      </div>

      <div
        class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-c15-border/60 bg-c15-surface px-4 py-3"
      >
        {#if request.kind !== 'alert'}
          <button
            type="button"
            class="rounded border border-c15-border px-3 py-1.5 text-xs text-c15-text-muted hover:text-c15-text"
            onclick={onCancel}
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
        {/if}
        <button
          type="button"
          class={request.danger
            ? 'rounded border border-amber-700/80 bg-amber-950/50 px-3 py-1.5 text-xs text-amber-100 hover:border-amber-500'
            : 'rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text hover:border-c15-accent'}
          onclick={onConfirm}
        >
          {request.confirmLabel ?? (request.kind === 'prompt' ? 'Save' : 'OK')}
        </button>
      </div>
    </div>
  </div>
{/if}
