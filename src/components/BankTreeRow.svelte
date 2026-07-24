<script lang="ts">
  import type { BankTreeNode } from '../lib/model/bankTree';
  import { bankMeta, selectBankRange } from '../lib/model/bankStore';
  import { focusRenameInput } from '../lib/ui/focusRenameInput';

  interface Props {
    node: BankTreeNode;
    index: number;
    treeOrderUuids: string[];
    renaming: boolean;
    renameValue: string;
    onrenameinput: (value: string) => void;
    onrenamecommit: () => void;
    onrenamecancel: () => void;
    onstartrename: (uuid: string) => void;
  }

  let {
    node,
    index,
    treeOrderUuids,
    renaming,
    renameValue,
    onrenameinput,
    onrenamecommit,
    onrenamecancel,
    onstartrename,
  }: Props = $props();

  const selected = $derived($bankMeta.selectedBankUuids.includes(node.bank.uuid));
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
</script>

<li data-sidebar-bank-uuid={node.bank.uuid}>
  {#if showRename}
    <div class="border-b border-c15-border/50 px-3 py-2">
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
      class="w-full border-b border-c15-border/50 px-3 py-2 text-left text-xs transition-colors hover:bg-c15-surface-raised
        {selected ? 'bg-c15-surface-raised ring-1 ring-inset ring-c15-accent/40' : ''}"
      onclick={(e) =>
        selectBankRange(node.bank.uuid, treeOrderUuids, {
          shift: e.shiftKey,
          ctrl: e.ctrlKey || e.metaKey,
        })}
      ondblclick={(e) => {
        e.preventDefault();
        onstartrename(node.bank.uuid);
      }}
      title="Double-click or F2 to rename"
    >
      <div class="truncate font-medium text-c15-text">{node.bank.name}</div>
      <div class="mt-0.5 truncate text-c15-text-muted">
        #{index + 1} · ({Math.round(node.bank.x)}, {Math.round(node.bank.y)}) · {node.bank.presets.length}
        presets
      </div>
      {#if node.bank.attachDirection && node.bank.attachedToUuid}
        <div class="mt-0.5 text-c15-accent-dim">
          {node.bank.attachDirection} attach
        </div>
      {/if}
    </button>
  {/if}
</li>