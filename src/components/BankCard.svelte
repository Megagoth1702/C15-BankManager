<script lang="ts">
  import {
    BANK_LAYOUT,
    C15_SCALE,
    bankInnerBodyHeight,
    bankOuterHeight,
    bankOuterWidth,
    effectiveFacingWidth,
  } from '../lib/canvas/geometry';
  import { insertLineInnerY } from '../lib/canvas/presetDragHitTest';
  import { presetColorFromRawXml } from '../lib/canvas/presetColors';

  import {
    bankMeta,
    cancelRenameBank,
    cancelRenamePreset,
    renameBank,
    renamePreset,
  } from '../lib/model/bankStore';
  import { focusRenameInput } from '../lib/ui/focusRenameInput';
  import { portalBody } from '../lib/ui/portalBody';
  import type { DockEdge } from '../lib/model/attachOperation';
  import type { Bank } from '../lib/types/bank';

  interface Props {
    bank: Bank;
    /** On-screen origin (parent-aware layoutSlaves); stored `bank.x` / `bank.y` may differ. */
    displayX: number;
    displayY: number;
    index: number;
    selected?: boolean;
    userPositioned?: boolean;
    viewportZoom?: number;
    dragDisabled?: boolean;
    attachDropTarget?: boolean;
    dockEdgeHighlight?: DockEdge | null;
    /** Show C15-style attach corridors on all banks while any bank is dragging. */
    showAttachSlots?: boolean;
    presetDropHighlight?: boolean;
    presetInsertIndex?: number | null;
    onpresetpointerdown?: (
      bankUuid: string,
      presetUuids: string[],
      clickedUuid: string,
      event: PointerEvent,
    ) => void;
    onpresetcontextmenu?: (
      bankUuid: string,
      presetUuid: string,
      event: MouseEvent,
    ) => void;
    onselect?: (uuid: string, event: MouseEvent) => void;
    /** Fired on pointer-up without drag (plain click selection). */
    onclickselect?: (uuid: string, event: MouseEvent) => void;
    onmove?: (uuid: string, x: number, y: number, userDrag: boolean) => void;
    /** First drag frame — parent records cursor grab offset in C15 space. */
    ondraggrab?: (info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      userDrag: boolean;
      pointerId: number;
    }) => void;
    ondragend?: () => void;
  }

  let {
    bank,
    displayX,
    displayY,
    index,
    selected = false,
    userPositioned = false,
    viewportZoom = 1,
    dragDisabled = false,
    attachDropTarget = false,
    dockEdgeHighlight = null,
    showAttachSlots = false,
    presetDropHighlight = false,
    presetInsertIndex = null,
    onpresetpointerdown,
    onpresetcontextmenu,
    onselect,
    onclickselect,
    onmove,
    ondraggrab,
    ondragend,
  }: Props = $props();

  const DRAG_THRESHOLD_PX = 3;

  let pointerActive = $state(false);
  let dragging = $state(false);
  let pointerDownScreen = { x: 0, y: 0 };
  /** Display origin at pointer-down — avoids snap when stored coords differ from layoutSlaves. */
  let dragOriginDisplay = { x: 0, y: 0 };
  let wasAttachedAtDragStart = false;
  let bankRenameDraft = $state('');
  let presetRenameDraft = $state('');
  let commentTooltip = $state<{ text: string; x: number; y: number } | null>(null);
  let presetHoverActive = $state(false);

  const presetsByUuid = $derived(
    new Map(bank.presets.map((preset) => [preset.uuid.toLowerCase(), preset])),
  );

  const isRenamingBank = $derived(
    $bankMeta.renamingBankUuid === bank.uuid && $bankMeta.renameSurface === 'canvas',
  );

  $effect(() => {
    if (!isRenamingBank) return;
    bankRenameDraft = bank.name;
  });

  $effect(() => {
    const target = $bankMeta.renamingPreset;
    if (
      !target ||
      target.bankUuid !== bank.uuid ||
      $bankMeta.renameSurface !== 'canvas'
    ) {
      return;
    }
    const preset = presetsByUuid.get(target.presetUuid.toLowerCase());
    if (!preset) return;
    presetRenameDraft = preset.name;
  });

  const slotUuids = $derived(bank.presetOrder);
  const isEmpty = $derived(slotUuids.length === 0);
  const selectedPresetUuid = $derived(bank.selectedPreset?.toLowerCase() ?? '');

  const scale = C15_SCALE;
  const placementW = $derived(effectiveFacingWidth(bank) * scale);
  const outerW = $derived(bankOuterWidth() * scale);
  const outerH = $derived(bankOuterHeight(bank) * scale);
  const tapePx = BANK_LAYOUT.tapeSize * scale;
  const innerH = $derived(bankInnerBodyHeight(bank) * scale);
  /** Flush chrome spans placement width (240/255); attach strips stay west/east outside. */
  const chromeLeftPx = 0;
  const chromeTopPx = tapePx;
  const chromeW = $derived(placementW);
  const headerPx = BANK_LAYOUT.headerHeight * scale;
  const rowPx = BANK_LAYOUT.presetRowHeight * scale;
  const borderPx = Math.max(1, BANK_LAYOUT.bodyBorderWidth * scale);
  const radiusPx = BANK_LAYOUT.bodyCornerRadiusTop * scale;
  const numberColPx = BANK_LAYOUT.presetNumberWidth * scale;
  const headerFontPx = BANK_LAYOUT.headerFontHeight * scale;
  const innerMarginPx = BANK_LAYOUT.innerMargin * scale;
  const colorTagPx = 6 * scale;
  const dockHighlightPx = Math.max(6, 10 * scale);
  /** NonMaps `getVisibleAttachArea()` — drawn attach strip within tape. */
  const visibleAttachPx = BANK_LAYOUT.visibleAttachArea * scale;

  const headerBg = $derived(
    presetDropHighlight
      ? '#67e8f9'
      : selected
        ? 'var(--color-c15-bank-header-selected)'
        : 'var(--color-c15-bank-header)',
  );

  const insertLineHeightPx = Math.max(2, 2 * scale);

  const insertLineTopPx = $derived.by(() => {
    if (presetInsertIndex === null) return null;
    let y = insertLineInnerY(presetInsertIndex, bank) * scale;
    if (presetInsertIndex >= slotUuids.length) {
      y = Math.min(y, innerH - insertLineHeightPx);
    }
    return y;
  });

  const bodyBorderColor = $derived(
    presetDropHighlight
      ? '#22d3ee'
      : attachDropTarget
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

  function presetLabel(uuid: string): string {
    return presetsByUuid.get(uuid.toLowerCase())?.name ?? '';
  }

  function presetComment(uuid: string): string {
    return presetsByUuid.get(uuid.toLowerCase())?.comment?.trim() ?? '';
  }

  function showPresetCommentTooltip(text: string, event: PointerEvent): void {
    commentTooltip = { text, x: event.clientX, y: event.clientY };
  }

  function movePresetCommentTooltip(event: PointerEvent): void {
    if (!commentTooltip) return;
    commentTooltip = { text: commentTooltip.text, x: event.clientX, y: event.clientY };
  }

  function hidePresetCommentTooltip(): void {
    commentTooltip = null;
  }

  function presetTagColor(uuid: string): string | null {
    const preset = presetsByUuid.get(uuid.toLowerCase());
    return preset ? presetColorFromRawXml(preset.rawXml) : null;
  }

  function presetNumber(slotIndex: number): string {
    return String(slotIndex + 1).padStart(3, '0');
  }

  function isUserPresetSelected(uuid: string): boolean {
    const needle = uuid.toLowerCase();
    return (
      $bankMeta.presetSelectionBankUuid === bank.uuid &&
      $bankMeta.selectedPresetUuids.some((u) => u.toLowerCase() === needle)
    );
  }

  /** C15 backup active preset — only when the user has not selected presets in this bank. */
  function isC15ActivePreset(uuid: string): boolean {
    if (
      $bankMeta.presetSelectionBankUuid === bank.uuid &&
      $bankMeta.selectedPresetUuids.length > 0
    ) {
      return false;
    }
    return selectedPresetUuid === uuid.toLowerCase();
  }

  function handleHeaderClick(event: MouseEvent): void {
    event.stopPropagation();
    onselect?.(bank.uuid, event);
  }

  function presetsToMove(clickedUuid: string): string[] {
    if (
      $bankMeta.presetSelectionBankUuid === bank.uuid &&
      $bankMeta.selectedPresetUuids.length > 0
    ) {
      const needle = clickedUuid.toLowerCase();
      if ($bankMeta.selectedPresetUuids.some((u) => u.toLowerCase() === needle)) {
        return $bankMeta.selectedPresetUuids;
      }
    }
    return [clickedUuid];
  }

  function onPresetPointerDown(uuid: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    onpresetpointerdown?.(bank.uuid, presetsToMove(uuid), uuid, event);
  }

  function onPresetContextMenu(uuid: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onpresetcontextmenu?.(bank.uuid, uuid, event);
  }

  function commitBankRename(): void {
    if (!isRenamingBank) return;
    if (bankRenameDraft.trim() === bank.name) {
      cancelRenameBank();
      return;
    }
    renameBank(bank.uuid, bankRenameDraft);
  }

  function commitPresetRename(presetUuid: string): void {
    const target = $bankMeta.renamingPreset;
    if (!target || target.bankUuid !== bank.uuid || target.presetUuid !== presetUuid) return;
    const preset = presetsByUuid.get(presetUuid.toLowerCase());
    if (!preset || presetRenameDraft.trim() === preset.name) {
      cancelRenamePreset();
      return;
    }
    renamePreset(bank.uuid, presetUuid, presetRenameDraft);
  }

  function onHeaderPointerDown(event: PointerEvent): void {
    if (isRenamingBank || dragDisabled || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-attach-handle]')) return;
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(event.pointerId);
    pointerActive = true;
    dragging = false;
    pointerDownScreen = { x: event.clientX, y: event.clientY };
    dragOriginDisplay = { x: displayX, y: displayY };
    wasAttachedAtDragStart = Boolean(bank.attachedToUuid);
    onselect?.(bank.uuid, event as unknown as MouseEvent);
  }

  function onHeaderPointerMove(event: PointerEvent): void {
    if (!pointerActive) return;
    event.stopPropagation();

    if (!dragging) {
      const totalDx = event.clientX - pointerDownScreen.x;
      const totalDy = event.clientY - pointerDownScreen.y;
      if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
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

  function onHeaderPointerUp(event: PointerEvent): void {
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

  const bodyRingClass = $derived(
    selected
      ? 'ring-2 ring-c15-bank-selected-glow/70'
      : userPositioned
        ? 'ring-1 ring-sky-500/35'
        : '',
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pointer-events-none absolute select-none
    {dragging ? 'cursor-grabbing z-30' : presetHoverActive ? 'z-[25]' : selected ? 'z-20' : ''}"
  style:left="{displayX * scale}px"
  style:top="{displayY * scale}px"
  style:width="{outerW}px"
  style:height="{outerH}px"
>
  {#if showAttachSlots}
    <!-- C15 attach corridors — outside flush chrome, visible only while dragging. -->
    <div
      class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
      style:left="{-visibleAttachPx}px"
      style:top="{tapePx}px"
      style:width="{visibleAttachPx}px"
      style:height="{innerH}px"
    ></div>
    <div
      class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
      style:left="{placementW}px"
      style:top="{tapePx}px"
      style:width="{visibleAttachPx}px"
      style:height="{innerH}px"
    ></div>
    <div
      class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
      style:left="0"
      style:top="{tapePx - visibleAttachPx}px"
      style:width="{placementW}px"
      style:height="{visibleAttachPx}px"
    ></div>
    <div
      class="pointer-events-none absolute z-[15] bg-c15-attach-slot/50"
      style:left="0"
      style:top="{tapePx + innerH}px"
      style:width="{placementW}px"
      style:height="{visibleAttachPx}px"
    ></div>
  {/if}

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

  {#if presetDropHighlight && insertLineTopPx !== null}
    <div
      class="pointer-events-none absolute left-0 right-0 z-40 bg-c15-accent shadow-[0_0_6px_rgba(232,168,56,0.9)]"
      style:left="{chromeLeftPx}px"
      style:top="{chromeTopPx + insertLineTopPx}px"
      style:width="{chromeW}px"
      style:height="{insertLineHeightPx}px"
    ></div>
  {/if}

  {#if userPositioned}
    <div
      class="pointer-events-auto absolute z-10 rounded-full bg-sky-400"
      style:left="{chromeLeftPx - 4}px"
      style:top="{chromeTopPx - 4}px"
      style:width="{8 * scale}px"
      style:height="{8 * scale}px"
      title="Manually positioned — won't follow parent moves"
    ></div>
  {/if}

  <!-- Visible flush chrome — effective width (240/255) from bank.x; top tape inset only -->
  <div
    class="pointer-events-auto absolute overflow-hidden bg-c15-preset-row {bodyRingClass}"
    style:left="{chromeLeftPx}px"
    style:top="{chromeTopPx}px"
    style:width="{chromeW}px"
    style:height="{innerH}px"
    style:border="{borderPx}px solid {bodyBorderColor}"
    style:border-radius="{radiusPx}px {radiusPx}px 0 0"
    style:box-shadow="{bodyShadow}"
    onpointerenter={() => {
      presetHoverActive = true;
    }}
    onpointerleave={() => {
      presetHoverActive = false;
      hidePresetCommentTooltip();
    }}
  >
    <!-- Header: drag handle + bank selection -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex shrink-0 items-center border-b border-black/20
        {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
      style:height="{headerPx}px"
      style:min-height="{headerPx}px"
      style:padding-left="{innerMarginPx}px"
      style:padding-right="{innerMarginPx}px"
      style:background-color="{headerBg}"
      data-bank-header-drop={bank.uuid}
      onclick={handleHeaderClick}
      onpointerdown={onHeaderPointerDown}
      onpointermove={onHeaderPointerMove}
      onpointerup={onHeaderPointerUp}
      onpointercancel={onHeaderPointerUp}
    >
      {#if isRenamingBank}
        <input
          use:focusRenameInput
          type="text"
          class="min-w-0 flex-1 rounded border border-c15-accent bg-c15-bg px-1 py-0.5 font-medium text-c15-text outline-none ring-2 ring-c15-accent/40"
          style:font-size="{headerFontPx}px"
          bind:value={bankRenameDraft}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.code === 'Enter') {
              e.preventDefault();
              commitBankRename();
            } else if (e.code === 'Escape') {
              e.preventDefault();
              cancelRenameBank();
            }
          }}
          onblur={commitBankRename}
        />
      {:else}
        <span
          class="truncate font-medium leading-none text-c15-bank-header-text"
          style:font-size="{headerFontPx}px"
          title="{index + 1} - {bank.name}"
        >
          {index + 1} - {bank.name}
        </span>
      {/if}
    </div>

    <!-- Preset list or empty placeholder -->
    {#if isEmpty}
      <div
        class="flex shrink-0 items-center justify-center leading-none text-c15-preset-empty"
        style:height="{rowPx}px"
        style:min-height="{rowPx}px"
        style:font-size="{12 * scale}px"
      >
        - empty -
      </div>
    {:else}
      <div class="flex flex-col">
        {#each slotUuids as uuid, slotIndex (uuid)}
          {@const label = presetLabel(uuid)}
          {@const comment = presetComment(uuid)}
          {@const userSelected = isUserPresetSelected(uuid)}
          {@const c15Active = isC15ActivePreset(uuid)}
          {@const isLast = slotIndex === slotUuids.length - 1}
          {@const tagColor = presetTagColor(uuid)}
          {@const isRenamingPreset =
            $bankMeta.renameSurface === 'canvas' &&
            $bankMeta.renamingPreset?.bankUuid === bank.uuid &&
            $bankMeta.renamingPreset?.presetUuid === uuid}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            role="button"
            tabindex="-1"
            class="relative flex shrink-0 cursor-default items-center overflow-hidden text-left leading-none
              {userSelected
                ? 'bg-c15-preset-ui-selected text-white ring-1 ring-inset ring-c15-preset-ui-selected-ring/80'
                : c15Active
                  ? 'bg-c15-preset-selected text-white'
                  : 'bg-c15-preset-row text-c15-text'}
              {!isLast ? 'border-b border-c15-border/60' : ''}"
            style:height="{rowPx}px"
            style:min-height="{rowPx}px"
            title={label || `Slot ${slotIndex + 1}`}
            onpointerdown={(e) => onPresetPointerDown(uuid, e)}
            oncontextmenu={(e) => onPresetContextMenu(uuid, e)}
          >
            {#if tagColor}
              <span
                class="shrink-0 self-stretch"
                style:width="{colorTagPx}px"
                style:background-color="{tagColor}"
                style:margin-top="{rowPx / 6}px"
                style:margin-bottom="{rowPx / 6}px"
              ></span>
            {/if}
            <span
              class="shrink-0 font-mono {userSelected || c15Active ? 'text-white/90' : 'text-c15-text-muted'}"
              style:width="{numberColPx}px"
              style:padding-left="{tagColor ? 0 : 2.5 * scale}px"
              style:font-size="{12 * scale}px"
            >
              {presetNumber(slotIndex)}
            </span>
            {#if isRenamingPreset}
              <input
                use:focusRenameInput
                type="text"
                class="min-w-0 flex-1 rounded border border-c15-accent bg-c15-bg px-1 text-c15-text outline-none ring-1 ring-c15-accent/50"
                style:font-size="{12 * scale}px"
                bind:value={presetRenameDraft}
                onkeydown={(e) => {
                  e.stopPropagation();
                  if (e.code === 'Enter') {
                    e.preventDefault();
                    commitPresetRename(uuid);
                  } else if (e.code === 'Escape') {
                    e.preventDefault();
                    cancelRenamePreset();
                  }
                }}
                onblur={() => commitPresetRename(uuid)}
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <span
                class="min-w-0 flex-1 truncate {label ? '' : 'text-c15-text-muted/50'}"
                style:font-size="{12 * scale}px"
                style:padding-right="{comment && !isRenamingPreset ? 10 * scale : 0}px"
              >
                {label || '·'}
              </span>
            {/if}
            {#if comment && !isRenamingPreset}
              <button
                type="button"
                tabindex="-1"
                data-preset-comment="true"
                class="absolute z-[50] flex cursor-default items-center justify-center font-bold leading-none text-yellow-400"
                style:right="{1 * scale}px"
                style:top="{0}px"
                style:width="{12 * scale}px"
                style:height="{12 * scale}px"
                style:font-size="{9 * scale}px"
                aria-label="Has comment: {comment}"
                onpointerenter={(e) => showPresetCommentTooltip(comment, e)}
                onpointermove={movePresetCommentTooltip}
                onpointerleave={hidePresetCommentTooltip}
                onpointerdown={(e) => e.stopPropagation()}
              >C</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if commentTooltip}
    <div
      use:portalBody
      class="pointer-events-none fixed z-[9999] max-w-[260px] overflow-hidden rounded-md border border-yellow-400/50 bg-c15-surface-raised shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
      style:left="{commentTooltip.x}px"
      style:top="{commentTooltip.y}px"
      role="tooltip"
    >
      <div
        class="border-b border-yellow-400/30 bg-yellow-400/10 px-2.5 py-1 text-xs font-semibold tracking-wide text-yellow-400"
      >
        Comment:
      </div>
      <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
        {commentTooltip.text}
      </div>
    </div>
  {/if}
</div>