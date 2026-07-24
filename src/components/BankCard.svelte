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
  import { insertLineInnerY } from '../lib/canvas/presetDragHitTest';
  import { presetColorFromName } from '../lib/canvas/presetColors';

  import {
    bankMeta,
    cancelRenameBank,
    cancelRenamePreset,
    renameBank,
    renamePreset,
  } from '../lib/model/bankStore';
  import { resolvePresetUuidsForAction } from '../lib/model/presetSelection';
  import {
    selTrace,
    selTracePointer,
  } from '../lib/debug/selectionTrace';
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

    dragDisabled?: boolean;
    attachDropTarget?: boolean;
    dockEdgeHighlight?: DockEdge | null;
    /** Show C15-style attach corridors (cluster / dock-hover only while dragging). */
    showAttachSlots?: boolean;
    presetDropHighlight?: boolean;
    presetInsertIndex?: number | null;
    /** Live bank-drag chrome (owned by Canvas window gesture). */
    dragging?: boolean;
    /** Drop multi-layer selection glow while a bank drag is active (border still marks selection). */
    reduceSelectionGlow?: boolean;
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
    /** Bank header right-click (export menu); Canvas owns selection resolve. */
    onbankcontextmenu?: (bankUuid: string, event: MouseEvent) => void;
    /**
     * Bank drag/select gesture start — Canvas tracks move/up on window.
     * Do not use setPointerCapture here — Canvas captures on the stable root.
     */
    onbankpointerdown?: (info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      pointerId: number;
    }) => void;
  }

  let {
    bank,
    displayX,
    displayY,
    index,
    selected = false,
    userPositioned = false,

    dragDisabled = false,
    attachDropTarget = false,
    dockEdgeHighlight = null,
    showAttachSlots = false,
    presetDropHighlight = false,
    presetInsertIndex = null,
    dragging = false,
    reduceSelectionGlow = false,
    onpresetpointerdown,
    onpresetcontextmenu,
    onbankcontextmenu,
    onbankpointerdown,
  }: Props = $props();

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
    selected && !reduceSelectionGlow
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
    // Use cached preset.color — never re-parse rawXml on the paint path.
    return preset ? presetColorFromName(preset.color) : null;
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

  function presetsToMove(clickedUuid: string): string[] {
    return resolvePresetUuidsForAction(bank.uuid, clickedUuid, $bankMeta);
  }

  /**
   * When ≥2 banks are multi-selected, a plain press on a selected bank's body
   * starts bank multi-drag (same as header). Ctrl/Shift still open the preset path.
   */
  function shouldBankDragFromPresetBody(event: PointerEvent): boolean {
    if (isRenamingBank || dragDisabled) return false;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
    const selectedBanks = $bankMeta.selectedBankUuids;
    return selectedBanks.length >= 2 && selectedBanks.includes(bank.uuid);
  }

  function emitBankPointerDown(event: PointerEvent, source: string): void {
    // stopPropagation: do not start canvas pan/marquee.
    // preventDefault: reduce UA pan/scroll/drag that fires pointercancel on grab re-render.
    event.stopPropagation();
    event.preventDefault();
    selTracePointer('bankcard.bank-pointerdown', event, {
      source,
      bankUuid: bank.uuid.slice(0, 8),
      bankName: bank.name,
      selectedProp: selected,
      dragDisabled,
      isRenamingBank,
    });
    onbankpointerdown?.({
      clientX: event.clientX,
      clientY: event.clientY,
      originX: displayX,
      originY: displayY,
      pointerId: event.pointerId,
    });
  }

  function onPresetPointerDown(uuid: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    const bodyBankDrag = shouldBankDragFromPresetBody(event);
    selTracePointer('bankcard.preset-down', event, {
      bankUuid: bank.uuid.slice(0, 8),
      bankName: bank.name,
      presetUuid: uuid.slice(0, 8),
      selectedProp: selected,
      bodyBankDrag,
      selectedBankCount: $bankMeta.selectedBankUuids.length,
      bankInSelection: $bankMeta.selectedBankUuids.includes(bank.uuid),
      dragDisabled,
      isRenamingBank,
    });
    if (bodyBankDrag) {
      emitBankPointerDown(event, 'preset-body-multiselect');
      return;
    }
    onpresetpointerdown?.(bank.uuid, presetsToMove(uuid), uuid, event);
  }

  function onPresetContextMenu(uuid: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onpresetcontextmenu?.(bank.uuid, uuid, event);
  }

  function onHeaderContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onbankcontextmenu?.(bank.uuid, event);
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
    if (isRenamingBank || dragDisabled || event.button !== 0) {
      selTrace('bankcard.header-down-ignored', {
        bankUuid: bank.uuid.slice(0, 8),
        bankName: bank.name,
        reason: isRenamingBank
          ? 'renaming'
          : dragDisabled
            ? 'dragDisabled'
            : `button=${event.button}`,
        selectedProp: selected,
        selectedBankCount: $bankMeta.selectedBankUuids.length,
      });
      return;
    }
    emitBankPointerDown(event, 'header');
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
    <!-- Header: drag handle + bank selection (canvas owns capture + move/up) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex shrink-0 items-center border-b border-black/20 touch-none
        {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
      style:height="{headerPx}px"
      style:min-height="{headerPx}px"
      style:padding-left="{innerMarginPx}px"
      style:padding-right="{innerMarginPx}px"
      style:background-color="{headerBg}"
      data-bank-header-drop={bank.uuid}
      onpointerdown={onHeaderPointerDown}
      oncontextmenu={onHeaderContextMenu}
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
            onpointerenter={
              comment && !isRenamingPreset
                ? (e) => showPresetCommentTooltip(comment, e)
                : undefined
            }
            onpointermove={
              comment && !isRenamingPreset ? movePresetCommentTooltip : undefined
            }
            onpointerleave={
              comment && !isRenamingPreset ? hidePresetCommentTooltip : undefined
            }
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
                {label || '—'}
              </span>
            {/if}
            {#if comment && !isRenamingPreset}
              <!-- Visual marker only; hover target is the full preset row. -->
              <span
                data-preset-comment="true"
                class="pointer-events-none absolute z-[50] flex items-center justify-center font-bold leading-none text-yellow-400"
                style:right="{1 * scale}px"
                style:top="0"
                style:width="{12 * scale}px"
                style:height="{rowPx}px"
                style:font-size="{10 * scale}px"
                aria-hidden="true"
              >
                C
              </span>
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
      style:left="{commentTooltip.x + 12}px"
      style:top="{commentTooltip.y + 12}px"
      role="tooltip"
    >
      <div
        class="border-b border-c15-border/80 bg-c15-surface px-2.5 py-1 text-xs font-semibold tracking-wide text-yellow-400/90"
      >
        Comment
      </div>
      <div class="px-2.5 py-1.5 text-xs leading-relaxed text-c15-text">
        {commentTooltip.text}
      </div>
    </div>
  {/if}
</div>
