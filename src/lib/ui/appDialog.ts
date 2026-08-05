/**
 * In-app modal dialogs (confirm / prompt / alert) for use from store code
 * and components. Prefer these over window.confirm / alert / prompt — those
 * can be blocked by the browser and hide critical choices.
 *
 * AppDialogHost must be mounted (App.svelte). Without a host (Node verify
 * scripts), confirm resolves true and prompt returns the default value so
 * headless tests keep working.
 */
import { get, writable } from 'svelte/store';

export type AppDialogKind = 'confirm' | 'prompt' | 'alert';

export interface AppDialogBase {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the primary button as a destructive action. */
  danger?: boolean;
}

export interface AppDialogConfirmRequest extends AppDialogBase {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}

export interface AppDialogPromptRequest extends AppDialogBase {
  kind: 'prompt';
  defaultValue: string;
  resolve: (value: string | null) => void;
}

export interface AppDialogAlertRequest extends AppDialogBase {
  kind: 'alert';
  resolve: () => void;
}

export type AppDialogRequest =
  | AppDialogConfirmRequest
  | AppDialogPromptRequest
  | AppDialogAlertRequest;

/** Currently open dialog, or null. Bound by AppDialogHost. */
export const appDialog = writable<AppDialogRequest | null>(null);

let hostMounted = false;
const waitQueue: Array<() => void> = [];

/** Called by AppDialogHost on mount/destroy. */
export function setAppDialogHostMounted(mounted: boolean): void {
  hostMounted = mounted;
  if (mounted) {
    // Drain anything that queued before mount (unlikely).
    while (waitQueue.length > 0) {
      waitQueue.shift()?.();
    }
  }
}

export function isAppDialogHostMounted(): boolean {
  return hostMounted;
}

function waitUntilIdle(): Promise<void> {
  if (get(appDialog) === null) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = appDialog.subscribe((req) => {
      if (req === null) {
        unsub();
        resolve();
      }
    });
  });
}

function headlessConfirm(): boolean {
  return true;
}

function headlessPrompt(defaultValue: string): string | null {
  return defaultValue;
}

/**
 * Confirm dialog. Resolves true on primary action, false on cancel / Escape / backdrop.
 */
export async function confirmAppDialog(
  options: Omit<AppDialogBase, 'confirmLabel' | 'cancelLabel'> & {
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<boolean> {
  await waitUntilIdle();

  if (!hostMounted || typeof document === 'undefined') {
    return headlessConfirm();
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    appDialog.set({
      kind: 'confirm',
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      danger: options.danger ?? false,
      resolve: (ok) => {
        if (settled) return;
        settled = true;
        appDialog.set(null);
        resolve(ok);
      },
    });
  });
}

/**
 * Prompt for a string. Resolves with the trimmed input, or null if cancelled.
 */
export async function promptAppDialog(
  options: Omit<AppDialogBase, 'confirmLabel' | 'cancelLabel'> & {
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  },
): Promise<string | null> {
  await waitUntilIdle();

  const defaultValue = options.defaultValue ?? '';

  if (!hostMounted || typeof document === 'undefined') {
    return headlessPrompt(defaultValue);
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    appDialog.set({
      kind: 'prompt',
      title: options.title,
      message: options.message,
      defaultValue,
      confirmLabel: options.confirmLabel ?? 'Save',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      danger: options.danger ?? false,
      resolve: (value) => {
        if (settled) return;
        settled = true;
        appDialog.set(null);
        resolve(value);
      },
    });
  });
}

/** Info-only dialog with a single dismiss button. */
export async function alertAppDialog(
  options: Omit<AppDialogBase, 'confirmLabel' | 'cancelLabel' | 'danger'> & {
    confirmLabel?: string;
  },
): Promise<void> {
  await waitUntilIdle();

  if (!hostMounted || typeof document === 'undefined') {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    appDialog.set({
      kind: 'alert',
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'OK',
      resolve: () => {
        if (settled) return;
        settled = true;
        appDialog.set(null);
        resolve();
      },
    });
  });
}

/** Dismiss the open dialog as cancelled (Escape / backdrop). */
export function dismissAppDialog(): void {
  const req = get(appDialog);
  if (!req) return;
  if (req.kind === 'confirm') req.resolve(false);
  else if (req.kind === 'prompt') req.resolve(null);
  else req.resolve();
}
