<script lang="ts">
  import {
    BANK_LAYOUT,
    C15_SCALE,
    bankInnerBodyHeight,
    bankOuterHeight,
    bankOuterWidth,
    effectiveFacingWidth,
  } from '../lib/canvas/geometry';
  import { portalBody } from '../lib/ui/portalBody';
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
    onselect?: (uuid: string, event: MouseEvent) => void;
    /** Fired on pointer-up without drag (plain click selection). */
    onclickselect?: (uuid: string, event: MouseEvent) => void;
    ondraggrab?: (info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      userDrag: boolean;
      pointerId: number;
    }) => void;
    ondragend?: () => void;
    suppressNameTooltip?: boolean;
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
    onselect,
    onclickselect,
    ondraggrab,
    ondragend,
  }: Props = $props();

  const DRAG_THRESHOLD_PX = 3;
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

  let pointerActive = $state(false);
  let dragging = $state(false);
  let pointerDownScreen = { x: 0, y: 0 };
  let dragOriginDisplay = { x: 0, y: 0 };
  let wasAttachedAtDragStart = false;
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
    selected
      ? `0 0 0 ${Math.max(1, 2 * scale)}px var(--color-c15-bank-selected-glow), 0 0 ${12 * scale}px ${6 * scale}px rgba(173, 181, 217, 0.45)`
      : 'none',
  );

  const bankLabel = $derived(`${index + 1} - ${bank.name}`);

  function showNameTooltip(event: PointerEvent): void {
    if (suppressNameTooltip || dragging || pointerActive) return;
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
    if (dragDisabled || event.button !== 0) return;
    event.stopPropagation();
    hideNameTooltip();
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(event.pointerId);
    pointerActive = true;
    dragging = false;
    pointerDownScreen = { x: event.clientX, y: event.clientY };
    dragOriginDisplay = { x: displayX, y: displayY };
    wasAttachedAtDragStart = Boolean(bank.attachedToUuid);
    onselect?.(bank.uuid, event as unknown as MouseEvent);
  }

  function onDragSurfacePointerMove(event: PointerEvent): void {
    if (!pointerActive) return;
    event.stopPropagation();

    if (!dragging) {
      const totalDx = event.clientX - pointerDownScreen.x;
      const totalDy = event.clientY - pointerDownScreen.y;
      if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      hideNameTooltip();
      ondraggrab?.({
        clientX: event.clientX,
        clientY: event.clientY,
        originX: dragOriginDisplay.x,
        originY: dragOriginDisplay.y,
        userDrag: wasAttachedAtDragStart,
        pointerId: event.pointerId,
      });
    }
  }

  function onDragSurfacePointerUp(event: PointerEvent): void {
    if (!pointerActive) return;
    event.stopPropagation();
    const wasDragging = dragging;
    pointerActive = false;
    dragging = false;
    if (wasDragging) {
      ondragend?.();
    } else {
      onclickselect?.(bank.uuid, event as unknown as MouseEvent);
    }
    const target = event.currentTarget as HTMLElement | null;
    target?.releasePointerCapture(event.pointerId);
  }

  const dragPointerHandlers = {
    onpointerenter: showNameTooltip,
    onpointermove: (e: PointerEvent) => {
      if (pointerActive) onDragSurfacePointerMove(e);
      else moveNameTooltip(e);
    },
    onpointerleave: hideNameTooltip,
    onpointerdown: onDragSurfacePointerDown,
    onpointerup: onDragSurfacePointerUp,
    onpointercancel: onDragSurfacePointerUp,
  };
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
    {@const dockStyle =
      dockEdgeHighlight === 'west'
        ? `left:0;top:${chromeTopPx}px;width:${dockHighlightPx}px;height:${innerH}px`
        : dockEdgeHighlight === 'east'
          ? `left:${placementW - dockHighlightPx}px;top:${chromeTopPx}px;width:${dockHighlightPx}px;height:${innerH}px`
          : dockEdgeHighlight === 'north'
            ? `left:0;top:0;width:${placementW}px;height:${dockHighlightPx}px`
            : `left:0;top:${chromeTopPx + innerH}px;width:${placementW}px;height:${dockHighlightPx}px`}
    <div
      class="pointer-events-none absolute z-20 bg-cyan-400/80"
      style={dockStyle}
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
    class="pointer-events-auto absolute overflow-hidden bg-c15-preset-row
      {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
    style:left="{chromeLeftPx}px"
    style:top="{chromeTopPx}px"
    style:width="{chromeW}px"
    style:height="{innerH}px"
    style:border="{borderPx}px solid {bodyBorderColor}"
    style:border-radius="{radiusPx}px {radiusPx}px 0 0"
    style:box-shadow="{bodyShadow}"
    {...dragPointerHandlers}
  >
    <div
      class="shrink-0 border-b border-black/20"
      style:height="{headerPx}px"
      style:min-height="{headerPx}px"
      style:background-color="{headerBg}"
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