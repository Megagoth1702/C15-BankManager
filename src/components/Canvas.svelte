<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { buildBankDragMoveSet } from '../lib/model/positioning';
  import {
    endBankDragPerfSession,
    recordEdgeScrollFrame,
    recordPointerMovedFrame,
    recordVisibleBanksRendered,
    startBankDragPerfSession,
    timeApply,
    timeDock,
    timeLayout,
    timeStore,
    timeVisibility,
  } from '../lib/debug/dragPerfLog';
  import { log } from '../lib/debug/sessionLog';
  import { recordBankRenderSnapshot } from '../lib/debug/renderPerfLog';
  import { shouldIgnoreKeyboardShortcut } from '../lib/keyboard';
  import { attachHandleAnchorC15 } from '../lib/canvas/attachAnchors';
  import {
    getDisplayPosition,
    resolveDisplayPositions,
    resolveDragClusterDisplayPositions,
    type DisplayPositionMap,
  } from '../lib/canvas/displayPosition';
  import {
    bankUuidsInC15Rect,
    c15RectFromClientCorners,
    screenRectFromClientCorners,
  } from '../lib/canvas/marqueeSelect';
  import { clientToC15, findBankAtC15Point } from '../lib/canvas/hitTest';
  import {
    findPresetDropTarget,
    type PresetDropTarget,
  } from '../lib/canvas/presetDragHitTest';
  import {
    registerCanvasElement,
    updatePointerPosition,
  } from '../lib/canvas/pointerPosition';
  import { findDockTargetForDraggedBank } from '../lib/canvas/dockHitTest';
  import {
    findBorderSnapForDraggedBank,
    type SynthBorderEdge,
  } from '../lib/canvas/borderSnapHitTest';
  import {
    computeEdgeScrollDelta,
    EDGE_SCROLL,
  } from '../lib/canvas/edgeAutoScroll';
  import { visibleBankUuidsInCanvas } from '../lib/canvas/viewportVisibility';
  import {
    handleToDockEdge,
    highlightEdgeForDockEdge,
    resolveAttachFromHandle,
  } from '../lib/model/attachOperation';
  import type { DockEdge } from '../lib/model/attachOperation';
  import { canAttachBank } from '../lib/model/attachRules';
  import {
    appSettings,
    attachBanksBatch,
    bankMeta,
    banks,
    beginUndoGroup,
    cancelRenameBank,
    createBank,
    detachBankFromParent,
    dockBankAtEdge,
    endUndoGroup,
    moveBankTo,
    copyPresetsToBank,
    deleteSelectedPresets,
    duplicateSelectedPresets,
    movePresetsToBank,
    reorderPresetsInBankStore,
    selectBank,
    selectBanks,
    selectPreset,
    selectPresetsBatch,
    userPositionedUuids,
  } from '../lib/model/bankStore';
  import {
    fitBanksToView,
    focusBank,
    focusPreset,
    focusSynthZone,
    panBy,
    viewport,
    zoomAt,
  } from '../lib/canvas/viewport.svelte';
  import type { AttachDirection } from '../lib/types/bank';
  import {
    BANK_LAYOUT,
    bankOuterWidth,
    C15_SCALE,
    emptyBankOuterHeight,
  } from '../lib/canvas/geometry';
  import { snapToGrid } from '../lib/model/bankFactory';
  import { BANK_LOD_FULL_ZOOM, bankCardVariant } from '../lib/canvas/lod';
  import AttachDragOverlay from './AttachDragOverlay.svelte';
  import BankCard from './BankCard.svelte';
  import BankCardLite from './BankCardLite.svelte';
  import CanvasContextMenu from './CanvasContextMenu.svelte';
  import ConnectionLines from './ConnectionLines.svelte';
  import PresetContextMenu from './PresetContextMenu.svelte';
  import PresetDragOverlay from './PresetDragOverlay.svelte';
  import PresetDragBankHint from './PresetDragBankHint.svelte';
  import BankGeometryDebugOverlay from './BankGeometryDebugOverlay.svelte';
  import CalibrationGuides from './CalibrationGuides.svelte';
  import SynthZoneOverlay from './SynthZoneOverlay.svelte';
  import WidthCalibRulers from './WidthCalibRulers.svelte';

  interface AttachDrag {
    sourceUuid: string;
    direction: AttachDirection;
    pointerId: number;
  }

  let canvasEl = $state<HTMLElement | undefined>(undefined);
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);

  let isPanning = $state(false);
  /** True when pan started via LMB on canvas background (not middle mouse). */
  let panFromBackgroundLmb = false;
  let panStartClient = { x: 0, y: 0 };
  let attachDrag = $state<AttachDrag | null>(null);
  let attachPointer = $state({ clientX: 0, clientY: 0 });
  let attachHoverUuid = $state<string | null>(null);
  let dockHover = $state<{
    targetUuid: string;
    draggedUuid: string;
    highlightEdge: DockEdge;
    draggedHighlightEdge: DockEdge;
    dockEdge: DockEdge;
  } | null>(null);
  let borderSnapHover = $state<SynthBorderEdge | null>(null);
  let borderSnapRole = $state<'outer' | 'inner' | null>(null);
  let lastPointer = { x: 0, y: 0 };
  let lastFittedCount = 0;
  let initialSynthViewport = false;
  let activeDragStored = $state<{ uuid: string; x: number; y: number } | null>(
    null,
  );
  let bankDragActive = $state(false);
  let bankDragGrab = $state<{
    uuid: string;
    offsetC15X: number;
    offsetC15Y: number;
    userDrag: boolean;
    pointerId: number;
  } | null>(null);
  let dragBaseDisplay = $state<DisplayPositionMap | null>(null);
  let dragDisplayMap = $state<DisplayPositionMap | null>(null);
  let dragClusterUuids = $state<Set<string> | null>(null);
  let autoScrollPointer = $state({ clientX: 0, clientY: 0 });
  let canvasClientRect = $state({ left: 0, top: 0, width: 0, height: 0 });
  let edgeScrollIntensities = $state({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  let edgeScrollRafId: number | null = null;
  let visibleCanvasBankUuids = $state<Set<string>>(new Set());
  let slotVisibilityDraggedUuid = $state<string | null>(null);
  let visibilityFrame = 0;
  let lastVisibilityLogCount = -1;
  let dockHoverFrame = 0;
  let lastDockDragX = 0;
  let lastDockDragY = 0;
  const CANVAS_CULL_MARGIN_PX = 96;
  const VISIBILITY_FRAME_INTERVAL = 4;
  const DOCK_HOVER_INTERVAL = 2;
  const DOCK_HOVER_MIN_DELTA_C15 = 4;

  const MARQUEE_THRESHOLD_PX = 3;
  let marqueePointerId: number | null = null;
  let marqueeStartClient = { x: 0, y: 0 };
  let marqueeCurrentClient = $state({ x: 0, y: 0 });
  let marqueeActive = $state(false);

  const PRESET_DRAG_THRESHOLD_PX = 3;

  let presetDrag = $state<{
    sourceBankUuid: string;
    presetUuids: string[];
    clickedUuid: string;
    pointerId: number;
    clientX: number;
    clientY: number;
    startClientX: number;
    startClientY: number;
    ctrl: boolean;
    shift: boolean;
    moveMode: boolean;
    active: boolean;
  } | null>(null);
  let presetDropTarget = $state<PresetDropTarget | null>(null);
  let presetHoverBank = $state<{ bankUuid: string; bankIndex: number } | null>(null);

  let presetContextMenu = $state<{
    clientX: number;
    clientY: number;
    bankUuid: string;
    presetUuids: string[];
  } | null>(null);

  /** Empty-canvas right-click menu (create bank at click point). */
  let canvasContextMenu = $state<{
    clientX: number;
    clientY: number;
    c15X: number;
    c15Y: number;
  } | null>(null);

  const marqueeScreenRect = $derived.by(() => {
    if (!marqueeActive || !canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    return screenRectFromClientCorners(
      marqueeStartClient.x,
      marqueeStartClient.y,
      marqueeCurrentClient.x,
      marqueeCurrentClient.y,
      rect,
    );
  });

  const displayByUuid = $derived.by(() => {
    if (bankDragActive && dragDisplayMap) return dragDisplayMap;
    const list = $banks;
    const overrides = activeDragStored
      ? new Map([[activeDragStored.uuid, { x: activeDragStored.x, y: activeDragStored.y }]])
      : undefined;
    return timeLayout(() => resolveDisplayPositions(list, overrides));
  });

  const visibleBanksForRender = $derived.by(() => {
    const visible = visibleCanvasBankUuids;
    const zoom = viewport.zoom;
    const rows: {
      bank: (typeof $banks)[number];
      index: number;
      variant: 'lite' | 'full';
    }[] = [];
    $banks.forEach((bank, index) => {
      const variant = bankCardVariant(zoom, bank.uuid, visible);
      if (variant !== null) {
        rows.push({ bank, index, variant });
      }
    });
    return rows;
  });

  function canvasRectLike(): DOMRect {
    return canvasClientRect as DOMRect;
  }

  function refreshCanvasClientRect(): void {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    canvasClientRect = {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    };
  }

  function buildAlwaysVisibleUuids(): Set<string> {
    const always = new Set<string>();
    if (dragClusterUuids) {
      for (const uuid of dragClusterUuids) always.add(uuid);
    }
    if (slotVisibilityDraggedUuid) always.add(slotVisibilityDraggedUuid);
    if (dockHover) {
      always.add(dockHover.targetUuid);
      always.add(dockHover.draggedUuid);
    }
    if (attachHoverUuid) always.add(attachHoverUuid);
    if (presetDropTarget) always.add(presetDropTarget.bankUuid);
    if (presetHoverBank) always.add(presetHoverBank.bankUuid);
    return always;
  }

  function refreshCanvasVisibility(force = false): void {
    if (canvasWidth <= 0 || canvasHeight <= 0 || $banks.length === 0) {
      visibleCanvasBankUuids = new Set();
      return;
    }

    visibilityFrame++;
    if (!force && visibilityFrame % VISIBILITY_FRAME_INTERVAL !== 0) {
      return;
    }

    const alwaysInclude = buildAlwaysVisibleUuids();
    const visible = timeVisibility(() =>
      visibleBankUuidsInCanvas(
        $banks,
        displayByUuid,
        viewport,
        canvasWidth,
        canvasHeight,
        alwaysInclude,
        CANVAS_CULL_MARGIN_PX,
      ),
    );
    visibleCanvasBankUuids = visible;
    recordVisibleBanksRendered(visible.size);
    recordBankRenderSnapshot($banks, visible, viewport.zoom);

    if (visible.size !== lastVisibilityLogCount) {
      lastVisibilityLogCount = visible.size;
      log('attach', 'canvas visibility', {
        visible: visible.size,
        total: $banks.length,
        dragged: slotVisibilityDraggedUuid ?? activeDragStored?.uuid ?? null,
        frame: visibilityFrame,
        bankDragActive,
      });
    }
  }

  function computeDragDisplayMap(
    draggedUuid: string,
    dragX: number,
    dragY: number,
  ): DisplayPositionMap {
    const list = $banks;
    // Local copy so TS narrows (Svelte $state fields do not narrow in closures).
    const baseDisplay = dragBaseDisplay;
    if (baseDisplay) {
      return timeLayout(() =>
        resolveDragClusterDisplayPositions(
          list,
          draggedUuid,
          dragX,
          dragY,
          baseDisplay,
          dragClusterUuids ?? undefined,
        ),
      );
    }
    return timeLayout(() =>
      resolveDisplayPositions(
        list,
        new Map([[draggedUuid, { x: dragX, y: dragY }]]),
      ),
    );
  }

  function isEdgeAutoScrollActive(): boolean {
    return bankDragActive || (presetDrag?.active ?? false);
  }

  function stopEdgeScrollLoop(): void {
    if (edgeScrollRafId !== null) {
      cancelAnimationFrame(edgeScrollRafId);
      edgeScrollRafId = null;
    }
    edgeScrollIntensities = { left: 0, right: 0, top: 0, bottom: 0 };
    slotVisibilityDraggedUuid = null;
    visibilityFrame = 0;
    lastVisibilityLogCount = -1;
  }

  function startEdgeScrollLoop(): void {
    if (edgeScrollRafId !== null) return;
    const tick = (): void => {
      if (!isEdgeAutoScrollActive() || !canvasEl) {
        stopEdgeScrollLoop();
        return;
      }
      recordEdgeScrollFrame();
      const rect = canvasRectLike();
      const result = computeEdgeScrollDelta(
        autoScrollPointer.clientX,
        autoScrollPointer.clientY,
        rect,
      );
      edgeScrollIntensities = result.intensities;
      if (result.dx !== 0 || result.dy !== 0) {
        panBy(result.dx, result.dy);
      }
      if (bankDragGrab) {
        applyBankDragPointer(autoScrollPointer.clientX, autoScrollPointer.clientY);
      }
      refreshCanvasVisibility();
      edgeScrollRafId = requestAnimationFrame(tick);
    };
    edgeScrollRafId = requestAnimationFrame(tick);
  }

  function onWindowPointerMove(event: PointerEvent): void {
    updatePointerPosition(event.clientX, event.clientY);
    if (
      event.clientX !== autoScrollPointer.clientX ||
      event.clientY !== autoScrollPointer.clientY
    ) {
      recordPointerMovedFrame();
    }
    autoScrollPointer = { clientX: event.clientX, clientY: event.clientY };
  }

  function onWindowPointerUp(event: PointerEvent): void {
    if (!bankDragGrab || bankDragGrab.pointerId !== event.pointerId) return;
    handleBankDragEnd(bankDragGrab.uuid);
  }

  onMount(() => {
    log('canvas', 'mounted');
    if (!canvasEl) return;

    registerCanvasElement(canvasEl);
    refreshCanvasClientRect();
    window.addEventListener('pointermove', onWindowPointerMove, { capture: true });
    window.addEventListener('pointerup', onWindowPointerUp, { capture: true });
    window.addEventListener('pointercancel', onWindowPointerUp, { capture: true });
    window.addEventListener('resize', refreshCanvasClientRect);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      canvasWidth = entry.contentRect.width;
      canvasHeight = entry.contentRect.height;
      refreshCanvasClientRect();
    });

    observer.observe(canvasEl);
    canvasWidth = canvasEl.clientWidth;
    canvasHeight = canvasEl.clientHeight;

    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', onWindowPointerMove, { capture: true });
      window.removeEventListener('pointerup', onWindowPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onWindowPointerUp, { capture: true });
      window.removeEventListener('resize', refreshCanvasClientRect);
      stopEdgeScrollLoop();
      registerCanvasElement(null);
    };
  });

  $effect(() => {
    if (!initialSynthViewport && canvasWidth > 0 && canvasHeight > 0) {
      focusSynthZone(canvasWidth, canvasHeight);
      initialSynthViewport = true;
      log('canvas', 'focusSynthZone', {
        zoom: viewport.zoom,
        panX: viewport.panX,
        panY: viewport.panY,
      });
    }
  });

  $effect(() => {
    const list = $banks;
    const count = list.length;

    const AUTO_FIT_MIN_BANKS = 3;
    if (
      count >= AUTO_FIT_MIN_BANKS &&
      lastFittedCount === 0 &&
      canvasWidth > 0 &&
      canvasHeight > 0
    ) {
      fitBanksToView(list, canvasWidth, canvasHeight);
      lastFittedCount = count;
      log('canvas', 'fitToView', { count, zoom: viewport.zoom, panX: viewport.panX, panY: viewport.panY });
    } else if (count > 0) {
      lastFittedCount = count;
    }
  });

  $effect(() => {
    const uuid = $bankMeta.focusBankUuid;
    const presetUuid = $bankMeta.focusPresetUuid;
    if (!uuid || canvasWidth <= 0 || canvasHeight <= 0) return;
    const bank = $banks.find((b) => b.uuid === uuid);
    if (!bank) return;
    if (presetUuid) {
      focusPreset(bank, presetUuid, $banks, canvasWidth, canvasHeight);
    } else {
      focusBank(bank, canvasWidth, canvasHeight, $banks);
    }
    bankMeta.update((m) => ({
      ...m,
      focusBankUuid: null,
      focusPresetUuid: null,
    }));
  });

  $effect(() => {
    viewport.zoom;
    canvasWidth;
    canvasHeight;
    $banks.length;
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    refreshCanvasVisibility(true);
  });

  $effect(() => {
    viewport.zoom;
    untrack(() => {
      const drag = presetDrag;
      if (!drag?.active) return;
      updatePresetDragTargets(drag.clientX, drag.clientY);
    });
  });

  function onWheel(event: WheelEvent): void {
    if (!canvasEl) return;
    event.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    refreshCanvasVisibility(true);
  }

  function startPan(clientX: number, clientY: number): void {
    isPanning = true;
    lastPointer = { x: clientX, y: clientY };
  }

  function closePresetContextMenu(): void {
    presetContextMenu = null;
  }

  function closeCanvasContextMenu(): void {
    canvasContextMenu = null;
  }

  function onContextMenuOutsidePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (presetContextMenu) {
      if (target.closest('[data-preset-context-menu]')) return;
      if (target.closest('[data-preset-comment-dialog]')) return;
      // Keep comment editor open until the user saves, cancels, or presses Escape.
      if (document.querySelector('[data-preset-comment-dialog]')) return;
      closePresetContextMenu();
    }
    if (canvasContextMenu) {
      if (target.closest('[data-canvas-context-menu]')) return;
      closeCanvasContextMenu();
    }
  }

  $effect(() => {
    if (!presetContextMenu && !canvasContextMenu) return;
    window.addEventListener('pointerdown', onContextMenuOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onContextMenuOutsidePointerDown, true);
    };
  });

  function handleCanvasContextMenu(event: MouseEvent): void {
    event.preventDefault();

    const target = event.target as HTMLElement;
    if (
      target.closest('[data-preset-context-menu]') ||
      target.closest('[data-canvas-context-menu]') ||
      target.closest('[data-preset-comment-dialog]')
    ) {
      return;
    }

    // Preset rows handle their own menu (stopPropagation). Still skip when over a bank.
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(event.clientX, event.clientY, rect, viewport);
    const hit = findBankAtC15Point($banks, c15.x, c15.y, undefined, displayByUuid);
    if (hit) return;

    closePresetContextMenu();
    updatePointerPosition(event.clientX, event.clientY);
    canvasContextMenu = {
      clientX: event.clientX,
      clientY: event.clientY,
      c15X: c15.x,
      c15Y: c15.y,
    };
    log('canvas', 'context menu', { c15X: c15.x, c15Y: c15.y });
  }

  function handleCreateBankFromContextMenu(): void {
    const menu = canvasContextMenu;
    if (!menu) return;

    const width = bankOuterWidth() - BANK_LAYOUT.visibleAttachArea;
    const height = emptyBankOuterHeight();
    const bank = createBank({
      x: snapToGrid(menu.c15X - width / 2),
      y: snapToGrid(menu.c15Y - height / 2),
    });
    log('canvas', 'create bank from context menu', {
      uuid: bank.uuid,
      x: bank.x,
      y: bank.y,
    });
  }

  function onPointerDown(event: PointerEvent): void {
    if (!canvasEl) return;
    const isMiddle = event.button === 1;
    const target = event.target as HTMLElement;
    const onBackground = target.dataset.canvasBackground === 'true';

    // Middle-mouse pan (anywhere on canvas surface that reaches this handler).
    if (isMiddle) {
      event.preventDefault();
      panFromBackgroundLmb = false;
      canvasEl.setPointerCapture(event.pointerId);
      startPan(event.clientX, event.clientY);
      return;
    }

    // Background only: LMB pans; Ctrl/Meta+LMB marquee-selects banks.
    // Bank cards and presets handle their own pointer events — leave them alone.
    if (event.button === 0 && onBackground) {
      if (event.ctrlKey || event.metaKey) {
        marqueePointerId = event.pointerId;
        marqueeStartClient = { x: event.clientX, y: event.clientY };
        marqueeCurrentClient = { x: event.clientX, y: event.clientY };
        marqueeActive = false;
        canvasEl.setPointerCapture(event.pointerId);
      } else {
        panFromBackgroundLmb = true;
        panStartClient = { x: event.clientX, y: event.clientY };
        canvasEl.setPointerCapture(event.pointerId);
        startPan(event.clientX, event.clientY);
      }
    }
  }

  function finishMarquee(event: PointerEvent): void {
    if (marqueePointerId === null) return;

    if (marqueeActive && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const c15Rect = c15RectFromClientCorners(
        marqueeStartClient.x,
        marqueeStartClient.y,
        marqueeCurrentClient.x,
        marqueeCurrentClient.y,
        rect,
        viewport,
      );
      const hits = bankUuidsInC15Rect($banks, c15Rect, displayByUuid);
      if (hits.length > 0) {
        selectBanks(hits, 'replace');
      } else {
        selectBank(null);
      }
    } else {
      // Ctrl+click on background without drag — clear selection.
      selectBank(null);
    }

    marqueePointerId = null;
    marqueeActive = false;
    canvasEl?.releasePointerCapture(event.pointerId);
  }

  function updateAttachHover(clientX: number, clientY: number): void {
    if (!attachDrag || !canvasEl) {
      attachHoverUuid = null;
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(clientX, clientY, rect, viewport);
    const hit = findBankAtC15Point(
      $banks,
      c15.x,
      c15.y,
      attachDrag.sourceUuid,
      displayByUuid,
    );
    attachHoverUuid = hit?.uuid ?? null;
    const dockEdge = handleToDockEdge(attachDrag.direction);
    dockHover = hit
      ? {
          targetUuid: hit.uuid,
          draggedUuid: attachDrag.sourceUuid,
          dockEdge,
          highlightEdge: highlightEdgeForDockEdge(dockEdge),
          draggedHighlightEdge: dockEdge,
        }
      : null;
  }

  function handleAttachStart(
    sourceUuid: string,
    direction: AttachDirection,
    event: PointerEvent,
  ): void {
    if (!canvasEl) return;
    attachDrag = { sourceUuid, direction, pointerId: event.pointerId };
    attachPointer = { clientX: event.clientX, clientY: event.clientY };
    canvasEl.setPointerCapture(event.pointerId);
    updateAttachHover(event.clientX, event.clientY);
    log('attach', 'drag started', { sourceUuid, direction });
  }

  function finishAttachDrag(event: PointerEvent): void {
    if (!attachDrag || !canvasEl) return;

    const { sourceUuid, direction } = attachDrag;
    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(event.clientX, event.clientY, rect, viewport);
    const target = findBankAtC15Point(
      $banks,
      c15.x,
      c15.y,
      sourceUuid,
      displayByUuid,
    );

    if (target) {
      const selected = $bankMeta.selectedBankUuids;
      const batch =
        selected.length > 1 && selected.includes(sourceUuid)
          ? selected
          : [sourceUuid];
      attachBanksBatch(batch, target.uuid, direction);
    }

    attachDrag = null;
    attachHoverUuid = null;
    dockHover = null;
    canvasEl.releasePointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (attachDrag) {
      attachPointer = { clientX: event.clientX, clientY: event.clientY };
      updateAttachHover(event.clientX, event.clientY);
      return;
    }
    if (marqueePointerId !== null && event.pointerId === marqueePointerId) {
      marqueeCurrentClient = { x: event.clientX, y: event.clientY };
      if (!marqueeActive) {
        const dx = event.clientX - marqueeStartClient.x;
        const dy = event.clientY - marqueeStartClient.y;
        if (Math.hypot(dx, dy) >= MARQUEE_THRESHOLD_PX) {
          marqueeActive = true;
        }
      }
      return;
    }
    if (!isPanning) return;
    panBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
    lastPointer = { x: event.clientX, y: event.clientY };
    refreshCanvasVisibility();
  }

  function onPointerUp(event: PointerEvent): void {
    if (attachDrag) {
      finishAttachDrag(event);
      return;
    }
    if (marqueePointerId !== null && event.pointerId === marqueePointerId) {
      finishMarquee(event);
      return;
    }
    if (!isPanning) return;
    // Short LMB click on empty background (no real pan) still deselects.
    if (panFromBackgroundLmb) {
      const dx = event.clientX - panStartClient.x;
      const dy = event.clientY - panStartClient.y;
      if (Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) {
        selectBank(null);
      }
    }
    panFromBackgroundLmb = false;
    isPanning = false;
    refreshCanvasVisibility(true);
    canvasEl?.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && !shouldIgnoreKeyboardShortcut(event.target)) {
      if ($bankMeta.renamingBankUuid) {
        cancelRenameBank();
        return;
      }
      if (attachDrag) {
        attachDrag = null;
        attachHoverUuid = null;
        dockHover = null;
        return;
      }
      if (presetContextMenu) {
        closePresetContextMenu();
        return;
      }
      if (canvasContextMenu) {
        closeCanvasContextMenu();
        return;
      }
      if (presetDrag) {
        window.removeEventListener('pointermove', onPresetDragPointerMove);
        window.removeEventListener('pointerup', onPresetDragPointerUp);
        window.removeEventListener('pointercancel', onPresetDragPointerUp);
        log('preset', 'drag cancel', { reason: 'escape' });
        presetDrag = null;
        presetDropTarget = null;
        presetHoverBank = null;
        return;
      }
      selectBank(null);
      return;
    }
  }

  function handleBankMove(
    uuid: string,
    x: number,
    y: number,
    userDrag: boolean,
  ): void {
    moveBankTo(uuid, x, y, { userDrag });
  }

  function presetDragLabel(uuids: string[], sourceBankUuid: string): string {
    const bank = $banks.find((b) => b.uuid === sourceBankUuid);
    const first = uuids[0];
    if (!bank || !first) return 'Preset';
    const preset = bank.presets.find(
      (p) => p.uuid.toLowerCase() === first.toLowerCase(),
    );
    return preset?.name || 'Preset';
  }

  function updatePresetDragTargets(clientX: number, clientY: number): void {
    if (!presetDrag?.active || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const hit = findPresetDropTarget(
      clientX,
      clientY,
      rect,
      viewport,
      $banks,
      displayByUuid,
    );

    const hoverNext = hit
      ? {
          bankUuid: hit.bankUuid,
          bankIndex: $banks.findIndex((b) => b.uuid === hit.bankUuid),
        }
      : null;
    const prevHover = presetHoverBank;
    if (
      hoverNext?.bankUuid !== prevHover?.bankUuid ||
      hoverNext?.bankIndex !== prevHover?.bankIndex
    ) {
      presetHoverBank = hoverNext;
    }

    const dropNext = hit;
    const prevDrop = presetDropTarget;
    if (
      dropNext?.bankUuid !== prevDrop?.bankUuid ||
      dropNext?.insertIndex !== prevDrop?.insertIndex
    ) {
      presetDropTarget = dropNext;
      log('preset', 'drag drop target', {
        target: dropNext?.bankUuid ?? null,
        insertIndex: dropNext?.insertIndex ?? null,
        zoom: viewport.zoom,
        clientX,
        clientY,
      });
    }
  }

  function finishPresetDrag(event: PointerEvent): void {
    window.removeEventListener('pointermove', onPresetDragPointerMove);
    window.removeEventListener('pointerup', onPresetDragPointerUp);
    window.removeEventListener('pointercancel', onPresetDragPointerUp);

    const drag = presetDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (drag.active) {
      const target = presetDropTarget;
      if (target) {
        const moveMode = event.ctrlKey || event.metaKey;
        const sameBank = target.bankUuid === drag.sourceBankUuid;
        const ok = sameBank
          ? reorderPresetsInBankStore(
              drag.presetUuids,
              target.bankUuid,
              target.insertIndex,
            )
          : moveMode
            ? movePresetsToBank(
                drag.presetUuids,
                drag.sourceBankUuid,
                target.bankUuid,
                target.insertIndex,
              )
            : copyPresetsToBank(
                drag.presetUuids,
                drag.sourceBankUuid,
                target.bankUuid,
                target.insertIndex,
              );
        log('preset', ok ? 'drag drop commit' : 'drag drop failed', {
          action: sameBank ? 'reorder' : moveMode ? 'move' : 'copy',
          source: drag.sourceBankUuid,
          target: target.bankUuid,
          insertIndex: target.insertIndex,
          count: drag.presetUuids.length,
          zoom: viewport.zoom,
        });
      } else {
        log('preset', 'drag drop cancel', { reason: 'no target bank' });
      }
    } else {
      selectPreset(drag.sourceBankUuid, drag.clickedUuid, {
        ctrl: drag.ctrl,
        shift: drag.shift,
      });
      log('preset', 'click select', {
        bankUuid: drag.sourceBankUuid,
        presetUuid: drag.clickedUuid,
      });
    }

    presetDrag = null;
    presetDropTarget = null;
    presetHoverBank = null;
    if (!bankDragActive) stopEdgeScrollLoop();
  }

  function onPresetDragPointerMove(event: PointerEvent): void {
    if (!presetDrag || event.pointerId !== presetDrag.pointerId) return;

    presetDrag = {
      ...presetDrag,
      clientX: event.clientX,
      clientY: event.clientY,
      moveMode: event.ctrlKey || event.metaKey,
    };

    if (!presetDrag.active) {
      const dx = event.clientX - presetDrag.startClientX;
      const dy = event.clientY - presetDrag.startClientY;
      if (Math.hypot(dx, dy) < PRESET_DRAG_THRESHOLD_PX) return;
      presetDrag = { ...presetDrag, active: true };
      selectPresetsBatch(presetDrag.sourceBankUuid, presetDrag.presetUuids);
      startEdgeScrollLoop();
      log('preset', 'drag start', {
        source: presetDrag.sourceBankUuid,
        count: presetDrag.presetUuids.length,
        uuids: presetDrag.presetUuids,
      });
    }

    updatePresetDragTargets(event.clientX, event.clientY);
  }

  function onPresetDragPointerUp(event: PointerEvent): void {
    finishPresetDrag(event);
  }

  function presetUuidsForContextMenu(bankUuid: string, presetUuid: string): string[] {
    const meta = get(bankMeta);
    const sameBank = meta.presetSelectionBankUuid === bankUuid;
    const needle = presetUuid.toLowerCase();
    const clickedInSelection =
      sameBank &&
      meta.selectedPresetUuids.some((u) => u.toLowerCase() === needle);

    if (clickedInSelection && meta.selectedPresetUuids.length > 0) {
      return meta.selectedPresetUuids;
    }

    selectPreset(bankUuid, presetUuid);
    return [presetUuid];
  }

  function handlePresetContextMenu(
    bankUuid: string,
    presetUuid: string,
    event: MouseEvent,
  ): void {
    closeCanvasContextMenu();
    const presetUuids = presetUuidsForContextMenu(bankUuid, presetUuid);
    presetContextMenu = {
      clientX: event.clientX,
      clientY: event.clientY,
      bankUuid,
      presetUuids,
    };
    log('preset', 'context menu', {
      bankUuid,
      presetUuid,
      count: presetUuids.length,
      keptSelection: presetUuids.length > 1,
    });
  }

  function handlePresetPointerDown(
    bankUuid: string,
    presetUuids: string[],
    clickedUuid: string,
    event: PointerEvent,
  ): void {
    if (presetContextMenu) closePresetContextMenu();
    if (canvasContextMenu) closeCanvasContextMenu();
    if (event.button !== 0 || attachDrag) return;

    presetDrag = {
      sourceBankUuid: bankUuid,
      presetUuids,
      clickedUuid,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      moveMode: event.ctrlKey || event.metaKey,
      active: false,
    };
    presetDropTarget = null;
    presetHoverBank = null;

    log('preset', 'drag pointer down', {
      bankUuid,
      clickedUuid,
      count: presetUuids.length,
    });

    window.addEventListener('pointermove', onPresetDragPointerMove);
    window.addEventListener('pointerup', onPresetDragPointerUp);
    window.addEventListener('pointercancel', onPresetDragPointerUp);
  }

  const presetDragVisual = $derived.by(() => {
    if (!presetDrag?.active) return null;
    return {
      clientX: presetDrag.clientX,
      clientY: presetDrag.clientY,
      label: presetDragLabel(presetDrag.presetUuids, presetDrag.sourceBankUuid),
      count: presetDrag.presetUuids.length,
      moveMode: presetDrag.moveMode,
    };
  });

  const presetDragBankHint = $derived.by(() => {
    if (
      !presetDrag?.active ||
      viewport.zoom >= BANK_LOD_FULL_ZOOM ||
      !presetHoverBank
    ) {
      return null;
    }
    const bank = $banks[presetHoverBank.bankIndex];
    if (!bank) return null;
    return {
      clientX: presetDrag.clientX,
      clientY: presetDrag.clientY,
      bankLabel: `${presetHoverBank.bankIndex + 1} - ${bank.name}`,
    };
  });

  function handleBankSelect(uuid: string, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) {
      selectBank(uuid, 'toggle');
      return;
    }
    selectBank(uuid, 'replace');
  }

  function handleBankClickSelect(uuid: string, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) return;
    selectBank(uuid, 'replace');
  }

  function applyBankDragPointer(clientX: number, clientY: number): void {
    if (!bankDragGrab || !canvasEl) return;
    timeApply(() => {
      const rect = canvasRectLike();
      const c15 = clientToC15(clientX, clientY, rect, viewport);
      let dragX = c15.x - bankDragGrab!.offsetC15X;
      let dragY = c15.y - bankDragGrab!.offsetC15Y;

      const dragged = $banks.find((b) => b.uuid === bankDragGrab!.uuid);
      let snappedEdge: SynthBorderEdge | null = null;
      let snappedRole: 'outer' | 'inner' | null = null;
      if (dragged && get(appSettings).showSynthZone) {
        const borderSnap = findBorderSnapForDraggedBank(dragged, dragX, dragY);
        if (borderSnap) {
          dragX = borderSnap.snappedX;
          dragY = borderSnap.snappedY;
          snappedEdge = borderSnap.edge;
          snappedRole = borderSnap.role;
        }
      }

      dragX = snapToGrid(dragX);
      dragY = snapToGrid(dragY);

      borderSnapHover = snappedEdge;
      borderSnapRole = snappedRole;
      if (snappedEdge) {
        dockHover = null;
      }

      const nextDisplay = computeDragDisplayMap(bankDragGrab!.uuid, dragX, dragY);
      dragDisplayMap = nextDisplay;
      activeDragStored = { uuid: bankDragGrab!.uuid, x: dragX, y: dragY };
      if (!snappedEdge) {
        updateDockHover(bankDragGrab!.uuid, dragX, dragY, nextDisplay);
      }
    });
  }

  function handleBankDragGrab(
    uuid: string,
    info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      userDrag: boolean;
      pointerId: number;
    },
  ): void {
    if (!canvasEl) return;
    const list = get(banks);
    const moveSet = buildBankDragMoveSet(uuid, list);
    beginUndoGroup('Move bank', [...moveSet]);

    // Undock the primary if it is attached; its own children stay attached and follow.
    timeStore(() => {
      const member = get(banks).find((b) => b.uuid === uuid);
      if (member?.attachedToUuid) {
        detachBankFromParent(uuid);
      }
    });

    const listAfter = get(banks);
    dragClusterUuids = moveSet;
    dragBaseDisplay = timeLayout(() => resolveDisplayPositions(listAfter));
    startBankDragPerfSession(listAfter, moveSet.size, viewport.zoom);

    const rect = canvasRectLike();
    const c15 = clientToC15(info.clientX, info.clientY, rect, viewport);
    bankDragGrab = {
      uuid,
      offsetC15X: c15.x - info.originX,
      offsetC15Y: c15.y - info.originY,
      userDrag: info.userDrag,
      pointerId: info.pointerId,
    };
    bankDragActive = true;
    slotVisibilityDraggedUuid = uuid;
    dockHoverFrame = 0;
    lastDockDragX = info.originX;
    lastDockDragY = info.originY;
    refreshCanvasVisibility(true);
    startEdgeScrollLoop();
    applyBankDragPointer(info.clientX, info.clientY);
  }

  function updateDockHover(
    draggedUuid: string,
    dragX: number,
    dragY: number,
    dragDisplay: DisplayPositionMap,
  ): void {
    if (attachDrag) return;
    dockHoverFrame++;
    const delta = Math.hypot(dragX - lastDockDragX, dragY - lastDockDragY);
    if (
      dockHoverFrame % DOCK_HOVER_INTERVAL !== 0 &&
      delta < DOCK_HOVER_MIN_DELTA_C15
    ) {
      return;
    }
    lastDockDragX = dragX;
    lastDockDragY = dragY;

    const dragged = $banks.find((b) => b.uuid === draggedUuid);
    if (!dragged) {
      dockHover = null;
      return;
    }

    const dock = timeDock(() =>
      findDockTargetForDraggedBank(
        $banks,
        { ...dragged, x: dragX, y: dragY },
        dragDisplay,
        {
          candidateUuids: visibleCanvasBankUuids,
          excludeClusterUuids: dragClusterUuids ?? undefined,
        },
      ),
    );

    if (!dock) {
      if (dockHover !== null) dockHover = null;
      return;
    }

    const next = {
      targetUuid: dock.target.uuid,
      draggedUuid,
      dockEdge: dock.dockEdge,
      highlightEdge: dock.highlightEdge,
      draggedHighlightEdge: dock.draggedHighlightEdge,
    };
    if (
      dockHover?.targetUuid === next.targetUuid &&
      dockHover.dockEdge === next.dockEdge &&
      dockHover.draggedUuid === next.draggedUuid
    ) {
      return;
    }
    dockHover = next;
  }

  function handleBankDragEnd(uuid: string): void {
    if (!bankDragGrab || bankDragGrab.uuid !== uuid) return;

    const final = activeDragStored;
    const clusterExclude = dragClusterUuids;
    const moveUuids = dragClusterUuids ? [...dragClusterUuids] : undefined;

    bankDragActive = false;
    bankDragGrab = null;
    dragBaseDisplay = null;
    dragDisplayMap = null;
    dragClusterUuids = null;
    slotVisibilityDraggedUuid = null;
    dockHoverFrame = 0;
    if (!presetDrag?.active) stopEdgeScrollLoop();

    try {
      if (final && final.uuid === uuid) {
        timeStore(() =>
          moveBankTo(uuid, final.x, final.y, {
            userDrag: false,
            moveUuids,
          }),
        );
      }

      if (borderSnapHover && final) {
        const snappedBank = get(banks).find((b) => b.uuid === uuid);
        log('border', 'snap commit', {
          edge: borderSnapHover,
          role: borderSnapRole,
          bankUuid: uuid,
          x: final.x,
          y: final.y,
          bankName: snappedBank?.name ?? null,
        });
      }

      activeDragStored = null;
      dockHover = null;
      borderSnapHover = null;
      borderSnapRole = null;
      endBankDragPerfSession();
      refreshCanvasVisibility(true);

      const dragged = get(banks).find((b) => b.uuid === uuid);
      if (!dragged) return;

      const committedDisplay = timeLayout(() => resolveDisplayPositions(get(banks)));
      const dock = timeDock(() =>
        findDockTargetForDraggedBank(get(banks), dragged, committedDisplay, {
          excludeClusterUuids: clusterExclude ?? undefined,
        }),
      );
      if (!dock) return;

      if (clusterExclude?.has(dock.target.uuid)) return;

      if (dockBankAtEdge(uuid, dock.target.uuid, dock.dockEdge)) {
        log('attach', 'proximity dock', {
          count: 1,
          edge: dock.dockEdge,
          target: dock.target.name,
        });
      }
    } finally {
      // One history entry for detach + move + dock (if any).
      endUndoGroup();
    }
  }

  /** C15 snap grid (15 units) in screen pixels — matches PresetManager.getSnapGridResolution(). */
  const gridSize = $derived(BANK_LAYOUT.snapGrid * C15_SCALE * viewport.zoom);
  const gridOffsetX = $derived(
    ((viewport.panX % gridSize) + gridSize) % gridSize,
  );
  const gridOffsetY = $derived(
    ((viewport.panY % gridSize) + gridSize) % gridSize,
  );

  const attachDragVisual = $derived.by(() => {
    if (!attachDrag) return null;
    const list = $banks;
    const source = list.find((b) => b.uuid === attachDrag!.sourceUuid);
    if (!source || !canvasEl) return null;

    const rect = canvasEl.getBoundingClientRect();
    const c15 = clientToC15(attachPointer.clientX, attachPointer.clientY, rect, viewport);
    const sourceDisplay = getDisplayPosition(source, displayByUuid);
    const from = attachHandleAnchorC15(
      source,
      attachDrag.direction,
      sourceDisplay.x,
      sourceDisplay.y,
    );
    const hover = attachHoverUuid
      ? list.find((b) => b.uuid === attachHoverUuid)
      : undefined;
    const hoverValid = Boolean(hover && (() => {
      const resolved = resolveAttachFromHandle(
        attachDrag!.direction,
        attachDrag!.sourceUuid,
        hover!.uuid,
      );
      return canAttachBank(
        resolved.childUuid,
        resolved.parentUuid,
        resolved.attachDirection,
        list,
      ).ok;
    })());

    return { from, to: c15, direction: attachDrag.direction, hoverValid };
  });
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
  bind:this={canvasEl}
  class="relative min-w-0 flex-1 overflow-hidden bg-c15-bg
    {isPanning ? 'cursor-grabbing' : 'cursor-default'}"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={handleCanvasContextMenu}
>
  <div
    data-canvas-background="true"
    class="absolute inset-0 opacity-25"
    style:background-image="radial-gradient(circle, #3a3a3a 1px, transparent 1px)"
    style:background-size="{gridSize}px {gridSize}px"
    style:background-position="{gridOffsetX}px {gridOffsetY}px"
  ></div>

  {#if $bankMeta.loading}
    <div class="absolute inset-0 z-20 flex items-center justify-center bg-c15-bg/80">
      <div class="app-ui text-center">
        <div
          class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-c15-border border-t-c15-accent"
        ></div>
        <p class="text-sm text-c15-text">Importing banks…</p>
        <p class="mt-1 text-xs text-c15-text-muted">Large files may take a few seconds</p>
      </div>
    </div>
  {/if}

  {#if marqueeScreenRect}
    <div
      class="pointer-events-none absolute z-[25] border border-c15-accent/80 bg-c15-accent/10"
      style:left="{marqueeScreenRect.left}px"
      style:top="{marqueeScreenRect.top}px"
      style:width="{marqueeScreenRect.width}px"
      style:height="{marqueeScreenRect.height}px"
    ></div>
  {/if}

  {#if $banks.length === 0 && !$appSettings.showSynthZone && !$appSettings.showDebugShapes}
    <div class="app-ui pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <p class="text-sm text-c15-text-muted">Import a .nlbackup file to get started</p>
    </div>
  {/if}

  {#if $banks.length > 0 || $appSettings.showSynthZone || $appSettings.showDebugShapes}
    <div
      class="absolute left-0 top-0 z-[1] origin-top-left"
      style:transform="translate({viewport.panX}px, {viewport.panY}px) scale({viewport.zoom})"
    >
      {#if $appSettings.showSynthZone}
        <SynthZoneOverlay activeEdge={borderSnapHover} />
      {/if}
      {#if $appSettings.showDebugShapes}
        <CalibrationGuides />
        <WidthCalibRulers viewport={viewport} canvasEl={canvasEl ?? null} />
        <BankGeometryDebugOverlay banks={$banks} {displayByUuid} />
      {/if}

      {#if $banks.length > 0}
      <ConnectionLines
        banks={$banks}
        selectedBankUuids={$bankMeta.selectedBankUuids}
        displayByUuid={displayByUuid}
        visibleBankUuids={
          visibleCanvasBankUuids.size > 0 ? visibleCanvasBankUuids : undefined
        }
      />

      {#if attachDragVisual}
        <AttachDragOverlay
          fromX={attachDragVisual.from.x}
          fromY={attachDragVisual.from.y}
          toX={attachDragVisual.to.x}
          toY={attachDragVisual.to.y}
          direction={attachDragVisual.direction}
          hoverValid={attachDragVisual.hoverValid}
        />
      {/if}

      {#each visibleBanksForRender as { bank, index, variant } (bank.uuid)}
        {@const display = displayByUuid.get(bank.uuid) ?? { x: bank.x, y: bank.y }}
        {@const dockEdge =
          dockHover?.targetUuid === bank.uuid
            ? dockHover.highlightEdge
            : dockHover?.draggedUuid === bank.uuid
              ? dockHover.draggedHighlightEdge
              : null}
        {#if variant === 'lite'}
          <BankCardLite
            {bank}
            displayX={display.x}
            displayY={display.y}
            {index}
            selected={$bankMeta.selectedBankUuids.includes(bank.uuid)}
            userPositioned={$userPositionedUuids.has(bank.uuid)}
            suppressNameTooltip={presetDrag?.active === true}
            dragDisabled={attachDrag !== null}
            attachDropTarget={attachHoverUuid === bank.uuid}
            dockEdgeHighlight={dockEdge}
            onselect={handleBankSelect}
            onclickselect={handleBankClickSelect}
            ondraggrab={(info) => handleBankDragGrab(bank.uuid, info)}
            ondragend={() => handleBankDragEnd(bank.uuid)}
          />
        {:else}
          <BankCard
            {bank}
            displayX={display.x}
            displayY={display.y}
            {index}
            selected={$bankMeta.selectedBankUuids.includes(bank.uuid)}
            userPositioned={$userPositionedUuids.has(bank.uuid)}
            viewportZoom={viewport.zoom}
            dragDisabled={attachDrag !== null}
            attachDropTarget={attachHoverUuid === bank.uuid}
            showAttachSlots={bankDragActive && visibleCanvasBankUuids.has(bank.uuid)}
            dockEdgeHighlight={dockEdge}
            presetDropHighlight={
              presetDrag?.active === true &&
              presetDropTarget?.bankUuid === bank.uuid
            }
            presetInsertIndex={
              presetDropTarget?.bankUuid === bank.uuid
                ? presetDropTarget.insertIndex
                : null
            }
            onpresetpointerdown={handlePresetPointerDown}
            onpresetcontextmenu={handlePresetContextMenu}
            onselect={handleBankSelect}
            onclickselect={handleBankClickSelect}
            onmove={handleBankMove}
            ondraggrab={(info) => handleBankDragGrab(bank.uuid, info)}
            ondragend={() => handleBankDragEnd(bank.uuid)}
          />
        {/if}
      {/each}
      {/if}
    </div>
  {/if}

  {#if presetContextMenu}
    <PresetContextMenu
      clientX={presetContextMenu.clientX}
      clientY={presetContextMenu.clientY}
      bankUuid={presetContextMenu.bankUuid}
      presetUuids={presetContextMenu.presetUuids}
      onduplicate={() => {
        duplicateSelectedPresets();
        log('preset', 'context menu duplicate', { count: presetContextMenu!.presetUuids.length });
      }}
      ondelete={() => {
        deleteSelectedPresets();
        log('preset', 'context menu delete', { count: presetContextMenu!.presetUuids.length });
      }}
      onclose={closePresetContextMenu}
    />
  {/if}

  {#if canvasContextMenu}
    <CanvasContextMenu
      clientX={canvasContextMenu.clientX}
      clientY={canvasContextMenu.clientY}
      oncreatebank={handleCreateBankFromContextMenu}
      onclose={closeCanvasContextMenu}
    />
  {/if}

  {#if edgeScrollIntensities.left > 0 || edgeScrollIntensities.right > 0 || edgeScrollIntensities.top > 0 || edgeScrollIntensities.bottom > 0}
    <div class="pointer-events-none absolute inset-0 z-[35]" aria-hidden="true">
      {#if edgeScrollIntensities.left > 0}
        <div
          class="absolute bottom-0 left-0 top-0 bg-c15-accent/25"
          style:width="{EDGE_SCROLL.zoneDepthPx}px"
          style:opacity="{edgeScrollIntensities.left}"
        ></div>
      {/if}
      {#if edgeScrollIntensities.right > 0}
        <div
          class="absolute bottom-0 right-0 top-0 bg-c15-accent/25"
          style:width="{EDGE_SCROLL.zoneDepthPx}px"
          style:opacity="{edgeScrollIntensities.right}"
        ></div>
      {/if}
      {#if edgeScrollIntensities.top > 0}
        <div
          class="absolute left-0 right-0 top-0 bg-c15-accent/25"
          style:height="{EDGE_SCROLL.zoneDepthPx}px"
          style:opacity="{edgeScrollIntensities.top}"
        ></div>
      {/if}
      {#if edgeScrollIntensities.bottom > 0}
        <div
          class="absolute bottom-0 left-0 right-0 bg-c15-accent/25"
          style:height="{EDGE_SCROLL.zoneDepthPx}px"
          style:opacity="{edgeScrollIntensities.bottom}"
        ></div>
      {/if}
    </div>
  {/if}

  {#if presetDragVisual}
    <PresetDragOverlay
      clientX={presetDragVisual.clientX}
      clientY={presetDragVisual.clientY}
      label={presetDragVisual.label}
      count={presetDragVisual.count}
      moveMode={presetDragVisual.moveMode}
    />
  {/if}

  {#if presetDragBankHint}
    <PresetDragBankHint
      clientX={presetDragBankHint.clientX}
      clientY={presetDragBankHint.clientY}
      bankLabel={presetDragBankHint.bankLabel}
    />
  {/if}

  <div
    class="app-ui pointer-events-none absolute bottom-3 right-3 z-10 rounded bg-c15-surface/90 px-2 py-1 font-mono text-[10px] text-c15-text-muted"
  >
    {$banks.length} banks · {Math.round(viewport.zoom * 100)}% ·
    Pan — LMB drag or middle mouse · Ctrl+drag marquee
  </div>
</main>