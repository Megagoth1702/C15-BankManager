<script lang="ts">
  import type { BankTreeNode } from '../lib/model/bankTree';
  import { clusterHasChildren } from '../lib/model/bankTree';
  import { clusterMatchesFilter, filterClusterMembers } from '../lib/model/bankTreeFilter';
  import BankTreeRow from './BankTreeRow.svelte';

  interface Props {
    root: BankTreeNode;
    bankIndexByUuid: Map<string, number>;
    orderedUuids: string[];
    filterQuery?: string;
    renamingUuid: string | null;
    renameValue: string;
    onrenameinput: (value: string) => void;
    onrenamecommit: () => void;
    onrenamecancel: () => void;
    onstartrename: (uuid: string) => void;
    onbankcontextmenu?: (bankUuid: string, event: MouseEvent) => void;
  }

  let {
    root,
    bankIndexByUuid,
    orderedUuids,
    filterQuery = '',
    renamingUuid,
    renameValue,
    onrenameinput,
    onrenamecommit,
    onrenamecancel,
    onstartrename,
    onbankcontextmenu,
  }: Props = $props();

  const members = $derived(filterClusterMembers(root, filterQuery));
  const showBracket = $derived(clusterHasChildren(root));
  const visible = $derived(clusterMatchesFilter(root, filterQuery));
</script>

{#if visible}
<li class="list-none">
  {#if showBracket}
    <div class="flex border-b border-c15-border/30">
      <div
        class="relative shrink-0 self-stretch"
        style:width="14px"
        aria-hidden="true"
      >
        <div
          class="absolute left-[5px] top-2 bottom-2 w-px"
          style:background-color="var(--color-c15-connect)"
        ></div>
        <div
          class="absolute left-[5px] top-2 h-px w-2"
          style:background-color="var(--color-c15-connect)"
        ></div>
        <div
          class="absolute bottom-2 left-[5px] h-px w-2"
          style:background-color="var(--color-c15-connect)"
        ></div>
      </div>
      <ul class="min-w-0 flex-1">
        {#each members as node (node.bank.uuid)}
          <BankTreeRow
            bank={node.bank}
            index={bankIndexByUuid.get(node.bank.uuid) ?? 0}
            {orderedUuids}
            renaming={renamingUuid === node.bank.uuid}
            {renameValue}
            {onrenameinput}
            {onrenamecommit}
            {onrenamecancel}
            {onstartrename}
            {onbankcontextmenu}
          />
        {/each}
      </ul>
    </div>
  {:else}
    <BankTreeRow
      bank={root.bank}
      index={bankIndexByUuid.get(root.bank.uuid) ?? 0}
      {orderedUuids}
      renaming={renamingUuid === root.bank.uuid}
      {renameValue}
      {onrenameinput}
      {onrenamecommit}
      {onrenamecancel}
      {onstartrename}
      {onbankcontextmenu}
    />
  {/if}
</li>
{/if}
