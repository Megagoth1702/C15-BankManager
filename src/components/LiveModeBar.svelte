<script lang="ts">
  import {
    canUseLiveSockets,
    liveSocketsBlockedReason,
  } from '../lib/live/liveCapability';
  import {
    connectLive,
    disconnectLive,
    liveMode,
  } from '../lib/live/liveMode';
  import {
    DEFAULT_C15_HOST,
    liveSettings,
    setLiveHost,
    setLivePort,
    setUseDevProxy,
  } from '../lib/live/liveSettings';
  import { exportAllAsBackup, sessionDirty } from '../lib/model/bankStore';

  const socketsOk = canUseLiveSockets();
  const blockedReason = liveSocketsBlockedReason();

  let panelOpen = $state(false);
  let hostDraft = $state($liveSettings.host);
  let portDraft = $state(String($liveSettings.port));
  let confirmOpen = $state(false);

  const connection = $derived($liveMode.connection);
  const isBusy =
    $derived(connection === 'connecting' || connection === 'reconnecting');
  const isLive =
    $derived(connection === 'live' || connection === 'reconnecting');

  function statusLabel(): string {
    switch (connection) {
      case 'live':
        return 'LIVE';
      case 'connecting':
        return 'Connecting…';
      case 'reconnecting':
        return 'Reconnecting…';
      case 'error':
        return 'Live error';
      default:
        return 'Offline';
    }
  }

  function statusClass(): string {
    switch (connection) {
      case 'live':
        return 'border-emerald-600/80 bg-emerald-950/50 text-emerald-300';
      case 'connecting':
      case 'reconnecting':
        return 'border-amber-600/70 bg-amber-950/40 text-amber-200';
      case 'error':
        return 'border-red-600/70 bg-red-950/40 text-red-300';
      default:
        return 'border-c15-border bg-c15-surface-raised text-c15-text-muted';
    }
  }

  function applyDraftToSettings(): void {
    setLiveHost(hostDraft.trim() || DEFAULT_C15_HOST);
    const p = Number.parseInt(portDraft, 10);
    setLivePort(Number.isFinite(p) ? p : 8080);
  }

  function requestConnect(): void {
    if (!socketsOk) return;
    applyDraftToSettings();
    if ($sessionDirty) {
      confirmOpen = true;
      return;
    }
    doConnect();
  }

  function doConnect(): void {
    confirmOpen = false;
    connectLive();
    panelOpen = true;
  }

  function handleDisconnect(): void {
    confirmOpen = false;
    disconnectLive();
  }

  async function handleExportThenConnect(): Promise<void> {
    // Wait for export (and in-app name dialog) before replacing the canvas with Live.
    await exportAllAsBackup();
    doConnect();
  }

  function togglePanel(): void {
    if (!socketsOk) return;
    panelOpen = !panelOpen;
    if (panelOpen) {
      hostDraft = $liveSettings.host;
      portDraft = String($liveSettings.port);
    }
  }

  function closePanel(): void {
    panelOpen = false;
  }

  /** Close connection panel when clicking anywhere outside it (and its toolbar controls). */
  function onPanelOutsidePointerDown(event: PointerEvent): void {
    if (!panelOpen) return;
    // Leave open while the dirty-session confirm is up (it is outside this bar).
    if (confirmOpen) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-live-mode-bar]')) return;
    closePanel();
  }

  $effect(() => {
    if (!panelOpen) return;
    window.addEventListener('pointerdown', onPanelOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPanelOutsidePointerDown, true);
    };
  });
</script>

<div class="relative flex items-center gap-1.5" data-live-mode-bar>
  <button
    type="button"
    class="rounded border px-2.5 py-1.5 text-xs font-medium tracking-wide transition-colors {statusClass()}"
    class:opacity-50={!socketsOk}
    class:cursor-not-allowed={!socketsOk}
    title={socketsOk
      ? isLive
        ? ($liveMode.detail ?? 'Connected to C15')
        : 'Open Live mode connection panel'
      : (blockedReason ?? 'Live unavailable')}
    disabled={!socketsOk}
    onclick={togglePanel}
  >
    {statusLabel()}
  </button>

  {#if isLive || isBusy}
    <button
      type="button"
      class="rounded border border-c15-border bg-c15-surface-raised px-2 py-1.5 text-xs text-c15-text transition-colors hover:border-c15-accent hover:text-c15-accent"
      title="Disconnect from C15"
      onclick={handleDisconnect}
    >
      Disconnect
    </button>
  {/if}

  {#if panelOpen && socketsOk}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute right-0 top-full z-50 mt-1 w-80 rounded border border-c15-border bg-c15-surface p-3 shadow-lg"
      role="dialog"
      aria-label="Live mode connection"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closePanel();
      }}
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-c15-text">Live mode · C15 link</span>
        <button
          type="button"
          class="text-xs text-c15-text-muted hover:text-c15-text"
          onclick={closePanel}
        >
          Close
        </button>
      </div>

      <p class="mb-3 text-[11px] leading-snug text-c15-text-muted">
        Connect on C15 Wi‑Fi/LAN. Playground is authority: the canvas is replaced with the device
        library and stays two-way mirrored with NonMaps (layout RPCs land next). Export offline
        work first if you need it.
      </p>

      <label class="mb-2 block text-[11px] text-c15-text-muted">
        Host IP
        <input
          type="text"
          class="mt-0.5 w-full rounded border border-c15-border bg-c15-bg px-2 py-1 text-xs text-c15-text outline-none focus:border-c15-accent"
          bind:value={hostDraft}
          placeholder={DEFAULT_C15_HOST}
          disabled={isLive || isBusy}
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="mb-2 block text-[11px] text-c15-text-muted">
        Port
        <input
          type="text"
          class="mt-0.5 w-full rounded border border-c15-border bg-c15-bg px-2 py-1 text-xs text-c15-text outline-none focus:border-c15-accent"
          bind:value={portDraft}
          placeholder="8080"
          disabled={isLive || isBusy}
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      {#if import.meta.env.DEV}
        <label
          class="mb-3 flex cursor-pointer items-center gap-1.5 text-[11px] text-c15-text-muted"
          title="Route via Vite /c15-api proxy (set C15_HOST when starting dev server). Helps HTTP import; WebSocket can also use direct host."
        >
          <input
            type="checkbox"
            class="accent-c15-accent"
            checked={$liveSettings.useDevProxy}
            disabled={isLive || isBusy}
            onchange={(e) => setUseDevProxy(e.currentTarget.checked)}
          />
          Use Vite dev proxy (/c15-api)
        </label>
      {/if}

      {#if $liveMode.detail}
        <p
          class="mb-2 truncate text-[11px] {connection === 'error'
            ? 'text-red-400'
            : 'text-c15-text-muted'}"
          title={$liveMode.detail}
        >
          {$liveMode.detail}
        </p>
      {/if}

      {#if isLive}
        <p class="mb-2 text-[11px] text-c15-text-muted">
          {#if $liveMode.libraryReady}
            Library: {$liveMode.mirroredBankCount} bank{$liveMode.mirroredBankCount === 1
              ? ''
              : 's'}
            {#if $liveMode.lastRttMs != null}
              · ping ~{$liveMode.lastRttMs} ms
            {/if}
          {:else}
            Waiting for device library…
            {#if $liveMode.lastRttMs != null}
              · ping ~{$liveMode.lastRttMs} ms
            {/if}
          {/if}
        </p>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        {#if isLive || isBusy}
          <button
            type="button"
            class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text hover:border-c15-accent hover:text-c15-accent"
            onclick={handleDisconnect}
          >
            Disconnect
          </button>
        {:else}
          <button
            type="button"
            class="rounded border border-emerald-700/80 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:border-emerald-500"
            onclick={requestConnect}
          >
            Connect
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if confirmOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
    role="presentation"
    onclick={() => (confirmOpen = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirmOpen = false;
    }}
  >
    <div
      class="app-ui w-full max-w-md rounded border border-c15-border bg-c15-surface p-4 shadow-xl"
      role="dialog"
      aria-labelledby="live-dirty-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 id="live-dirty-title" class="mb-2 text-sm font-semibold text-c15-text">
        Unsaved offline session
      </h2>
      <p class="mb-4 text-xs leading-relaxed text-c15-text-muted">
        Connecting to Live replaces the canvas with the C15 device library and mirrors NonMaps
        in real time. Export your offline work first if you need it.
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="rounded border border-c15-border px-3 py-1.5 text-xs text-c15-text-muted hover:text-c15-text"
          onclick={() => (confirmOpen = false)}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded border border-c15-border bg-c15-surface-raised px-3 py-1.5 text-xs text-c15-text hover:border-c15-accent"
          onclick={handleExportThenConnect}
        >
          Export backup &amp; connect
        </button>
        <button
          type="button"
          class="rounded border border-amber-700/80 bg-amber-950/50 px-3 py-1.5 text-xs text-amber-100 hover:border-amber-500"
          onclick={doConnect}
        >
          Connect anyway
        </button>
      </div>
    </div>
  </div>
{/if}
