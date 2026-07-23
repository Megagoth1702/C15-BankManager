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
  import {
    viewperfPanEnd,
    viewperfPanSample,
    viewperfPanStart,
    viewperfScheduleVisibility,
    viewperfStagedLite,
    viewperfVisibilityRefresh,
    viewperfZoom,
    VIEWPERF_TAG,
    type ViewperfVisibilitySource,
  } from '../lib/debug/viewportPerfLog';
  import { shouldIgnoreKeyboardShortcut } from '../lib/keyboard';
  import {
    applyBankDragPointerPosition,
    resolveBankDragEndDock,
  } from '../lib/canvas/bankDragSession';
  import { POINTER_GESTURE_THRESHOLD_PX } from '../lib/canvas/bankCardChrome';
  import {
    applyDragClusterDisplayPositions,
    resolveDisplayPositions,
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
  import {
    collectSpatialDockCandidateUuids,
    findDockTargetForDragCluster,
  } from '../lib/canvas/dockHitTest';
  import type { AttachCorridorCache } from '../lib/canvas/attachCorridors';
  import {
    computeEdgeScrollDelta,
    EDGE_SCROLL,
  } from '../lib/canvas/edgeAutoScroll';
  import {
    applyVisibilityWithEnterCap,
    CANVAS_VISIBILITY_MARGINS,
    MAX_VISIBILITY_ENTERS_PER_FRAME,
    pruneStagedLiteUuids,
    stickyVisibleBankUuidsInCanvas,
  } from '../lib/canvas/viewportVisibility';
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
  import {
    bankCardVariant,
    bankLodMode,
    setBankLodFullZoom,
  } from '../lib/canvas/lod';
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
  /** Live display map for the drag session (cloned once at grab; cluster keys only rewritten). */
  let dragDisplayMap = $state<DisplayPositionMap | null>(null);
  /** Bumps when cluster positions change so derived readers re-run without O(n) Map copy. */
  let dragDisplayEpoch = $state(0);
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
  /** Monotonic visibility pass counter (also keys staged-lite hold). */
  let visibilityFrame = 0;
  let lastVisibilityLogCount = -1;
  /**
   * Newly entered banks mount as lite for STAGED_LITE_HOLD_FRAMES so edge pan
   * does not pay full-card DOM cost on first paint. Map: uuid → staged clock.
   */
  let stagedLiteEnterFrame = new Map<string, number>();
  let stagedLiteUuids = $state<Set<string>>(new Set());
  let stagedLiteRafId: number | null = null;
  /** Dedicated clock for staged-lite hold (rAF ticks only — not pan culls). */
  let stagedLiteClock = 0;
  /** Coalesce pan/edge-scroll visibility to one cull per animation frame. */
  let visibilityRafId: number | null = null;
  let visibilityForcePending = false;
  let visibilitySourcePending: ViewperfVisibilitySource = 'schedule';
  /** Desired set with remaining enters to drain across frames. */
  let pendingDesiredVisible: Set<string> | null = null;
  let enterDrainRafId: number | null = null;
  /** Pan origin for delta-thaw escape hatch (half-canvas pan forces re-cull). */
  let panMembershipOrigin = { panX: 0, panY: 0 };
  /** Fraction of min(canvasW,H) pan distance before mid-pan membership thaw. */
  const PAN_DELTA_THAW_RATIO = 0.5;
  let dockHoverFrame = 0;
  let lastDockDragX = 0;
  let lastDockDragY = 0;
  /**
   * Coalesce high-rate pointermove samples to one bank-drag apply per frame.
   * Edge-scroll tick already runs at rAF and calls apply directly.
   */
  let pendingDragClient: { clientX: number; clientY: number } | null = null;
  let bankDragApplyRafId: number | null = null;
  /** Reuse attach corridors while display origins are stable during a bank drag. */
  let dockCorridorCache: AttachCorridorCache | null = null;
  /**
   * Attach corridor chrome on full cards — deferred one frame after grab so the
   * grab re-render (detach + selection + drag class) does not also mount corridor
   * divs in the same turn. Only cluster + dock-hover banks show corridors (not
   * every visible full card).
   */
  let showAttachSlotsChrome = $state(false);
  let showAttachSlotsRafId: number | null = null;
  /** Frames a newly entered bank stays lite before full promotion. */
  const STAGED_LITE_HOLD_FRAMES = 2;
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
    /** Resolved once at threshold — avoid O(n) name lookup every pointer sample. */
    label: string;
  } | null>(null);
  let presetDropTarget = $state<PresetDropTarget | null>(null);
  let presetHoverBank = $state<{ bankUuid: string; bankIndex: number } | null>(null);
  /** Latest pointer sample for rAF-coalesced drop-target hit-test. */
  let pendingPresetDragClient: {
    clientX: number;
    clientY: number;
    moveMode: boolean;
  } | null = null;
  let presetDragHitTestRafId: number | null = null;
  /** Defer selectPresetsBatch one frame so the drag overlay paints first. */
  let presetDragSelectRafId: number | null = null;

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

  const displayByUuid = $derived.by((): DisplayPositionMap => {
    // During drag, dragDisplayMap is reassigned (new Map) on each moved grid cell
    // so this derived's === output changes and cards/lines re-read positions.
    // In-place Map.set alone is not enough under Svelte 5 $derived.
    if (bankDragActive && dragDisplayMap) return dragDisplayMap;
    const list = $banks;
    const overrides = activeDragStored
      ? new Map([[activeDragStored.uuid, { x: activeDragStored.x, y: activeDragStored.y }]])
      : undefined;
    return timeLayout(() => resolveDisplayPositions(list, overrides));
  });

  const selectedBankUuidSet = $derived(new Set($bankMeta.selectedBankUuids));

  const visibleBanksForRender = $derived.by(() => {
    const visible = visibleCanvasBankUuids;
    const forceLite = stagedLiteUuids;
    const zoom = viewport.zoom;
    // Keep LOD module threshold in sync with settings (reactive re-render on slider).
    setBankLodFullZoom($appSettings.bankDetailMinZoom);
    // Touch LOD once so hysteresis advances with zoom for this render pass.
    bankLodMode(zoom);
    const rows: {
      bank: (typeof $banks)[number];
      index: number;
      variant: 'lite' | 'full';
    }[] = [];
    $banks.forEach((bank, index) => {
      let variant = bankCardVariant(zoom, bank.uuid, visible);
      // Staged enter: first paints are lite even when zoom would allow full.
      if (variant === 'full' && forceLite.has(bank.uuid)) {
        variant = 'lite';
      }
      if (variant !== null) {
        rows.push({ bank, index, variant });
      }
    });
    return rows;
  });

  function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  function setShowAttachSlotsChrome(next: boolean): void {
    if (showAttachSlotsRafId !== null) {
      cancelAnimationFrame(showAttachSlotsRafId);
      showAttachSlotsRafId = null;
    }
    if (!next) {
      showAttachSlotsChrome = false;
      return;
    }
    // Defer mount of corridor chrome until after grab-time card thrash.
    showAttachSlotsRafId = requestAnimationFrame(() => {
      showAttachSlotsRafId = null;
      if (bankDragActive) showAttachSlotsChrome = true;
    });
  }

  /** Corridor chrome only for movers + current dock pair (not every full card). */
  function bankShowsAttachSlots(uuid: string): boolean {
    if (!showAttachSlotsChrome) return false;
    if (dragClusterUuids?.has(uuid)) return true;
    if (dockHover?.targetUuid === uuid || dockHover?.draggedUuid === uuid) {
      return true;
    }
    if (bankDragGrab?.uuid === uuid) return true;
    return false;
  }

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

  function clearStagedLite(): void {
    if (stagedLiteRafId !== null) {
      cancelAnimationFrame(stagedLiteRafId);
      stagedLiteRafId = null;
    }
    const had = stagedLiteEnterFrame.size;
    stagedLiteEnterFrame = new Map();
    if (stagedLiteUuids.size > 0) {
      stagedLiteUuids = new Set();
    }
    if (had > 0) {
      viewperfStagedLite({ event: 'clear', count: had, clock: stagedLiteClock });
    }
  }

  /** Advance staged-lite hold and clear uuids that have waited long enough. */
  function tickStagedLitePromotion(): void {
    stagedLiteRafId = null;
    if (stagedLiteEnterFrame.size === 0) {
      if (stagedLiteUuids.size > 0) stagedLiteUuids = new Set();
      return;
    }
    stagedLiteClock++;
    const before = stagedLiteEnterFrame.size;
    const still = pruneStagedLiteUuids(
      stagedLiteEnterFrame,
      stagedLiteClock,
      STAGED_LITE_HOLD_FRAMES,
    );
    // Drop map entries that are no longer staged.
    if (still.size !== stagedLiteEnterFrame.size) {
      const nextMap = new Map<string, number>();
      for (const uuid of still) {
        const enteredAt = stagedLiteEnterFrame.get(uuid);
        if (enteredAt !== undefined) nextMap.set(uuid, enteredAt);
      }
      stagedLiteEnterFrame = nextMap;
    }
    if (!setsEqual(stagedLiteUuids, still)) {
      stagedLiteUuids = still;
    }
    const promoted = before - still.size;
    if (promoted > 0) {
      viewperfStagedLite({
        event: 'promote',
        count: promoted,
        clock: stagedLiteClock,
      });
    }
    if (stagedLiteEnterFrame.size > 0) {
      stagedLiteRafId = requestAnimationFrame(tickStagedLitePromotion);
    }
  }

  function noteVisibilityEnters(entered: readonly string[]): void {
    if (entered.length === 0) return;
    let changed = false;
    for (const uuid of entered) {
      if (!stagedLiteEnterFrame.has(uuid)) {
        stagedLiteEnterFrame.set(uuid, stagedLiteClock);
        changed = true;
      }
    }
    if (!changed) return;
    const next = new Set(stagedLiteUuids);
    for (const uuid of entered) next.add(uuid);
    stagedLiteUuids = next;
    viewperfStagedLite({
      event: 'enter',
      count: entered.length,
      uuids: entered,
      clock: stagedLiteClock,
    });
    if (stagedLiteRafId === null) {
      stagedLiteRafId = requestAnimationFrame(tickStagedLitePromotion);
    }
  }

  function cancelEnterDrain(): void {
    if (enterDrainRafId !== null) {
      cancelAnimationFrame(enterDrainRafId);
      enterDrainRafId = null;
    }
    pendingDesiredVisible = null;
  }

  function scheduleEnterDrain(): void {
    if (enterDrainRafId !== null || !pendingDesiredVisible) return;
    enterDrainRafId = requestAnimationFrame(() => {
      enterDrainRafId = null;
      if (!pendingDesiredVisible) return;
      // Drain remaining enters without re-running full sticky (desired is frozen).
      applyVisibilityMembership(
        pendingDesiredVisible,
        buildAlwaysVisibleUuids(),
        /* burst */ false,
        'enter-drain',
        /* cullMs */ 0,
        performance.now(),
      );
    });
  }

  /**
   * Schedule a visibility cull on the next animation frame.
   * Pan pointermoves call this so we never re-cull more than once per frame.
   * force=true still coalesces but runs a full sticky pass (zoom / thaw).
   */
  function scheduleCanvasVisibility(
    force = false,
    source: ViewperfVisibilitySource = 'schedule',
  ): void {
    if (force) visibilityForcePending = true;
    visibilitySourcePending = source;
    viewperfScheduleVisibility(force);
    if (visibilityRafId !== null) return;
    visibilityRafId = requestAnimationFrame(() => {
      visibilityRafId = null;
      const forceNow = visibilityForcePending;
      visibilityForcePending = false;
      const src = visibilitySourcePending;
      visibilitySourcePending = 'schedule';
      refreshCanvasVisibility(forceNow, src);
    });
  }

  /**
   * Apply rate-limited membership from a desired visible set.
   * `burst` uses a higher per-frame enter budget (thaw / zoom / effect).
   */
  function applyVisibilityMembership(
    desired: ReadonlySet<string>,
    alwaysInclude: ReadonlySet<string>,
    burst: boolean,
    source: ViewperfVisibilitySource,
    cullMs: number,
    tTotal0: number,
  ): boolean {
    const previous = visibleCanvasBankUuids;
    // Never mount unlimited banks in one frame (initial 237 → 90ms paint-gap).
    const maxEnters = burst
      ? Math.max(MAX_VISIBILITY_ENTERS_PER_FRAME * 3, 36)
      : MAX_VISIBILITY_ENTERS_PER_FRAME;
    const effective = applyVisibilityWithEnterCap(
      previous,
      desired,
      maxEnters,
      alwaysInclude,
    );

    // Drop staged entries that left the mount set.
    if (stagedLiteEnterFrame.size > 0) {
      let pruned = false;
      const prunedUuids: string[] = [];
      for (const uuid of [...stagedLiteEnterFrame.keys()]) {
        if (!effective.next.has(uuid)) {
          stagedLiteEnterFrame.delete(uuid);
          prunedUuids.push(uuid);
          pruned = true;
        }
      }
      if (pruned) {
        const still = new Set<string>();
        for (const uuid of stagedLiteEnterFrame.keys()) still.add(uuid);
        if (!setsEqual(stagedLiteUuids, still)) stagedLiteUuids = still;
        viewperfStagedLite({
          event: 'prune-offscreen',
          count: prunedUuids.length,
          uuids: prunedUuids,
          clock: stagedLiteClock,
        });
      }
    }

    let membershipChanged = false;
    if (!setsEqual(previous, effective.next)) {
      membershipChanged = true;
      if (effective.entered.length > 0) {
        noteVisibilityEnters(effective.entered);
      }
      visibleCanvasBankUuids = effective.next;
    }

    if (effective.remainingEnters > 0) {
      pendingDesiredVisible = new Set(desired);
      scheduleEnterDrain();
    } else {
      cancelEnterDrain();
    }

    recordVisibleBanksRendered(effective.next.size);
    recordBankRenderSnapshot($banks, visibleCanvasBankUuids, viewport.zoom);

    const totalMs = performance.now() - tTotal0;
    viewperfVisibilityRefresh({
      force: burst,
      source,
      bankTotal: $banks.length,
      canvasW: canvasWidth,
      canvasH: canvasHeight,
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      enterMarginPx: CANVAS_VISIBILITY_MARGINS.enterPx,
      exitMarginPx: CANVAS_VISIBILITY_MARGINS.exitPx,
      previousVisible: previous,
      nextVisible: effective.next,
      alwaysIncludeCount: alwaysInclude.size,
      stagedLiteCount: stagedLiteUuids.size,
      cullMs,
      totalMs,
      membershipChanged,
      remainingEnters: effective.remainingEnters,
    });

    if (effective.next.size !== lastVisibilityLogCount) {
      lastVisibilityLogCount = effective.next.size;
      log('attach', 'canvas visibility', {
        visible: effective.next.size,
        total: $banks.length,
        dragged: slotVisibilityDraggedUuid ?? activeDragStored?.uuid ?? null,
        frame: visibilityFrame,
        bankDragActive,
        stagedLite: stagedLiteUuids.size,
        remainingEnters: effective.remainingEnters,
        source,
        tag: VIEWPERF_TAG,
      });
    }

    return effective.remainingEnters > 0;
  }

  function panDeltaForcesThaw(): boolean {
    if (!isPanning) return false;
    const span = Math.min(canvasWidth, canvasHeight);
    if (span <= 0) return false;
    const dx = viewport.panX - panMembershipOrigin.panX;
    const dy = viewport.panY - panMembershipOrigin.panY;
    return Math.hypot(dx, dy) >= span * PAN_DELTA_THAW_RATIO;
  }

  function refreshCanvasVisibility(
    force = false,
    source: ViewperfVisibilitySource = 'other',
  ): void {
    const tTotal0 = performance.now();

    if (canvasWidth <= 0 || canvasHeight <= 0 || $banks.length === 0) {
      if (visibleCanvasBankUuids.size > 0) {
        visibleCanvasBankUuids = new Set();
      }
      clearStagedLite();
      cancelEnterDrain();
      return;
    }

    visibilityFrame++;
    const previous = visibleCanvasBankUuids;
    const alwaysInclude = buildAlwaysVisibleUuids();

    // Mid-pan freeze: keep world transform live, do not thrash mount set.
    // Escape hatch: large pan delta or force (pointerup/zoom/effect).
    const deltaThaw = !force && panDeltaForcesThaw();
    const applyMembership = force || deltaThaw || !isPanning;
    const effectiveSource: ViewperfVisibilitySource = deltaThaw
      ? 'delta-thaw'
      : source;

    if (!applyMembership) {
      // Still allow alwaysInclude to join (drag targets) without full re-cull churn.
      let needsPriority = false;
      for (const uuid of alwaysInclude) {
        if (!previous.has(uuid)) {
          needsPriority = true;
          break;
        }
      }
      if (!needsPriority) {
        const totalMs = performance.now() - tTotal0;
        viewperfVisibilityRefresh({
          force: false,
          source: effectiveSource,
          bankTotal: $banks.length,
          canvasW: canvasWidth,
          canvasH: canvasHeight,
          zoom: viewport.zoom,
          panX: viewport.panX,
          panY: viewport.panY,
          enterMarginPx: CANVAS_VISIBILITY_MARGINS.enterPx,
          exitMarginPx: CANVAS_VISIBILITY_MARGINS.exitPx,
          previousVisible: previous,
          nextVisible: previous,
          alwaysIncludeCount: alwaysInclude.size,
          stagedLiteCount: stagedLiteUuids.size,
          cullMs: 0,
          totalMs,
          membershipChanged: false,
          frozenSkip: true,
        });
        return;
      }
      // Priority path: merge alwaysInclude only.
      const merged = new Set(previous);
      for (const uuid of alwaysInclude) merged.add(uuid);
      if (!setsEqual(previous, merged)) {
        noteVisibilityEnters(
          [...alwaysInclude].filter((u) => !previous.has(u)),
        );
        visibleCanvasBankUuids = merged;
      }
      const totalMs = performance.now() - tTotal0;
      viewperfVisibilityRefresh({
        force: false,
        source: effectiveSource,
        bankTotal: $banks.length,
        canvasW: canvasWidth,
        canvasH: canvasHeight,
        zoom: viewport.zoom,
        panX: viewport.panX,
        panY: viewport.panY,
        enterMarginPx: CANVAS_VISIBILITY_MARGINS.enterPx,
        exitMarginPx: CANVAS_VISIBILITY_MARGINS.exitPx,
        previousVisible: previous,
        nextVisible: visibleCanvasBankUuids,
        alwaysIncludeCount: alwaysInclude.size,
        stagedLiteCount: stagedLiteUuids.size,
        cullMs: 0,
        totalMs,
        membershipChanged: !setsEqual(previous, visibleCanvasBankUuids),
        frozenSkip: false,
      });
      return;
    }

    // Reset pan freeze origin after a thaw so delta hatch can fire again.
    if (deltaThaw || force) {
      panMembershipOrigin = { panX: viewport.panX, panY: viewport.panY };
    }

    const tCull0 = performance.now();
    const desired = timeVisibility(() =>
      stickyVisibleBankUuidsInCanvas(
        $banks,
        displayByUuid,
        viewport,
        canvasWidth,
        canvasHeight,
        previous,
        alwaysInclude,
        CANVAS_VISIBILITY_MARGINS.enterPx,
        CANVAS_VISIBILITY_MARGINS.exitPx,
      ),
    );
    const cullMs = performance.now() - tCull0;

    applyVisibilityMembership(
      desired,
      alwaysInclude,
      /* burst enter budget for thaw/force paths */ true,
      effectiveSource,
      cullMs,
      tTotal0,
    );
  }

  /**
   * Build a fresh display map from frozen grab base + primary Δ.
   * Always assigns a **new** Map so Svelte 5 `$derived` invalidates (===) and
   * bank cards / connection lines re-render the drag preview. In-place Map.set
   * alone does not update the UI.
   */
  function updateLiveDragDisplayMap(
    draggedUuid: string,
    dragX: number,
    dragY: number,
  ): DisplayPositionMap {
    const baseDisplay = dragBaseDisplay;
    const cluster = dragClusterUuids;
    if (baseDisplay && cluster) {
      const next = timeLayout(() => {
        // Clone from frozen base (not the previous live map) so base stays pure.
        const map = new Map(baseDisplay);
        applyDragClusterDisplayPositions(
          map,
          baseDisplay,
          draggedUuid,
          dragX,
          dragY,
          cluster,
        );
        return map;
      });
      dragDisplayMap = next;
      dragDisplayEpoch += 1;
      return next;
    }
    // Fallback before grab session maps exist (should not run mid-drag).
    return timeLayout(() =>
      resolveDisplayPositions(
        $banks,
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
    // Do not reset visibilityFrame — staged-lite hold keys off it.
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
        // Preset drop target is in world coords — re-hit after pan without waiting for pointermove.
        if (presetDrag?.active) {
          updatePresetDragTargets(
            autoScrollPointer.clientX,
            autoScrollPointer.clientY,
          );
        }
      }
      if (bankDragGrab) {
        applyBankDragPointer(autoScrollPointer.clientX, autoScrollPointer.clientY);
      }
      // Already on rAF — cull immediately (not pointer-pan freeze).
      refreshCanvasVisibility(false, 'edge-scroll');
      edgeScrollRafId = requestAnimationFrame(tick);
    };
    edgeScrollRafId = requestAnimationFrame(tick);
  }

  function cancelPresetDragHitTestSchedule(): void {
    if (presetDragHitTestRafId !== null) {
      cancelAnimationFrame(presetDragHitTestRafId);
      presetDragHitTestRafId = null;
    }
    pendingPresetDragClient = null;
  }

  function cancelPresetDragSelectSchedule(): void {
    if (presetDragSelectRafId !== null) {
      cancelAnimationFrame(presetDragSelectRafId);
      presetDragSelectRafId = null;
    }
  }

  function flushPresetDragHitTest(): void {
    if (presetDragHitTestRafId !== null) {
      cancelAnimationFrame(presetDragHitTestRafId);
      presetDragHitTestRafId = null;
    }
    const pending = pendingPresetDragClient;
    pendingPresetDragClient = null;
    if (!pending || !presetDrag?.active) return;
    updatePresetDragTargets(pending.clientX, pending.clientY);
  }

  /** Coalesce drop-target hit-tests to one per frame; overlay position updates immediately. */
  function schedulePresetDragHitTest(
    clientX: number,
    clientY: number,
    moveMode: boolean,
  ): void {
    pendingPresetDragClient = { clientX, clientY, moveMode };
    if (presetDragHitTestRafId !== null) return;
    presetDragHitTestRafId = requestAnimationFrame(() => {
      presetDragHitTestRafId = null;
      const pending = pendingPresetDragClient;
      pendingPresetDragClient = null;
      if (!pending || !presetDrag?.active) return;
      updatePresetDragTargets(pending.clientX, pending.clientY);
    });
  }

  function syncPresetDragMoveModeFromEvent(event: KeyboardEvent | PointerEvent): void {
    if (!presetDrag) return;
    const next = event.ctrlKey || event.metaKey;
    if (presetDrag.moveMode === next) return;
    presetDrag = { ...presetDrag, moveMode: next };
  }

  function clearPresetDragSession(): void {
    cancelPresetDragHitTestSchedule();
    cancelPresetDragSelectSchedule();
    presetDrag = null;
    presetDropTarget = null;
    presetHoverBank = null;
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
      scheduleBankDragApply(event.clientX, event.clientY);
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
      cancelPresetDragHitTestSchedule();
      cancelPresetDragSelectSchedule();
      cancelBankDragApplySchedule();
      if (visibilityRafId !== null) {
        cancelAnimationFrame(visibilityRafId);
        visibilityRafId = null;
      }
      cancelEnterDrain();
      clearStagedLite();
      setShowAttachSlotsChrome(false);
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
    // Only re-cull when zoom/size/bank-count change — NOT pan.
    // refreshCanvasVisibility reads viewport.panX/Y and membership state; without
    // untrack those become effect deps and force a double-cull every pan sample
    // (see C15-VIEWPERF: refreshCalls ≈ 2× panSamples).
    viewport.zoom;
    canvasWidth;
    canvasHeight;
    $banks.length;
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    untrack(() => {
      refreshCanvasVisibility(true, 'effect');
    });
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
    // Zoom changes screen AABBs — cull immediately (sticky exit still applies).
    refreshCanvasVisibility(true, 'wheel');
    viewperfZoom({
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      bankTotal: $banks.length,
      visibleCount: visibleCanvasBankUuids.size,
    });
  }

  function startPan(clientX: number, clientY: number): void {
    isPanning = true;
    lastPointer = { x: clientX, y: clientY };
    panMembershipOrigin = { panX: viewport.panX, panY: viewport.panY };
    viewperfPanStart({
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      canvasW: canvasWidth,
      canvasH: canvasHeight,
      bankTotal: $banks.length,
      visibleCount: visibleCanvasBankUuids.size,
      source: 'pointer-pan',
    });
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
    viewperfPanSample();
    // Keep pan transform immediate; coalesce cull to one pass per frame.
    scheduleCanvasVisibility();
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
    // Thaw membership after pan freeze (rate-limited enters).
    refreshCanvasVisibility(true, 'pointerup');
    viewperfPanEnd({
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY,
      reason: 'pointerup',
    });
    canvasEl?.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Live Ctrl/Meta for preset-drag helper (no pointer motion required).
    if (
      presetDrag?.active &&
      (event.key === 'Control' ||
        event.key === 'Meta' ||
        event.ctrlKey ||
        event.metaKey)
    ) {
      syncPresetDragMoveModeFromEvent(event);
    }
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
          cancelBankDragApplySchedule();
          bankDragActive = false;
          bankDragGrab = null;
          bankGesture = null;
          dragBaseDisplay = null;
          dragDisplayMap = null;
          dragDisplayEpoch += 1;
          dragClusterUuids = null;
          activeDragStored = null;
          dockHover = null;
          slotVisibilityDraggedUuid = null;
          dockCorridorCache = null;
          setShowAttachSlotsChrome(false);
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
        clearPresetDragSession();
        if (!bankDragActive) stopEdgeScrollLoop();
        return;
      }
      selectBank(null);
      return;
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (!presetDrag?.active) return;
    if (
      event.key === 'Control' ||
      event.key === 'Meta' ||
      event.key === 'Ctrl'
    ) {
      syncPresetDragMoveModeFromEvent(event);
    }
  }

  function onWindowBlur(): void {
    // Avoid stuck "move" helper after Alt-Tab while Ctrl was held.
    if (!presetDrag?.active || !presetDrag.moveMode) return;
    presetDrag = { ...presetDrag, moveMode: false };
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
    // Use cached canvas rect (refreshed on resize) — avoid layout thrash every sample.
    const rect = canvasRectLike();
    if (rect.width <= 0 || rect.height <= 0) return;
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

    // Commit latest coalesced hit-test so drop index matches last pointer sample.
    if (drag.active) {
      flushPresetDragHitTest();
      // If deferred selection never ran (very short drag), ensure batch ran for consistency.
      cancelPresetDragSelectSchedule();
    }

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

    clearPresetDragSession();
    if (!bankDragActive) stopEdgeScrollLoop();
  }

  function onPresetDragPointerMove(event: PointerEvent): void {
    if (!presetDrag || event.pointerId !== presetDrag.pointerId) return;

    const moveMode = event.ctrlKey || event.metaKey;
    // Lightweight: always update overlay position + modifier immediately (no hit-test).
    presetDrag = {
      ...presetDrag,
      clientX: event.clientX,
      clientY: event.clientY,
      moveMode,
    };

    if (!presetDrag.active) {
      const dx = event.clientX - presetDrag.startClientX;
      const dy = event.clientY - presetDrag.startClientY;
      if (Math.hypot(dx, dy) < PRESET_DRAG_THRESHOLD_PX) return;
      const label = presetDragLabel(
        presetDrag.presetUuids,
        presetDrag.sourceBankUuid,
      );
      presetDrag = { ...presetDrag, active: true, label };
      // Defer store selection one frame so the drag chip paints before banks remap.
      const sourceBankUuid = presetDrag.sourceBankUuid;
      const presetUuids = presetDrag.presetUuids;
      cancelPresetDragSelectSchedule();
      presetDragSelectRafId = requestAnimationFrame(() => {
        presetDragSelectRafId = null;
        if (!presetDrag?.active) return;
        selectPresetsBatch(sourceBankUuid, presetUuids);
      });
      startEdgeScrollLoop();
      log('preset', 'drag start', {
        source: sourceBankUuid,
        count: presetUuids.length,
        uuids: presetUuids,
      });
    }

    schedulePresetDragHitTest(event.clientX, event.clientY, moveMode);
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

    cancelPresetDragHitTestSchedule();
    cancelPresetDragSelectSchedule();
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
      label: '',
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
      label: presetDrag.label || 'Preset',
      count: presetDrag.presetUuids.length,
      moveMode: presetDrag.moveMode,
    };
  });

  const presetDragBankHint = $derived.by(() => {
    // Lite cards hide preset rows — show bank name chip while dropping at low zoom.
    if (!presetDrag?.active || bankLodMode(viewport.zoom) !== 'lite' || !presetHoverBank) {
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

  function scheduleBankDragApply(clientX: number, clientY: number): void {
    pendingDragClient = { clientX, clientY };
    if (bankDragApplyRafId !== null) return;
    bankDragApplyRafId = requestAnimationFrame(() => {
      bankDragApplyRafId = null;
      const pending = pendingDragClient;
      if (!pending || !bankDragGrab) return;
      applyBankDragPointer(pending.clientX, pending.clientY);
    });
  }

  /** Cancel pending rAF and apply the latest sample immediately (grab / end). */
  function flushBankDragApply(): void {
    if (bankDragApplyRafId !== null) {
      cancelAnimationFrame(bankDragApplyRafId);
      bankDragApplyRafId = null;
    }
    const pending = pendingDragClient;
    pendingDragClient = null;
    if (pending && bankDragGrab) {
      applyBankDragPointer(pending.clientX, pending.clientY);
    }
  }

  function cancelBankDragApplySchedule(): void {
    if (bankDragApplyRafId !== null) {
      cancelAnimationFrame(bankDragApplyRafId);
      bankDragApplyRafId = null;
    }
    pendingDragClient = null;
  }

  function applyBankDragPointer(clientX: number, clientY: number): void {
    if (!bankDragGrab || !canvasEl) return;
    timeApply(() => {
      const grab = bankDragGrab;
      if (!grab) return;
      const rect = canvasRectLike();
      const c15 = clientToC15(clientX, clientY, rect, viewport);
      const rawX = c15.x - grab.offsetC15X;
      const rawY = c15.y - grab.offsetC15Y;

      const applied = applyBankDragPointerPosition(rawX, rawY);

      // Same grid cell as last apply — skip Map rebuild, reactive assign, dock.
      if (
        activeDragStored &&
        activeDragStored.uuid === grab.uuid &&
        activeDragStored.x === applied.dragX &&
        activeDragStored.y === applied.dragY
      ) {
        return;
      }

      const nextDisplay = updateLiveDragDisplayMap(
        grab.uuid,
        applied.dragX,
        applied.dragY,
      );
      activeDragStored = {
        uuid: grab.uuid,
        x: applied.dragX,
        y: applied.dragY,
      };
      updateDockHover(grab.uuid, applied.dragX, applied.dragY, nextDisplay);
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
    const base = timeLayout(() => resolveDisplayPositions(listAfter));
    dragBaseDisplay = base;
    // One O(n) clone at grab; subsequent moves only rewrite cluster keys.
    dragDisplayMap = new Map(base);
    dragDisplayEpoch += 1;
    startBankDragPerfSession(listAfter, plan.moveSet.size, viewport.zoom);

    slotVisibilityDraggedUuid = uuid;
    dockHoverFrame = 0;
    lastDockDragX = info.originX;
    lastDockDragY = info.originY;
    dockCorridorCache = new Map();
    setShowAttachSlotsChrome(true);
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
    if (!dragDisplay.has(draggedUuid)) {
      dragDisplay = new Map(dragDisplay).set(draggedUuid, { x: dragX, y: dragY });
    }

    // Same spatial prefilter as resolveBankDragEndDock (not viewport cull) so
    // cyan hover and release dock choose the same target near edges / high zoom.
    const candidateUuids = collectSpatialDockCandidateUuids(
      $banks,
      cluster,
      dragDisplay,
    );
    const dock = timeDock(() =>
      findDockTargetForDragCluster($banks, cluster, dragDisplay, {
        candidateUuids,
        excludeClusterUuids: cluster,
        corridorCache: dockCorridorCache ?? undefined,
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

    // Commit latest coalesced pointer sample before reading final origin.
    flushBankDragApply();

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
    dragDisplayEpoch += 1;
    dragClusterUuids = null;
    slotVisibilityDraggedUuid = null;
    dockHoverFrame = 0;
    dockCorridorCache = null;
    cancelBankDragApplySchedule();
    setShowAttachSlotsChrome(false);
    if (!presetDrag?.active) stopEdgeScrollLoop();

    try {
      if (final && final.uuid === uuid) {
        timeStore(() =>
          moveBankTo(uuid, final.x, final.y, {
            moveUuids,
          }),
        );
      }

      activeDragStored = null;
      dockHover = null;
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

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onWindowBlur} />

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
        <SynthZoneOverlay />
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
            selected={selectedBankUuidSet.has(bank.uuid)}
            userPositioned={$userPositionedUuids.has(bank.uuid)}
            suppressNameTooltip={presetDrag?.active === true}
            dockEdgeHighlight={dockEdge}
            dragging={bankDragGrab?.uuid === bank.uuid}
            reduceSelectionGlow={bankDragActive}
            onbankpointerdown={(info) =>
              handleBankGestureStart(bank.uuid, info)}
          />
        {:else}
          <BankCard
            {bank}
            displayX={display.x}
            displayY={display.y}
            {index}
            selected={selectedBankUuidSet.has(bank.uuid)}
            userPositioned={$userPositionedUuids.has(bank.uuid)}
            showAttachSlots={bankShowsAttachSlots(bank.uuid)}
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
            reduceSelectionGlow={bankDragActive}
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