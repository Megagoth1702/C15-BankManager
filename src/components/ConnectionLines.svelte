<script lang="ts">
  import {
    buildConnectionLinesFromEdges,
    collectAttachmentEdges,
    getSolidParentChainEdgeIdsForSelection,
    type AttachmentEdge,
  } from '../lib/canvas/connectionLines';
  import { resolveDisplayPositions } from '../lib/canvas/displayPosition';
  import type { DisplayPositionMap } from '../lib/canvas/displayPosition';
  import type { Bank } from '../lib/types/bank';

  interface Props {
    banks: Bank[];
    selectedBankUuids?: readonly string[];
    /** Shared display map from Canvas (includes live drag overrides). */
    displayByUuid?: DisplayPositionMap;
    /** When set, only draw lines touching a visible bank. */
    visibleBankUuids?: ReadonlySet<string>;
  }

  let {
    banks,
    selectedBankUuids = [],
    displayByUuid: displayByUuidProp,
    visibleBankUuids,
  }: Props = $props();

  const displayByUuid = $derived(
    displayByUuidProp ?? resolveDisplayPositions(banks),
  );

  /**
   * Topology from bank list only. Geometry (below) re-runs when displayByUuid
   * moves during drag; edges are not rebuilt from ancestry walks.
   */
  const attachmentEdges = $derived(collectAttachmentEdges(banks));

  const lines = $derived.by(() => {
    const built = buildConnectionLinesFromEdges(
      attachmentEdges,
      banks,
      displayByUuid,
    );
    if (!visibleBankUuids || visibleBankUuids.size === 0) return built;
    return built.filter(
      (line) =>
        visibleBankUuids.has(line.parentUuid) ||
        visibleBankUuids.has(line.childUuid),
    );
  });
  const solidParentEdgeIds = $derived(
    getSolidParentChainEdgeIdsForSelection(selectedBankUuids, banks),
  );
</script>

<svg
  class="pointer-events-none absolute left-0 top-0 overflow-visible"
  aria-hidden="true"
  width="1"
  height="1"
>
  {#each lines as line (line.id)}
    {@const solidToParent = solidParentEdgeIds.has(line.id)}
    <line
      x1={line.x1}
      y1={line.y1}
      x2={line.x2}
      y2={line.y2}
      stroke="var(--color-c15-connect)"
      stroke-opacity="1"
      stroke-width={solidToParent ? '3' : '1.25'}
      stroke-linecap="round"
      stroke-dasharray={solidToParent ? undefined : '7 5'}
    />
  {/each}
</svg>
