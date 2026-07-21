import { get, writable } from 'svelte/store';

/** True when the session has changes not yet saved via export. */
export const sessionDirty = writable(false);

export function isSessionDirty(): boolean {
  return get(sessionDirty);
}

export function markSessionDirty(): void {
  sessionDirty.set(true);
}

export function clearSessionDirty(): void {
  sessionDirty.set(false);
}