/**
 * Minimal playground WebUI client: WebSocket path-query RPC + XML document pushes.
 * @see .ObsidianBrain/Design/C15_LIVE_PROTOCOL.md
 * @see NonMaps WebSocketConnection / ServerProxy
 */

import { c15RandomUuid } from '../uuid/c15Uuid';
import { log } from '../debug/sessionLog';
import { rpcPing } from './liveRpc';
import type { LiveSettings } from './liveSettings';

export type LiveClientStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface LiveC15ClientOptions {
  settings: LiveSettings;
  /** Called for non-pong text frames (XML documents). */
  onDocument?: (xml: string) => void;
  onStatus?: (status: LiveClientStatus, detail?: string) => void;
  onPong?: (n: number, rttMs: number) => void;
  /** Auto-reconnect after unexpected close while armed. Default true. */
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

export function buildWebSocketUrl(settings: LiveSettings, clientId: string): string {
  if (settings.useDevProxy && typeof location !== 'undefined') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Vite proxies `/c15-api` → C15 :8080 (including `/ws/…`).
    return `${proto}//${location.host}/c15-api/ws/${encodeURIComponent(clientId)}`;
  }
  return `ws://${settings.host}:${settings.port}/ws/${encodeURIComponent(clientId)}`;
}

export function buildHttpBase(settings: LiveSettings): string {
  if (settings.useDevProxy && typeof location !== 'undefined') {
    return `${location.origin}/c15-api`;
  }
  return `http://${settings.host}:${settings.port}`;
}

export class LiveC15Client {
  readonly clientId: string;
  private socket: WebSocket | null = null;
  private status: LiveClientStatus = 'idle';
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingCount = 0;
  private lastPingSentAt = 0;
  private armed = false;
  private settings: LiveSettings;
  private readonly onDocument?: (xml: string) => void;
  private readonly onStatus?: (status: LiveClientStatus, detail?: string) => void;
  private readonly onPong?: (n: number, rttMs: number) => void;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  constructor(options: LiveC15ClientOptions) {
    this.clientId = c15RandomUuid();
    this.settings = options.settings;
    this.onDocument = options.onDocument;
    this.onStatus = options.onStatus;
    this.onPong = options.onPong;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
  }

  getStatus(): LiveClientStatus {
    return this.status;
  }

  getSettings(): LiveSettings {
    return this.settings;
  }

  updateSettings(settings: LiveSettings): void {
    this.settings = settings;
  }

  connect(): void {
    this.armed = true;
    this.clearReconnectTimer();
    this.openSocket();
  }

  disconnect(): void {
    this.armed = false;
    this.clearPing();
    this.clearReconnectTimer();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.onopen = null;
        s.onmessage = null;
        s.onerror = null;
        s.onclose = null;
        s.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus('closed', 'disconnected');
  }

  /** Send a raw path-query frame. No-op if socket not open. */
  send(frame: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      log('C15-LIVE', `send skipped (not open): ${frame.slice(0, 80)}`, undefined, 'warn');
      return false;
    }
    this.socket.send(frame);
    return true;
  }

  private openSocket(): void {
    this.clearPing();
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }

    const url = buildWebSocketUrl(this.settings, this.clientId);
    this.setStatus('connecting', url);
    log('C15-LIVE', `connecting ${url}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus('error', msg);
      this.scheduleReconnect();
      return;
    }

    this.socket = ws;

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.setStatus('open');
      log('C15-LIVE', 'socket open');
      this.schedulePing();
    };

    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      if (data.startsWith('/pong/')) {
        const n = Number.parseInt(data.slice('/pong/'.length), 10);
        const rtt = this.lastPingSentAt ? Date.now() - this.lastPingSentAt : 0;
        this.onPong?.(Number.isFinite(n) ? n : 0, rtt);
        this.schedulePing();
        return;
      }
      this.onDocument?.(data);
    };

    ws.onerror = () => {
      if (this.socket !== ws) return;
      log('C15-LIVE', 'socket error', undefined, 'warn');
      this.setStatus('error', 'WebSocket error');
    };

    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.clearPing();
      log('C15-LIVE', 'socket closed');
      if (this.armed) {
        this.setStatus('closed', 'connection lost');
        this.scheduleReconnect();
      } else {
        this.setStatus('closed', 'disconnected');
      }
    };
  }

  private schedulePing(): void {
    this.clearPing();
    // NonMaps pings continuously; ~1s is fine for keep-alive.
    this.pingTimer = setTimeout(() => {
      this.pingCount += 1;
      this.lastPingSentAt = Date.now();
      this.send(rpcPing(this.pingCount));
      // If no pong, onclose/error will handle; still schedule a slow retry ping.
      this.pingTimer = setTimeout(() => this.schedulePing(), 5000);
    }, 1000);
  }

  private clearPing(): void {
    if (this.pingTimer != null) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.armed || !this.autoReconnect) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.armed) this.openSocket();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: LiveClientStatus, detail?: string): void {
    this.status = status;
    this.onStatus?.(status, detail);
  }
}
