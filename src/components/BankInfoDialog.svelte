<script lang="ts">
  import {
    banks,
    renameBank,
    setBankComment,
  } from '../lib/model/bankStore';
  import {
    BANK_ATTR,
    calcBankStateString,
    getBankAttribute,
    getBankComment,
  } from '../lib/model/bankAttributes';
  import { portalBody } from '../lib/ui/portalBody';

  interface Props {
    bankUuid: string;
    onclose?: () => void;
  }

  let { bankUuid, onclose }: Props = $props();

  const bank = $derived($banks.find((b) => b.uuid === bankUuid) ?? null);

  let nameDraft = $state('');
  let commentDraft = $state('');
  let commentDirty = $state(false);

  $effect(() => {
    if (!bank) return;
    nameDraft = bank.name;
    if (!commentDirty) {
      commentDraft = getBankComment(bank);
    }
  });

  function formatTimestamp(ts: number): string {
    if (!ts) return '—';
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  /** Prefer locale display for ISO bank meta dates; fall back to raw value. */
  function formatMetaDate(raw: string): string {
    if (!raw) return '—';
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return raw;
    try {
      return new Date(parsed).toLocaleString();
    } catch {
      return raw;
    }
  }

  function displayAttr(bankValue: string): string {
    return bankValue || '—';
  }

  function saveComment(): void {
    if (!bank) return;
    setBankComment(bank.uuid, commentDraft);
    commentDirty = false;
  }

  function commitName(): void {
    if (!bank) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === bank.name) {
      nameDraft = bank.name;
      return;
    }
    renameBank(bank.uuid, trimmed);
  }

  function handleBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      saveComment();
      onclose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      event.preventDefault();
      saveComment();
      onclose?.();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portalBody
  class="app-ui fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
  data-bank-info-dialog="true"
  onclick={handleBackdrop}
  onkeydown={handleKeydown}
  role="presentation"
>
  {#if bank}
    <div
      class="w-full max-w-md rounded-lg border border-c15-border bg-c15-surface shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bank-info-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-c15-border px-4 py-3">
        <h2 id="bank-info-title" class="text-sm font-semibold text-c15-text">Bank Info</h2>
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs text-c15-text-muted hover:bg-c15-surface-raised hover:text-c15-text"
          onclick={() => {
            saveComment();
            onclose?.();
          }}
        >
          Close
        </button>
      </div>

      <div class="space-y-3 px-4 py-3 text-xs">
        <label class="block">
          <span class="mb-1 block text-[10px] font-medium uppercase tracking-wide text-c15-text-muted">
            Name
          </span>
          <input
            type="text"
            class="w-full rounded border border-c15-border bg-c15-bg px-2 py-1.5 text-sm text-c15-text outline-none focus:border-c15-accent"
            bind:value={nameDraft}
            onblur={commitName}
            onkeydown={(e) => {
              if (e.code === 'Enter') {
                e.preventDefault();
                commitName();
              }
            }}
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-[10px] font-medium uppercase tracking-wide text-c15-text-muted">
            Comment
          </span>
          <textarea
            class="min-h-[88px] w-full resize-y rounded border border-c15-border bg-c15-bg px-2 py-1.5 text-sm text-c15-text outline-none focus:border-c15-accent"
            bind:value={commentDraft}
            oninput={() => (commentDirty = true)}
            onblur={saveComment}
          ></textarea>
        </label>

        <div class="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1.5 text-c15-text-muted">
          <span>Size</span>
          <span class="text-c15-text">{bank.presetOrder.length} presets</span>

          <span>Position</span>
          <span class="text-c15-text tabular-nums">
            ({Math.round(bank.x)}, {Math.round(bank.y)})
          </span>

          <span>State</span>
          <span class="text-c15-text">{calcBankStateString(bank)}</span>

          <span>Last change</span>
          <span class="text-c15-text">{formatTimestamp(bank.lastChangedTimestamp)}</span>

          <span>Import file</span>
          <span
            class="min-w-0 truncate text-c15-text"
            title={getBankAttribute(bank, BANK_ATTR.nameOfImportFile) || undefined}
          >
            {displayAttr(getBankAttribute(bank, BANK_ATTR.nameOfImportFile))}
          </span>

          <span>Import date</span>
          <span
            class="text-c15-text"
            title={getBankAttribute(bank, BANK_ATTR.dateOfImportFile) || undefined}
          >
            {formatMetaDate(getBankAttribute(bank, BANK_ATTR.dateOfImportFile))}
          </span>

          <span>Export file</span>
          <span
            class="min-w-0 truncate text-c15-text"
            title={getBankAttribute(bank, BANK_ATTR.nameOfExportFile) || undefined}
          >
            {displayAttr(getBankAttribute(bank, BANK_ATTR.nameOfExportFile))}
          </span>

          <span>Export date</span>
          <span
            class="text-c15-text"
            title={getBankAttribute(bank, BANK_ATTR.dateOfExportFile) || undefined}
          >
            {formatMetaDate(getBankAttribute(bank, BANK_ATTR.dateOfExportFile))}
          </span>
        </div>
      </div>
    </div>
  {:else}
    <div class="rounded border border-c15-border bg-c15-surface px-4 py-3 text-sm text-c15-text">
      Bank not found.
      <button type="button" class="ml-2 text-c15-accent" onclick={() => onclose?.()}>Close</button>
    </div>
  {/if}
</div>
