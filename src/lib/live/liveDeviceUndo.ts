/**
 * Device undo/redo state while Live.
 * C15 playground is authority: we mirror canUndo/canRedo from the WS
 * `<undo>` section and send `/undo/undo` + `/undo/redo` RPCs (never local history).
 *
 * @see firmware UndoActions.cpp, Scope::writeDocument
 */

import { writable } from 'svelte/store';
import { parseDeviceUndoSection } from './parseLiveDocument';

export interface DeviceUndoState {
  canUndo: boolean;
  canRedo: boolean;
  /** Last seen transaction id strings (debug / future jump). */
  undoId: string;
  redoId: string;
}

const initial: DeviceUndoState = {
  canUndo: false,
  canRedo: false,
  undoId: '',
  redoId: '',
};

export const deviceUndoState = writable<DeviceUndoState>({ ...initial });

export function resetDeviceUndoState(): void {
  deviceUndoState.set({ ...initial });
}

/** Update flags when a document includes an `<undo>` section; ignore omissions. */
export function applyDeviceUndoFromXml(xml: string): void {
  const snap = parseDeviceUndoSection(xml);
  if (!snap.present) return;
  deviceUndoState.set({
    canUndo: snap.canUndo,
    canRedo: snap.canRedo,
    undoId: snap.undoId,
    redoId: snap.redoId,
  });
}
