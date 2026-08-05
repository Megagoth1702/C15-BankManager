/**
 * Live connection UI state + Phase 2 library mirror onto the bank store.
 */

import { derived, get, writable } from 'svelte/store';
import { getCanvasScreenSize } from '../canvas/pointerPosition';
import { focusBank } from '../canvas/viewport.svelte';
import { log } from '../debug/sessionLog';
import { bankMeta, banks, clearUserPositioned, getBanksSnapshot } from '../model/bankState';
import { clearSessionDirty } from '../model/sessionDirty';
import { clearHistory, setLocalHistoryEnabled } from '../model/undoHistory';
import { findByUuid } from '../uuid/uuidKey';
import {
  applyLiveDocumentXml,
  getLiveFocusBankUuid,
  resetLiveLibraryApplyState,
} from './applyLiveDocument';
import { LiveC15Client, type LiveClientStatus } from './LiveC15Client';
import { canUseLiveSockets, liveSocketsBlockedReason } from './liveCapability';
import {
  applyDeviceUndoFromXml,
  resetDeviceUndoState,
} from './liveDeviceUndo';
import {
  getLiveImportBusy,
  notifyDeviceLibrarySnapshot,
  resetDeviceLibrarySnapshot,
  type DeviceBankRef,
} from './liveImportJob';
import { parseLiveDocument } from './parseLiveDocument';
import { getLiveSettingsSnapshot, liveSettings, type LiveSettings } from './liveSettings';

export type LiveConnectionState =
  | 'offline'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error';

export interface LiveModeState {
  connection: LiveConnectionState;
  /** Last error or status detail for the UI. */
  detail: string | null;
  /** Last playground updateID seen in a document push (if parsed). */
  lastUpdateId: number | null;
  /** Rough size of last document for debug. */
  lastDocumentBytes: number | null;
  /** RTT from last pong. */
  lastRttMs: number | null;
  clientId: string | null;
  /** Banks currently mirrored from the device (0 until first library push). */
  mirroredBankCount: number;
  /** True after at least one successful bank-section apply. */
  libraryReady: boolean;
}

const initial: LiveModeState = {
  connection: 'offline',
  detail: null,
  lastUpdateId: null,
  lastDocumentBytes: null,
  lastRttMs: null,
  clientId: null,
  mirroredBankCount: 0,
  libraryReady: false,
};

export const liveMode = writable<LiveModeState>({ ...initial });

export const isLiveConnected = derived(
  liveMode,
  ($m) => $m.connection === 'live' || $m.connection === 'reconnecting',
);

let client: LiveC15Client | null = null;

/** Last raw XML document from playground. */
let lastDocumentXml: string | null = null;

export function getLastLiveDocumentXml(): string | null {
  return lastDocumentXml;
}

export function getLiveClient(): LiveC15Client | null {
  return client;
}

function extractUpdateId(xml: string): number | null {
  const m = xml.match(/<nonlinear-world\b[^>]*\bupdateID="(\d+)"/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function focusFirstLiveBank(): void {
  const uuid = getLiveFocusBankUuid();
  if (!uuid) return;
  const bank = findByUuid(getBanksSnapshot(), uuid);
  if (!bank) return;
  const size = getCanvasScreenSize();
  if (!size || size.width <= 0 || size.height <= 0) return;
  focusBank(bank, size.width, size.height, get(banks));
  log('C15-LIVE', 'focus after first library pull', {
    uuid: bank.uuid.slice(0, 8),
    name: bank.name,
  });
}

function mapClientStatus(status: LiveClientStatus, detail?: string): void {
  liveMode.update((m) => {
    switch (status) {
      case 'connecting':
        return {
          ...m,
          connection:
            m.connection === 'live' || m.connection === 'reconnecting'
              ? 'reconnecting'
              : 'connecting',
          detail: detail ?? m.detail,
        };
      case 'open':
        return {
          ...m,
          connection: 'live',
          detail: detail ?? (m.libraryReady ? m.detail : 'Connected · waiting for library…'),
        };
      case 'error':
        return {
          ...m,
          connection: 'error',
          detail: detail ?? 'Connection error',
        };
      case 'closed':
        if (!client || get(liveMode).connection === 'offline') {
          return { ...initial };
        }
        return {
          ...m,
          connection: 'reconnecting',
          detail: detail ?? 'Reconnecting…',
        };
      case 'idle':
      default:
        return m;
    }
  });
}

/**
 * Build a device-library snapshot from the **parsed WS document**, never from
 * the local canvas. Publishing canvas banks as "device state" poisoned import
 * waiters (local replace looked like the device already had the new UUIDs).
 */
function deviceBanksFromLiveDoc(
  banks: NonNullable<ReturnType<typeof parseLiveDocument>>['banks'],
): DeviceBankRef[] {
  if (!banks) return [];
  return banks.map((b) => ({
    uuid: b.uuid,
    name: b.name,
    x: b.x,
    y: b.y,
    attachedToUuid: b.attachedToUuid,
    attachDirection: b.attachDirection,
  }));
}

function publishDeviceSnapshotFromDoc(
  updateId: number | null,
  banks: DeviceBankRef[],
): void {
  notifyDeviceLibrarySnapshot({
    updateId,
    at: Date.now(),
    banks,
  });
}

function handleDocument(xml: string): void {
  lastDocumentXml = xml;
  const updateId = extractUpdateId(xml);
  const parsed = parseLiveDocument(xml);

  liveMode.update((m) => ({
    ...m,
    lastUpdateId: updateId ?? m.lastUpdateId,
    lastDocumentBytes: xml.length,
    connection:
      m.connection === 'connecting' || m.connection === 'reconnecting'
        ? 'live'
        : m.connection,
  }));

  // Phase 6: undo tips can arrive without a banks section change — always try.
  applyDeviceUndoFromXml(xml);

  // Device snapshot for import waiters: only when the banks section changed.
  // Never republish the local canvas on selection-only frames (that caused
  // false "device already has imported banks" sync and early unfreeze).
  if (
    parsed &&
    !parsed.omitOracles &&
    parsed.banksSectionChanged &&
    parsed.banks != null
  ) {
    publishDeviceSnapshotFromDoc(
      parsed.updateId ?? updateId,
      deviceBanksFromLiveDoc(parsed.banks),
    );
  }

  // While a Live import job is active, do not mirror into the bank store.
  // Store thrashing mid import-all-banks / sequential import-bank races the
  // upload and can re-enter push paths as soon as the job ends early.
  if (getLiveImportBusy()) {
    if (parsed?.banksSectionChanged && parsed.banks != null) {
      liveMode.update((m) => ({
        ...m,
        libraryReady: true,
        mirroredBankCount: parsed.banks!.length,
        lastUpdateId: parsed.updateId ?? updateId ?? m.lastUpdateId,
        detail: `C15 busy · ${parsed.banks!.length} bank${parsed.banks!.length === 1 ? '' : 's'} on device…`,
      }));
    }
    log(
      'C15-LIVE',
      `document ${xml.length} B updateID=${updateId ?? '?'} deferred (import job active)`,
    );
    return;
  }

  const result = applyLiveDocumentXml(xml);

  if (result.applied) {
    liveMode.update((m) => ({
      ...m,
      libraryReady: true,
      mirroredBankCount: result.bankCount,
      lastUpdateId: result.updateId ?? updateId ?? m.lastUpdateId,
      detail: `Live · ${result.bankCount} bank${result.bankCount === 1 ? '' : 's'} · updateID ${result.updateId ?? updateId ?? '?'}`,
    }));
    if (result.firstLibraryPull) {
      // Defer focus until after Svelte flushes bank list.
      queueMicrotask(() => focusFirstLiveBank());
    }
  } else {
    liveMode.update((m) => {
      if (m.libraryReady) {
        return {
          ...m,
          detail:
            updateId != null
              ? `Live · ${m.mirroredBankCount} bank${m.mirroredBankCount === 1 ? '' : 's'} · updateID ${updateId}`
              : m.detail,
        };
      }
      return {
        ...m,
        detail:
          updateId != null
            ? `Connected · updateID ${updateId} (waiting for banks…)`
            : (m.detail ?? 'Connected'),
      };
    });
    log('C15-LIVE', `document ${xml.length} B updateID=${updateId ?? '?'} apply=${result.reason}`);
  }
}

/**
 * After a Live import job ends, re-apply the last device document so the
 * canvas catches up (store applies were deferred while the job was active).
 */
export function reapplyLastLiveDocument(): void {
  if (!lastDocumentXml) return;
  if (getLiveImportBusy()) return;
  const xml = lastDocumentXml;
  const updateId = extractUpdateId(xml);
  const result = applyLiveDocumentXml(xml);
  if (result.applied) {
    liveMode.update((m) => ({
      ...m,
      libraryReady: true,
      mirroredBankCount: result.bankCount,
      lastUpdateId: result.updateId ?? updateId ?? m.lastUpdateId,
      detail: `Live · ${result.bankCount} bank${result.bankCount === 1 ? '' : 's'} · updateID ${result.updateId ?? updateId ?? '?'}`,
    }));
    log('C15-LIVE', 'reapplied last document after import job', {
      bankCount: result.bankCount,
      updateId: result.updateId ?? updateId,
    });
  }
}

/**
 * Start Live connection with current settings.
 * First full document replace paints the device library (Phase 2).
 * Caller should handle dirty-session UX first.
 */
export function connectLive(settingsOverride?: Partial<LiveSettings>): boolean {
  if (!canUseLiveSockets()) {
    const reason = liveSocketsBlockedReason() ?? 'Live sockets unavailable';
    liveMode.set({
      ...initial,
      connection: 'error',
      detail: reason,
    });
    log('C15-LIVE', reason, undefined, 'warn');
    return false;
  }

  disconnectLive({ silent: true });

  const base = getLiveSettingsSnapshot();
  const settings: LiveSettings = {
    host: settingsOverride?.host ?? base.host,
    port: settingsOverride?.port ?? base.port,
    useDevProxy: settingsOverride?.useDevProxy ?? base.useDevProxy,
  };

  lastDocumentXml = null;
  resetLiveLibraryApplyState();
  resetDeviceLibrarySnapshot();
  resetDeviceUndoState();
  // Device owns undo while Live — do not record offline deltas.
  setLocalHistoryEnabled(false);

  client = new LiveC15Client({
    settings,
    autoReconnect: true,
    onStatus: (status, detail) => {
      mapClientStatus(status, detail);
    },
    onDocument: (xml) => {
      handleDocument(xml);
    },
    onPong: (_n, rttMs) => {
      liveMode.update((m) => ({ ...m, lastRttMs: rttMs }));
    },
  });

  liveMode.set({
    connection: 'connecting',
    detail: settings.useDevProxy
      ? `Connecting via dev proxy → ${settings.host}:${settings.port}…`
      : `Connecting to ${settings.host}:${settings.port}…`,
    lastUpdateId: null,
    lastDocumentBytes: null,
    lastRttMs: null,
    clientId: client.clientId,
    mirroredBankCount: 0,
    libraryReady: false,
  });

  client.connect();
  return true;
}

/**
 * Drop the Live mirror from the canvas. WS library is metadata shells only;
 * after disconnect those banks are not real offline sound data — clear them
 * so the UI does not look like a full session. Call only on user Disconnect
 * (not silent teardown before reconnect).
 */
export function clearSessionAfterLiveDisconnect(): number {
  const count = getBanksSnapshot().length;
  banks.set([]);
  clearUserPositioned();
  clearHistory();
  clearSessionDirty();
  bankMeta.update((m) => ({
    ...m,
    selectedBankUuids: [],
    bankSelectionAnchorUuid: null,
    bankSelectionBaseUuids: [],
    selectedMidiBankUuid: '',
    selectedPresetUuids: [],
    presetSelectionBankUuid: null,
    presetSelectionAnchorUuid: null,
    presetSelectionBaseUuids: [],
    renamingBankUuid: null,
    renamingPreset: null,
    focusBankUuid: null,
    focusPresetUuid: null,
    revealSidebarPresetUuid: null,
    revealSidebarBankUuid: null,
    deleteFocus: null,
    lastImportFilename: '',
    lastImportMode: null,
    error: null,
    loading: false,
    selectionSurface: null,
    renameSurface: null,
  }));
  return count;
}

export function disconnectLive(opts?: { silent?: boolean }): void {
  const c = client;
  client = null;
  lastDocumentXml = null;
  resetLiveLibraryApplyState();
  resetDeviceLibrarySnapshot();
  resetDeviceUndoState();
  if (c) c.disconnect();
  if (!opts?.silent) {
    // User Disconnect: drop Live mirror (shells are not keepable offline data).
    // Silent path (connectLive teardown / reconnect) keeps canvas until the
    // next library pull replaces it.
    const cleared = clearSessionAfterLiveDisconnect();
    setLocalHistoryEnabled(true);
    liveMode.set({ ...initial });
    log('C15-LIVE', 'disconnected', { clearedBanks: cleared });
  }
}

/** Send RPC if live; returns false if not connected. */
export function sendLiveRpc(frame: string): boolean {
  if (!client || client.getStatus() !== 'open') return false;
  return client.send(frame);
}

/** Subscribe helper for settings changes while connected (reconnect with new host). */
export function reconnectLiveWithCurrentSettings(): boolean {
  const wasLive =
    get(liveMode).connection === 'live' ||
    get(liveMode).connection === 'connecting' ||
    get(liveMode).connection === 'reconnecting';
  if (!wasLive) return false;
  return connectLive();
}

// Keep a subscription so settings store is always initialized in app.
liveSettings.subscribe(() => {
  /* settings read on connect */
});
