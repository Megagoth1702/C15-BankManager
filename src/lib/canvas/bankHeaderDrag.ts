/**
 * Shared bank header/surface drag gesture (threshold → grab → click-up select).
 * Cards keep DOM handlers; this holds the pure state machine transitions.
 */
import { POINTER_GESTURE_THRESHOLD_PX } from './bankCardChrome';

export type BankHeaderDragPhase = 'idle' | 'pending' | 'dragging';

export type BankHeaderDragState = {
  phase: BankHeaderDragPhase;
  pointerDownScreen: { x: number; y: number };
  dragOriginDisplay: { x: number; y: number };
};

export function createIdleBankHeaderDrag(): BankHeaderDragState {
  return {
    phase: 'idle',
    pointerDownScreen: { x: 0, y: 0 },
    dragOriginDisplay: { x: 0, y: 0 },
  };
}

export function beginBankHeaderPointerDown(
  clientX: number,
  clientY: number,
  originX: number,
  originY: number,
): BankHeaderDragState {
  return {
    phase: 'pending',
    pointerDownScreen: { x: clientX, y: clientY },
    dragOriginDisplay: { x: originX, y: originY },
  };
}

/**
 * On move: if past threshold while pending, transition to dragging and signal grab.
 */
export function advanceBankHeaderPointerMove(
  state: BankHeaderDragState,
  clientX: number,
  clientY: number,
  thresholdPx = POINTER_GESTURE_THRESHOLD_PX,
): { state: BankHeaderDragState; justGrabbed: boolean } {
  if (state.phase !== 'pending') {
    return { state, justGrabbed: false };
  }
  const dx = clientX - state.pointerDownScreen.x;
  const dy = clientY - state.pointerDownScreen.y;
  if (Math.hypot(dx, dy) < thresholdPx) {
    return { state, justGrabbed: false };
  }
  return {
    state: { ...state, phase: 'dragging' },
    justGrabbed: true,
  };
}

export type BankHeaderPointerUpResult =
  | { kind: 'drag-end' }
  | { kind: 'click-select' }
  | { kind: 'none' };

export function finishBankHeaderPointerUp(
  state: BankHeaderDragState,
): { result: BankHeaderPointerUpResult; state: BankHeaderDragState } {
  if (state.phase === 'dragging') {
    return {
      result: { kind: 'drag-end' },
      state: createIdleBankHeaderDrag(),
    };
  }
  if (state.phase === 'pending') {
    return {
      result: { kind: 'click-select' },
      state: createIdleBankHeaderDrag(),
    };
  }
  return { result: { kind: 'none' }, state: createIdleBankHeaderDrag() };
}
