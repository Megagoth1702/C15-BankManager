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
    bankBodyBorderWorldPx,
    bankBodyOutlineShadow,
    dockEdgeHighlightBarStyle,
  } from '../lib/canvas/bankCardChrome';
  import { viewport } from '../lib/canvas/viewport.svelte';
  import { portalBody } from '../lib/ui/portalBody';
  import {
    selTrace,
    selTracePointer,
  } from '../lib/debug/selectionTrace';
  import type { DockEdge } from '../lib/model/attachOperation';
  import { bankInfoSummary } from '../lib/model/bankAttributes';
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
    /** Show C15-style attach corridors while a bank drag is active. */
    showAttachSlots?: boolean;
    /**
     * Which corridors to paint (C15 isTapeActive). When omitted with
     * showAttachSlots, all four are shown (legacy).
     */
    activeAttachCorridors?: ReadonlySet<'L' | 'R' | 'T' | 'B'> | null;
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
    /**
     * Bank right-click (rename / info / export); Canvas owns selection resolve.
     * Lite cards fire this for the whole card shell — header is hard to hit when zoomed out.
     */
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
    showAttachSlots = false,
    activeAttachCorridors = null,
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
  /**
   * World thickness that maps to an integer screen-pixel stroke after zoom
   * (avoids one-sided vanishing under subpixel AA).
   */
  const borderPx = $derived(bankBodyBorderWorldPx(viewport.zoom));
  const radiusPx = BANK_LAYOUT.bodyCornerRadiusTop * scale;
  const dockHighlightPx = Math.max(6, 10 * scale);
  /** NonMaps `getVisibleAttachArea()` — drawn attach strip within tape. */
  const visibleAttachPx = BANK_LAYOUT.visibleAttachArea * scale;
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

  /** Selection glow only — outline is applied separately via bankBodyOutlineShadow. */
  const selectionGlowShadow = $derived(
    selected && !reduceSelectionGlow
      ? `0 0 0 ${Math.max(1, 2 * scale)}px var(--color-c15-bank-selected-glow), 0 0 ${12 * scale}px ${6 * scale}px rgba(173, 181, 217, 0.45)`
      : 'none',
  );

  /** Outline as outset box-shadow so it is not clipped by inner overflow:hidden. */
  const bodyShadow = $derived(
    bankBodyOutlineShadow(borderPx, bodyBorderColor, selectionGlowShadow),
  );

  const bankLabel = $derived(`${index + 1} - ${bank.name}`);
  const info = $derived(bankInfoSummary(bank));
  const headerFontPx = $derived(Math.max(9, 11 * scale));

  /** Locale display for last-change (unix seconds). */
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

  function displayAttr(value: string): string {
    return value || '—';
  }

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
  {#if showAttachSlots}
    <!-- C15 empty attach tapes — only faces where isTapeActive is true. -->
    {#if !activeAttachCorridors || activeAttachCorridors.has('L')}
      <div
        class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
        style:left="{-visibleAttachPx}px"
        style:top="{tapePx}px"
        style:width="{visibleAttachPx}px"
        style:height="{innerH}px"
      ></div>
    {/if}
    {#if !activeAttachCorridors || activeAttachCorridors.has('R')}
      <div
        class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
        style:left="{placementW}px"
        style:top="{tapePx}px"
        style:width="{visibleAttachPx}px"
        style:height="{innerH}px"
      ></div>
    {/if}
    {#if !activeAttachCorridors || activeAttachCorridors.has('T')}
      <div
        class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
        style:left="0"
        style:top="{tapePx - visibleAttachPx}px"
        style:width="{placementW}px"
        style:height="{visibleAttachPx}px"
      ></div>
    {/if}
    {#if !activeAttachCorridors || activeAttachCorridors.has('B')}
      <div
        class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
        style:left="0"
        style:top="{tapePx + innerH}px"
        style:width="{placementW}px"
        style:height="{visibleAttachPx}px"
      ></div>
    {/if}
  {/if}

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

  <!--
    Outer shell: no overflow (outline is box-shadow; overflow would clip sides under zoom).
    Right-click on the whole lite card opens the bank menu (header alone is tiny when zoomed out).
  -->
  <div
    class="pointer-events-auto absolute touch-none
      {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
    style:left="{chromeLeftPx}px"
    style:top="{chromeTopPx}px"
    style:width="{chromeW}px"
    style:height="{innerH}px"
    style:border-radius="{radiusPx}px {radiusPx}px 0 0"
    style:box-shadow="{bodyShadow}"
    data-bank-header-drop={bank.uuid}
    onpointerenter={showNameTooltip}
    onpointermove={moveNameTooltip}
    onpointerleave={hideNameTooltip}
    onpointerdown={onDragSurfacePointerDown}
    oncontextmenu={onHeaderContextMenu}
  >
    <div
      class="absolute inset-0 overflow-hidden bg-c15-preset-row"
      style:border-radius="{radiusPx}px {radiusPx}px 0 0"
    >
      <div
        class="flex shrink-0 items-center border-b border-black/30 px-1"
        style:height="{headerPx}px"
        style:min-height="{headerPx}px"
        style:background-color="{headerBg}"
      >
        <span
          class="min-w-0 flex-1 truncate font-semibold leading-none text-c15-bank-header-text"
          style:font-size="{headerFontPx}px"
          title={bankLabel}
        >
          {bankLabel}
        </span>
      </div>
      <div
        class="bg-c15-preset-row/95"
        style:height="{bodyH}px"
        style:min-height="{bodyH}px"
      ></div>
    </div>
  </div>

  {#if nameTooltip}
    <div
      use:portalBody
      class="pointer-events-none fixed z-[9999] max-w-[320px] overflow-hidden rounded-md border border-c15-border bg-c15-surface-raised shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
      style:left="{nameTooltip.x + 12}px"
      style:top="{nameTooltip.y + 14}px"
      role="tooltip"
    >
      <div
        class="border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-c15-text-muted"
      >
        Bank info
      </div>
      <div class="space-y-1.5 px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
        <div class="font-medium">{bankLabel}</div>
        {#if info.comment}
          <div class="whitespace-pre-wrap break-words text-c15-text/90">{info.comment}</div>
        {/if}
        <div class="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-c15-text-muted">
          <span>Size</span>
          <span class="text-c15-text">{info.presetCount} presets</span>

          <span>Position</span>
          <span class="tabular-nums text-c15-text">
            ({Math.round(bank.x)}, {Math.round(bank.y)})
          </span>

          <span>State</span>
          <span class="text-c15-text">{info.state}</span>

          <span>Last change</span>
          <span class="text-c15-text">{formatTimestamp(bank.lastChangedTimestamp)}</span>

          <span>Import file</span>
          <span class="min-w-0 break-all text-c15-text">{displayAttr(info.importFile)}</span>

          <span>Import date</span>
          <span class="text-c15-text">{formatMetaDate(info.importDate)}</span>

          <span>Export file</span>
          <span class="min-w-0 break-all text-c15-text">{displayAttr(info.exportFile)}</span>

          <span>Export date</span>
          <span class="text-c15-text">{formatMetaDate(info.exportDate)}</span>
        </div>
      </div>
    </div>
  {/if}
</div>
