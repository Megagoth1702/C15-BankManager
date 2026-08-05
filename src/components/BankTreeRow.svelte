<script lang="ts">
  import type { Bank } from '../lib/types/bank';
  import { bankMeta, selectBankRange } from '../lib/model/bankStore';
  import { focusRenameInput } from '../lib/ui/focusRenameInput';

  interface Props {
    bank: Bank;
    /** 0-based document order (display as #n). */
    index: number;
    orderedUuids: string[];
    renaming: boolean;
    renameValue: string;
    onrenameinput: (value: string) => void;
    onrenamecommit: () => void;
    onrenamecancel: () => void;
    onstartrename: (uuid: string) => void;
    /** Right-click bank row — same menu as canvas bank header. */
    onbankcontextmenu?: (bankUuid: string, event: MouseEvent) => void;
  }

  let {
    bank,
    index,
    orderedUuids,
    renaming,
    renameValue,
    onrenameinput,
    onrenamecommit,
    onrenamecancel,
    onstartrename,
    onbankcontextmenu,
  }: Props = $props();

  const selected = $derived($bankMeta.selectedBankUuids.includes(bank.uuid));
  const showRename = $derived(
    renaming && $bankMeta.renameSurface === 'sidebar',
  );

  function handleRenameKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.code === 'Enter') {
      event.preventDefault();
      onrenamecommit();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      onrenamecancel();
    }
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onbankcontextmenu?.(bank.uuid, event);
  }
</script>

<li data-sidebar-bank-uuid={bank.uuid}>
  {#if showRename}
    <div class="border-b border-c15-border/50 px-3 py-1.5">
      <input
        use:focusRenameInput
        type="text"
        class="w-full rounded border border-c15-accent/60 bg-c15-bg px-2 py-1 text-xs text-c15-text outline-none"
        value={renameValue}
        oninput={(e) => onrenameinput(e.currentTarget.value)}
        onkeydown={handleRenameKeydown}
        onblur={onrenamecommit}
      />
    </div>
  {:else}
    <button
      type="button"
      class="flex w-full items-center gap-2 border-b border-c15-border/50 px-3 py-1.5 text-left text-xs transition-colors hover:bg-c15-surface-raised
        {selected ? 'bg-c15-surface-raised ring-1 ring-inset ring-c15-accent/40' : ''}"
      onclick={(e) =>
        selectBankRange(bank.uuid, orderedUuids, {
          shift: e.shiftKey,
          ctrl: e.ctrlKey || e.metaKey,
        })}
      ondblclick={(e) => {
        e.preventDefault();
        onstartrename(bank.uuid);
      }}
      oncontextmenu={handleContextMenu}
      title="{bank.name} — double-click or F2 to rename · right-click for menu"
    >
      <span class="w-7 shrink-0 tabular-nums text-c15-text-muted">#{index + 1}</span>
      <span class="min-w-0 flex-1 truncate font-medium text-c15-text">{bank.name}</span>
      <span
        class="shrink-0 tabular-nums text-c15-text-muted"
        title="{bank.presets.length} presets"
      >{bank.presets.length}</span>
    </button>
  {/if}
</li>
