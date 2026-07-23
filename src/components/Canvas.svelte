<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { planBankDrag } from '../lib/model/bankDragPlan';
  import {
    resolvePresetContextMenuSelection,
    resolvePresetDropAction,
  } from '../lib/canvas/presetDragSession';
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
  import {
    selTrace,
    selTraceMarqueeHover,
    selTracePointer,
    selTraceResetMarqueeHoverThrottle,
    selTraceSelection,
  } from '../lib/debug/selectionTrace';
  import { recordBankRenderSnapshot } from '../lib/debug/renderPerfLog';
  import { shouldIgnoreKeyboardShortcut } from '../lib/keyboard';
  import {
    applyBankDragPointerPosition,
    resolveBankDragEndDock,
  } from '../lib/canvas/bankDragSession';
  import { POINTER_GESTURE_THRESHOLD_PX } from '../lib/canvas/bankCardChrome';
  import {
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
  import { findDockTargetForDragCluster } from '../lib/canvas/dockHitTest';
  import type { SynthBorderEdge } from '../lib/canvas/borderSnapHitTest';
  import {
    computeEdgeScrollDelta,
    EDGE_SCROLL,
  } from '../lib/canvas/edgeAutoScroll';
  import { visibleBankUuidsInCanvas } from '../lib/canvas/viewportVisibility';
  import type { DockEdge } from '../lib/model/attachOperation';
  import {
    appSettings,
    bankMeta,
    banks,
    beginUndoGroup,
    cancelRenameBank,
    createBank,
    detachBanksCrossingMoveSet,
    dockBankAtEdge,
    endUndoGroup,
    expandOpenUndoGroupUuids,
    exportAllAsBackup,
    exportSelectedBanks,
    exportSelectedBanksAsXml,
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
  import {
    BANK_LAYOUT,
    bankOuterWidth,
    C15_SCALE,
    emptyBankOuterHeight,
  } from '../lib/canvas/geometry';
  import { snapToGrid } from '../lib/model/bankFactory';
  import { BANK_LOD_FULL_ZOOM, bankCardVariant } from '../lib/canvas/lod';
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

  let canvasEl = $state<HTMLElement | undefined>(undefined);
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);

  let isPanning = $state(false);
  /** True when pan started via LMB on canvas background (not middle mouse). */
  let panFromBackgroundLmb = false;
  let panStartClient = { x: 0, y: 0 };
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
  /**
   * Window-owned bank gesture with capture on the **stable canvas root**
   * (`canvasEl` / `<main>`), never on bank cards.
   *
   * Cards re-render hard at grab (dragging class, attach slots, visibility).
   * Capture on the card (or no capture at all) → UA `pointercancel` ~ms later
   * and the pointer stream ends. Canvas root stays mounted across that thrash.
   */
  let bankGesture = $state<{
    phase: 'pending' | 'dragging';
    uuid: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    /** performance.now() at gesture start — cancel latency diagnostics */
    startedAt: number;
    /** performance.now() when threshold crossed / grab began */
    grabbedAt: number | null;
  } | null>(null);
  let bankDragGrab = $state<{
    uuid: string;
    offsetC15X: number;
    offsetC15Y: number;
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

  const MARQUEE_THRESHOLD_PX = POINTER_GESTURE_THRESHOLD_PX;
  let marqueePointerId: number | null = null;
  let marqueeStartClient = { x: 0, y: 0 };
  let marqueeCurrentClient = $state({ x: 0, y: 0 });
  let marqueeActive = $state(false);
  /** Swallow the residual click some browsers fire under the cursor after marquee capture ends. */
  let suppressClickAfterMarquee = false;
  let suppressClickAfterMarqueeTimer: ReturnType<typeof setTimeout> | null = null;

  const PRESET_DRAG_THRESHOLD_PX = POINTER_GESTURE_THRESHOLD_PX;

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

  function releaseBankGestureCapture(pointerId: number): void {
    if (!canvasEl) return;
    try {
      if (canvasEl.hasPointerCapture(pointerId)) {
        canvasEl.releasePointerCapture(pointerId);
        selTrace('bank.capture-release', { pointerId, ok: true });
      }
    } catch (err) {
      selTrace('bank.capture-release', {
        pointerId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Own the active pointer on the stable canvas root (survives card re-renders). */
  function captureBankGesturePointer(pointerId: number): boolean {
    if (!canvasEl) {
      selTrace('bank.capture-fail', { pointerId, reason: 'no-canvas' });
      return false;
    }
    try {
      canvasEl.setPointerCapture(pointerId);
      const has = canvasEl.hasPointerCapture(pointerId);
      selTrace('bank.capture-set', {
        pointerId,
        hasCapture: has,
        canvasConnected: canvasEl.isConnected,
      });
      return has;
    } catch (err) {
      selTrace('bank.capture-fail', {
        pointerId,
        reason: 'exception',
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
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

    if (!bankGesture || event.pointerId !== bankGesture.pointerId) return;

    if (bankGesture.phase === 'pending') {
      const dx = event.clientX - bankGesture.startClientX;
      const dy = event.clientY - bankGesture.startClientY;
      if (Math.hypot(dx, dy) < POINTER_GESTURE_THRESHOLD_PX) return;

      const g = bankGesture;
      const grabbedAt = performance.now();
      bankGesture = { ...g, phase: 'dragging', grabbedAt };
      selTrace('bank.gesture-threshold', {
        primary: g.uuid.slice(0, 8),
        pointerId: g.pointerId,
        dx: Math.round(dx),
        dy: Math.round(dy),
        msSinceStart: Math.round(grabbedAt - g.startedAt),
        canvasHasCapture: canvasEl?.hasPointerCapture(g.pointerId) ?? false,
      });
      handleBankDragGrab(g.uuid, {
        clientX: event.clientX,
        clientY: event.clientY,
        originX: g.originX,
        originY: g.originY,
        pointerId: g.pointerId,
      });
      return;
    }

    if (bankDragGrab && event.pointerId === bankDragGrab.pointerId) {
      applyBankDragPointer(event.clientX, event.clientY);
    }
  }

  function finishBankGestureFromWindow(event: PointerEvent, reason: string): void {
    if (!bankGesture || event.pointerId !== bankGesture.pointerId) return;

    const g = bankGesture;
    const now = performance.now();
    selTracePointer(
      reason === 'pointercancel' ? 'bank.gesture-cancel' : 'bank.gesture-up',
      event,
      {
        phase: g.phase,
        primary: g.uuid.slice(0, 8),
        hadGrab: Boolean(bankDragGrab),
        msSinceStart: Math.round(now - g.startedAt),
        msSinceGrab:
          g.grabbedAt != null ? Math.round(now - g.grabbedAt) : null,
        activeDragStored: activeDragStored
          ? { x: activeDragStored.x, y: activeDragStored.y }
          : null,
      },
      { captureEl: canvasEl },
    );

    if (g.phase === 'dragging' && bankDragGrab?.uuid === g.uuid) {
      // Commit current position even if the UA cancelled mid-drag.
      handleBankDragEnd(g.uuid);
    } else if (g.phase === 'pending' && reason === 'pointerup') {
      // Click without drag — bank selection (toggle if Ctrl held during up).
      handleBankClickSelect(g.uuid, event as unknown as MouseEvent);
    }

    releaseBankGestureCapture(g.pointerId);
    bankGesture = null;
  }

  function onWindowPointerUp(event: PointerEvent): void {
    finishBankGestureFromWindow(event, 'pointerup');
  }

  function onWindowPointerCancel(event: PointerEvent): void {
    // End cleanly — after pointercancel the UA sends no further events for this id.
    // Preventing cancel is the real fix (canvas capture); this path is the safety net.
    finishBankGestureFromWindow(event, 'pointercancel');
  }

  function onCanvasLostPointerCapture(event: PointerEvent): void {
    // Diagnostic: capture on canvas should not drop during an active bank drag.
    if (!bankGesture || event.pointerId !== bankGesture.pointerId) return;
    selTracePointer(
      'bank.lostpointercapture',
      event,
      {
        phase: bankGesture.phase,
        primary: bankGesture.uuid.slice(0, 8),
        hadGrab: Boolean(bankDragGrab),
        msSinceStart: Math.round(performance.now() - bankGesture.startedAt),
      },
      { captureEl: canvasEl },
    );
  }

  onMount(() => {
    log('canvas', 'mounted');
    if (!canvasEl) return;

    registerCanvasElement(canvasEl);
    refreshCanvasClientRect();
    window.addEventListener('pointermove', onWindowPointerMove, { capture: true });
    window.addEventListener('pointerup', onWindowPointerUp, { capture: true });
    window.addEventListener('pointercancel', onWindowPointerCancel, { capture: true });
    window.addEventListener('click', onWindowClickAfterMarquee, { capture: true });
    window.addEventListener('resize', refreshCanvasClientRect);
    canvasEl.addEventListener('lostpointercapture', onCanvasLostPointerCapture);

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
      window.removeEventListener('pointercancel', onWindowPointerCancel, { capture: true });
      window.removeEventListener('click', onWindowClickAfterMarquee, { capture: true });
      window.removeEventListener('resize', refreshCanvasClientRect);
      canvasEl?.removeEventListener('lostpointercapture', onCanvasLostPointerCapture);
      if (suppressClickAfterMarqueeTimer !== null) {
        clearTimeout(suppressClickAfterMarqueeTimer);
        suppressClickAfterMarqueeTimer = null;
      }
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

  function handleExportAllFromContextMenu(): void {
    if (exportAllAsBackup()) {
      log('canvas', 'export all from context menu');
    }
  }

  function handleExportSelectedFromContextMenu(): void {
    const count = $bankMeta.selectedBankUuids.length;
    if (exportSelectedBanks()) {
      log('canvas', 'export selected backup from context menu', { count });
    }
  }

  async function handleExportSelectedXmlFromContextMenu(): Promise<void> {
    const count = $bankMeta.selectedBankUuids.length;
    const ok = await Promise.resolve(exportSelectedBanksAsXml());
    if (ok) {
      log('canvas', 'export selected XML from context menu', { count });
    }
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
        selTraceResetMarqueeHoverThrottle();
        selTracePointer('marquee.pointerdown', event, {
          onBackground: true,
          zoom: viewport.zoom,
          bankDragActive,
          presetDragActive: presetDrag?.active ?? false,
        });
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

    const didMarquee = marqueeActive;
    selTracePointer('marquee.pointerup', event, {
      didMarquee,
      marqueeActiveBefore: marqueeActive,
      zoom: viewport.zoom,
    });

    if (didMarquee && canvasEl) {
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
      selTrace('marquee.hits', {
        hitCount: hits.length,
        hits: hits.map((u) => u.slice(0, 8)),
        c15Rect: {
          x: Math.round(c15Rect.x),
          y: Math.round(c15Rect.y),
          w: Math.round(c15Rect.width),
          h: Math.round(c15Rect.height),
        },
      });
      if (hits.length > 0) {
        selectBanks(hits, 'replace');
      } else {
        selectBank(null);
      }
      selTraceSelection('marquee.after-select', {
        hitCount: hits.length,
      });
      // Residual click after releasePointerCapture can hit a preset under the cursor.
      armMarqueeClickSuppress();
      event.preventDefault();
    } else {
      // Ctrl+click on background without drag — clear selection.
      selectBank(null);
      selTraceSelection('marquee.ctrl-click-clear');
    }

    marqueePointerId = null;
    marqueeActive = false;
    try {
      canvasEl?.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released by the UA after pointerup.
    }
    selTraceSelection('marquee.finished', { didMarquee });
  }

  function armMarqueeClickSuppress(): void {
    suppressClickAfterMarquee = true;
    selTrace('marquee.click-suppress-arm', { ms: 100 });
    if (suppressClickAfterMarqueeTimer !== null) {
      clearTimeout(suppressClickAfterMarqueeTimer);
    }
    // Residual click is dispatched right after pointerup; expire so the next real click works.
    suppressClickAfterMarqueeTimer = setTimeout(() => {
      suppressClickAfterMarquee = false;
      suppressClickAfterMarqueeTimer = null;
      selTrace('marquee.click-suppress-expire');
    }, 100);
  }

  function onWindowClickAfterMarquee(event: MouseEvent): void {
    if (!suppressClickAfterMarquee) return;
    suppressClickAfterMarquee = false;
    if (suppressClickAfterMarqueeTimer !== null) {
      clearTimeout(suppressClickAfterMarqueeTimer);
      suppressClickAfterMarqueeTimer = null;
    }
    selTracePointer(
      'marquee.residual-click-swallowed',
      {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: -1,
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        type: 'click',
        target: event.target,
      },
    );
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event: PointerEvent): void {
    if (marqueePointerId !== null && event.pointerId === marqueePointerId) {
      marqueeCurrentClient = { x: event.clientX, y: event.clientY };
      if (!marqueeActive) {
        const dx = event.clientX - marqueeStartClient.x;
        const dy = event.clientY - marqueeStartClient.y;
        if (Math.hypot(dx, dy) >= MARQUEE_THRESHOLD_PX) {
          marqueeActive = true;
          selTracePointer('marquee.activated', event, {
            thresholdPx: MARQUEE_THRESHOLD_PX,
          });
        }
      }
      if (marqueeActive) {
        selTraceMarqueeHover(event.clientX, event.clientY, {
          zoom: viewport.zoom,
        });
      }
      return;
    }
    if (!isPanning) return;
    panBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
    lastPointer = { x: event.clientX, y: event.clientY };
    refreshCanvasVisibility();
  }

  function onPointerUp(event: PointerEvent): void {
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
      if (marqueePointerId !== null) {
        const pid = marqueePointerId;
        selTrace('marquee.cancel-escape', { pointerId: pid });
        marqueePointerId = null;
        marqueeActive = false;
        try {
          canvasEl?.releasePointerCapture(pid);
        } catch {
          /* capture may already be gone */
        }
        return;
      }
      if (bankGesture || bankDragGrab) {
        const escapePid = bankGesture?.pointerId ?? bankDragGrab?.pointerId;
        selTrace('bank.gesture-escape', {
          phase: bankGesture?.phase ?? null,
          primary: (bankGesture?.uuid ?? bankDragGrab?.uuid)?.slice(0, 8) ?? null,
          pointerId: escapePid ?? null,
        });
        if (bankDragGrab) {
          // Escape aborts without committing — clear session; undo group ends empty.
          const uuid = bankDragGrab.uuid;
          bankDragActive = false;
          bankDragGrab = null;
          bankGesture = null;
          dragBaseDisplay = null;
          dragDisplayMap = null;
          dragClusterUuids = null;
          activeDragStored = null;
          dockHover = null;
          borderSnapHover = null;
          borderSnapRole = null;
          slotVisibilityDraggedUuid = null;
          stopEdgeScrollLoop();
          endUndoGroup();
          refreshCanvasVisibility(true);
          selTrace('bank.gesture-escape-aborted', { primary: uuid.slice(0, 8) });
        } else {
          bankGesture = null;
        }
        if (escapePid != null) releaseBankGestureCapture(escapePid);
        return;
      }
      if ($bankMeta.renamingBankUuid) {
        cancelRenameBank();
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
        const action = resolvePresetDropAction(
          drag.sourceBankUuid,
          target.bankUuid,
          event.ctrlKey || event.metaKey,
        );
        const ok =
          action === 'reorder'
            ? reorderPresetsInBankStore(
                drag.presetUuids,
                target.bankUuid,
                target.insertIndex,
              )
            : action === 'move'
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
          action,
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
      selTraceSelection('preset.click-select-via-drag-up', {
        bankUuid: drag.sourceBankUuid.slice(0, 8),
        presetUuid: drag.clickedUuid.slice(0, 8),
        ctrl: drag.ctrl,
        shift: drag.shift,
      });
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
    const resolved = resolvePresetContextMenuSelection(
      bankUuid,
      presetUuid,
      get(bankMeta),
    );
    if (resolved.shouldSelectClicked) {
      selectPreset(bankUuid, presetUuid);
    }
    return resolved.presetUuids;
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
    if (event.button !== 0) return;

    selTracePointer('preset.pointerdown', event, {
      bankUuid: bankUuid.slice(0, 8),
      clickedUuid: clickedUuid.slice(0, 8),
      presetCount: presetUuids.length,
      bankDragActive,
      multiBankSelected: get(bankMeta).selectedBankUuids.length >= 2,
      bankInSelection: get(bankMeta).selectedBankUuids.includes(bankUuid),
    });

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

  /**
   * Bank selection only on click-up (no drag) or at drag grab.
   * Pointer-down does not change selection so multi-select press-drag works.
   */
  function handleBankClickSelect(uuid: string, event: MouseEvent): void {
    selTracePointer(
      'bank.click-select',
      {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: -1,
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        type: 'click-select',
        target: event.target,
      },
      {
        bankUuid: uuid.slice(0, 8),
        mode: event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
      },
    );
    if (event.ctrlKey || event.metaKey) {
      selectBank(uuid, 'toggle');
      return;
    }
    selectBank(uuid, 'replace');
  }

  function applyBankDragPointer(clientX: number, clientY: number): void {
    if (!bankDragGrab || !canvasEl) return;
    timeApply(() => {
      const rect = canvasRectLike();
      const c15 = clientToC15(clientX, clientY, rect, viewport);
      const rawX = c15.x - bankDragGrab!.offsetC15X;
      const rawY = c15.y - bankDragGrab!.offsetC15Y;

      const dragged = $banks.find((b) => b.uuid === bankDragGrab!.uuid);
      if (!dragged) return;

      const applied = applyBankDragPointerPosition(dragged, rawX, rawY, {
        showSynthZone: get(appSettings).showSynthZone,
      });

      borderSnapHover = applied.borderSnapEdge;
      borderSnapRole = applied.borderSnapRole;
      if (applied.borderSnapEdge) {
        dockHover = null;
      }

      const nextDisplay = computeDragDisplayMap(
        bankDragGrab!.uuid,
        applied.dragX,
        applied.dragY,
      );
      dragDisplayMap = nextDisplay;
      activeDragStored = {
        uuid: bankDragGrab!.uuid,
        x: applied.dragX,
        y: applied.dragY,
      };
      if (!applied.borderSnapEdge) {
        updateDockHover(
          bankDragGrab!.uuid,
          applied.dragX,
          applied.dragY,
          nextDisplay,
        );
      }
    });
  }

  /**
   * Pointer-down on a bank drag surface (header, or multi-select body).
   * Capture goes to the stable canvas root; move/up/cancel tracked on window.
   */
  function handleBankGestureStart(
    uuid: string,
    info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      pointerId: number;
    },
  ): void {
    // Replace any stale gesture (should not happen).
    if (bankGesture || bankDragGrab) {
      const prevPid = bankGesture?.pointerId ?? bankDragGrab?.pointerId;
      selTrace('bank.gesture-replace', {
        prev: bankGesture?.uuid.slice(0, 8) ?? bankDragGrab?.uuid.slice(0, 8) ?? null,
        next: uuid.slice(0, 8),
        prevPointerId: prevPid ?? null,
      });
      if (bankDragGrab) {
        handleBankDragEnd(bankDragGrab.uuid);
      }
      if (prevPid != null) releaseBankGestureCapture(prevPid);
      bankGesture = null;
    }

    // Critical: own the pointer on <main> before grab re-renders bank cards.
    // Must run synchronously in the pointerdown turn while the pointer is active.
    const captured = captureBankGesturePointer(info.pointerId);

    bankGesture = {
      phase: 'pending',
      uuid,
      pointerId: info.pointerId,
      startClientX: info.clientX,
      startClientY: info.clientY,
      originX: info.originX,
      originY: info.originY,
      startedAt: performance.now(),
      grabbedAt: null,
    };
    selTraceSelection('bank.gesture-start', {
      primary: uuid.slice(0, 8),
      pointerId: info.pointerId,
      origin: { x: info.originX, y: info.originY },
      client: { x: info.clientX, y: info.clientY },
      zoom: viewport.zoom,
      canvasCaptured: captured,
      canvasHasCapture: canvasEl?.hasPointerCapture(info.pointerId) ?? false,
    });
  }

  function handleBankDragGrab(
    uuid: string,
    info: {
      clientX: number;
      clientY: number;
      originX: number;
      originY: number;
      pointerId: number;
    },
  ): void {
    if (!canvasEl) {
      selTrace('bank.drag-grab-aborted', { reason: 'no-canvas', bank: uuid.slice(0, 8) });
      return;
    }

    const list = get(banks);
    const selection = get(bankMeta).selectedBankUuids;
    const plan = planBankDrag(uuid, list, selection);

    selTraceSelection('bank.drag-grab', {
      primary: uuid.slice(0, 8),
      pointerId: info.pointerId,
      origin: { x: info.originX, y: info.originY },
      client: { x: info.clientX, y: info.clientY },
      selectionAtGrab: selection.map((u) => u.slice(0, 8)),
      plan: {
        selectPrimaryOnly: plan.selectPrimaryOnly,
        moveSet: [...plan.moveSet].map((u) => u.slice(0, 8)),
        detachUuids: plan.detachUuids.map((u) => u.slice(0, 8)),
        undoUuids: plan.undoUuids.map((u) => u.slice(0, 8)),
      },
      zoom: viewport.zoom,
      bankDragActiveBefore: bankDragActive,
      presetDragActive: presetDrag?.active ?? false,
      canvasHasCapture: canvasEl?.hasPointerCapture(info.pointerId) ?? false,
      canvasConnected: canvasEl?.isConnected ?? false,
      msSinceStart: bankGesture
        ? Math.round(performance.now() - bankGesture.startedAt)
        : null,
    });

    // Primary outside multi-selection → sole selection (cluster drag chrome).
    if (plan.selectPrimaryOnly) {
      selectBank(uuid, 'replace');
    }

    // Undo tracks movers + boundary orphans so multi-select partial trees restore.
    beginUndoGroup('Move bank', plan.undoUuids);

    const rect = canvasRectLike();
    const c15 = clientToC15(info.clientX, info.clientY, rect, viewport);
    bankDragGrab = {
      uuid,
      offsetC15X: c15.x - info.originX,
      offsetC15Y: c15.y - info.originY,
      pointerId: info.pointerId,
    };
    bankDragActive = true;

    // May re-render cards; safe because we do not rely on card pointer capture.
    timeStore(() => {
      detachBanksCrossingMoveSet(plan.moveSet);
    });

    const listAfter = get(banks);
    dragClusterUuids = plan.moveSet;
    dragBaseDisplay = timeLayout(() => resolveDisplayPositions(listAfter));
    startBankDragPerfSession(listAfter, plan.moveSet.size, viewport.zoom);

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

    const cluster =
      dragClusterUuids && dragClusterUuids.size > 0
        ? dragClusterUuids
        : new Set([draggedUuid]);

    // Ensure the pointer primary's live override is in the display map used for corridors.
    const dragged = $banks.find((b) => b.uuid === draggedUuid);
    if (!dragged) {
      dockHover = null;
      return;
    }
    if (!dragDisplay.has(draggedUuid)) {
      dragDisplay = new Map(dragDisplay).set(draggedUuid, { x: dragX, y: dragY });
    }

    const dock = timeDock(() =>
      findDockTargetForDragCluster($banks, cluster, dragDisplay, {
        candidateUuids: visibleCanvasBankUuids,
        excludeClusterUuids: cluster,
      }),
    );

    if (!dock) {
      if (dockHover !== null) dockHover = null;
      return;
    }

    const next = {
      targetUuid: dock.target.uuid,
      /** Highlight the cluster member that would attach (child may dock, not only primary). */
      draggedUuid: dock.memberUuid,
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
    if (!bankDragGrab || bankDragGrab.uuid !== uuid) {
      selTrace('bank.drag-end-ignored', {
        reason: !bankDragGrab ? 'no-grab' : 'uuid-mismatch',
        uuid: uuid.slice(0, 8),
        grabUuid: bankDragGrab?.uuid.slice(0, 8) ?? null,
      });
      return;
    }

    selTraceSelection('bank.drag-end', {
      primary: uuid.slice(0, 8),
      final: activeDragStored
        ? { x: activeDragStored.x, y: activeDragStored.y }
        : null,
      moveSet: dragClusterUuids
        ? [...dragClusterUuids].map((u) => u.slice(0, 8))
        : null,
    });

    const final = activeDragStored;
    const clusterExclude = dragClusterUuids;
    const moveUuids = dragClusterUuids ? [...dragClusterUuids] : undefined;

    bankDragActive = false;
    bankDragGrab = null;
    if (bankGesture?.uuid === uuid) bankGesture = null;
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

      const list = get(banks);
      const cluster =
        clusterExclude && clusterExclude.size > 0
          ? clusterExclude
          : new Set([uuid]);

      const endDock = timeDock(() =>
        resolveBankDragEndDock(
          list,
          cluster,
          timeLayout(() => resolveDisplayPositions(list)),
        ),
      );
      if (!endDock) return;

      // Dock mutates member + target layout; include both in the open history group.
      expandOpenUndoGroupUuids([endDock.memberUuid, endDock.targetUuid]);

      if (
        dockBankAtEdge(
          endDock.memberUuid,
          endDock.targetUuid,
          endDock.dock.dockEdge,
        )
      ) {
        log('attach', 'proximity dock', {
          count: 1,
          edge: endDock.dock.dockEdge,
          member: endDock.memberUuid,
          primary: uuid,
          target: endDock.dock.target.name,
          memberIsPrimary: endDock.memberUuid === uuid,
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
            dockEdgeHighlight={dockEdge}
            dragging={bankDragGrab?.uuid === bank.uuid}
            onbankpointerdown={(info) =>
              handleBankGestureStart(bank.uuid, info)}
          />
        {:else}
          <BankCard
            {bank}
            displayX={display.x}
            displayY={display.y}
            {index}
            selected={$bankMeta.selectedBankUuids.includes(bank.uuid)}
            userPositioned={$userPositionedUuids.has(bank.uuid)}
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
            dragging={bankDragGrab?.uuid === bank.uuid}
            onpresetpointerdown={handlePresetPointerDown}
            onpresetcontextmenu={handlePresetContextMenu}
            onbankpointerdown={(info) => handleBankGestureStart(bank.uuid, info)}
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
      canExportAll={$banks.length > 0 && !$bankMeta.loading}
      selectedCount={$bankMeta.selectedBankUuids.length}
      oncreatebank={handleCreateBankFromContextMenu}
      onexportall={handleExportAllFromContextMenu}
      onexportselected={handleExportSelectedFromContextMenu}
      onexportselectedxml={handleExportSelectedXmlFromContextMenu}
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