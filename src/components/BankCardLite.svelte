<script lang="ts">
  import {
    BANK_LAYOUT,
    C15_SCALE,
    bankInnerBodyHeight,
    bankOuterHeight,
    bankOuterWidth,
    effectiveFacingWidth,
  } from '../lib/canvas/geometry';
  import {
    dockEdgeHighlightBarStyle,
  } from '../lib/canvas/bankCardChrome';
  import { portalBody } from '../lib/ui/portalBody';
  import {
    selTrace,
    selTracePointer,
  } from '../lib/debug/selectionTrace';
  import type { DockEdge } from '../lib/model/attachOperation';
  import type { Bank } from '../lib/types/bank';

  interface Props {
    bank: Bank;
    displayX: number;
    displayY: number;
    index: number;
    selected?: boolean;
    userPositioned?: boolean;
    dragDisabled?: boolean;
    attachDropTarget?: boolean;
    dockEdgeHighlight?: DockEdge | null;
    dragging?: boolean;
    /** Drop multi-layer selection glow while a bank drag is active. */
    reduceSelectionGlow?: boolean;
    suppressNameTooltip?: boolean;
    /**
     * Bank drag/select gesture start — Canvas tracks move/up on window.
     * No setPointerCapture here — Canvas captures on the stable root.
     */
    onbankpointerdown?: (info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      pointerId: number;
    }) => void;
    /** Bank header right-click (export menu); Canvas owns selection resolve. */
    onbankcontextmenu?: (bankUuid: string, event: MouseEvent) => void;
  }

  let {
    bank,
    displayX,
    displayY,
    index,
    selected = false,
    userPositioned = false,
    dragDisabled = false,
    suppressNameTooltip = false,
    attachDropTarget = false,
    dockEdgeHighlight = null,
    dragging = false,
    reduceSelectionGlow = false,
    onbankpointerdown,
    onbankcontextmenu,
  }: Props = $props();

  const scale = C15_SCALE;
  const placementW = $derived(effectiveFacingWidth(bank) * scale);
  const outerW = $derived(bankOuterWidth() * scale);
  const outerH = $derived(bankOuterHeight(bank) * scale);
  const tapePx = BANK_LAYOUT.tapeSize * scale;
  const innerH = $derived(bankInnerBodyHeight(bank) * scale);
  const chromeLeftPx = 0;
  const chromeTopPx = tapePx;
  const chromeW = $derived(placementW);
  const headerPx = BANK_LAYOUT.headerHeight * scale;
  const borderPx = Math.max(1, BANK_LAYOUT.bodyBorderWidth * scale);
  const radiusPx = BANK_LAYOUT.bodyCornerRadiusTop * scale;
  const dockHighlightPx = Math.max(6, 10 * scale);
  const bodyH = $derived(Math.max(0, innerH - headerPx));

  let nameTooltip = $state<{ x: number; y: number } | null>(null);

  const headerBg = $derived(
    attachDropTarget
      ? '#67e8f9'
      : selected
        ? 'var(--color-c15-bank-header-selected)'
        : 'var(--color-c15-bank-header)',
  );

  const bodyBorderColor = $derived(
    attachDropTarget
      ? '#22d3ee'
      : selected
        ? 'var(--color-c15-bank-selected-glow)'
        : 'var(--color-c15-bank-header)',
  );

  const bodyShadow = $derived(
    selected && !reduceSelectionGlow
      ? `0 0 0 ${Math.max(1, 2 * scale)}px var(--color-c15-bank-selected-glow), 0 0 ${12 * scale}px ${6 * scale}px rgba(173, 181, 217, 0.45)`
      : 'none',
  );

  const bankLabel = $derived(`${index + 1} - ${bank.name}`);

  function showNameTooltip(event: PointerEvent): void {
    if (suppressNameTooltip || dragging) return;
    nameTooltip = { x: event.clientX, y: event.clientY };
  }

  function moveNameTooltip(event: PointerEvent): void {
    if (suppressNameTooltip || !nameTooltip || dragging) return;
    nameTooltip = { x: event.clientX, y: event.clientY };
  }

  function hideNameTooltip(): void {
    nameTooltip = null;
  }

  function onDragSurfacePointerDown(event: PointerEvent): void {
    if (dragDisabled || event.button !== 0) {
      selTrace('bankcard-lite.down-ignored', {
        bankUuid: bank.uuid.slice(0, 8),
        bankName: bank.name,
        reason: dragDisabled ? 'dragDisabled' : `button=${event.button}`,
        selectedProp: selected,
      });
      return;
    }
    // stopPropagation: do not start canvas pan/marquee.
    // preventDefault: reduce UA pan/scroll/drag that fires pointercancel on grab re-render.
    event.stopPropagation();
    event.preventDefault();
    hideNameTooltip();
    selTracePointer('bankcard-lite.bank-pointerdown', event, {
      bankUuid: bank.uuid.slice(0, 8),
      bankName: bank.name,
      selectedProp: selected,
    });
    onbankpointerdown?.({
      clientX: event.clientX,
      clientY: event.clientY,
      originX: displayX,
      originY: displayY,
      pointerId: event.pointerId,
    });
  }

  function onHeaderContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onbankcontextmenu?.(bank.uuid, event);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pointer-events-none absolute select-none
    {dragging ? 'cursor-grabbing z-30' : selected ? 'z-20' : ''}"
  style:left="{displayX * scale}px"
  style:top="{displayY * scale}px"
  style:width="{outerW}px"
  style:height="{outerH}px"
>
  {#if dockEdgeHighlight}
    <div
      class="pointer-events-none absolute z-20 bg-cyan-400/80"
      style={dockEdgeHighlightBarStyle(dockEdgeHighlight, {
        placementW,
        chromeTopPx,
        innerH,
        dockHighlightPx,
      })}
    ></div>
  {/if}

  {#if userPositioned}
    <div
      class="pointer-events-none absolute z-10 rounded-full bg-sky-400"
      style:left="{chromeLeftPx - 4}px"
      style:top="{chromeTopPx - 4}px"
      style:width="{8 * scale}px"
      style:height="{8 * scale}px"
      title="Manually positioned — won't follow parent moves"
    ></div>
  {/if}

  <div
    class="pointer-events-auto absolute overflow-hidden bg-c15-preset-row touch-none
      {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
    style:left="{chromeLeftPx}px"
    style:top="{chromeTopPx}px"
    style:width="{chromeW}px"
    style:height="{innerH}px"
    style:border="{borderPx}px solid {bodyBorderColor}"
    style:border-radius="{radiusPx}px {radiusPx}px 0 0"
    style:box-shadow="{bodyShadow}"
    onpointerenter={showNameTooltip}
    onpointermove={moveNameTooltip}
    onpointerleave={hideNameTooltip}
    onpointerdown={onDragSurfacePointerDown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="shrink-0 border-b border-black/20"
      style:height="{headerPx}px"
      style:min-height="{headerPx}px"
      style:background-color="{headerBg}"
      data-bank-header-drop={bank.uuid}
      oncontextmenu={onHeaderContextMenu}
    ></div>
    <div
      class="bg-c15-preset-row"
      style:height="{bodyH}px"
      style:min-height="{bodyH}px"
    ></div>
  </div>

  {#if nameTooltip}
    <div
      use:portalBody
      class="pointer-events-none fixed z-[9999] max-w-[280px] overflow-hidden rounded-md border border-c15-border bg-c15-surface-raised shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
      style:left="{nameTooltip.x}px"
      style:top="{nameTooltip.y}px"
      role="tooltip"
    >
      <div
        class="border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-c15-text-muted"
      >
        Bank:
      </div>
      <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
        {bankLabel}
      </div>
    </div>
  {/if}
</div>
