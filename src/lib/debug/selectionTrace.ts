/**
 * Selection / marquee / bank-drag diagnostic trail.
 *
 * Filter console or downloaded debug log by the unique marker:
 *   C15-SELTRACE
 *
 * Enabled when app debug is on (Vite DEV, or localStorage c15-debug=1).
 */
import { get } from 'svelte/store';
import { bankMeta, banks } from '../model/bankState';
import { isAppDebugEnabled } from './debugFlags';
import { log } from './sessionLog';

/** Unique string for log search — do not rename without updating docs. */
export const SELTRACE_TAG = 'C15-SELTRACE';

let seq = 0;
let marqueeHoverSampleAt = 0;
const MARQUEE_HOVER_SAMPLE_MS = 80;

function nextSeq(): number {
  seq += 1;
  return seq;
}

function shortUuid(uuid: string | null | undefined): string {
  if (!uuid) return '∅';
  return uuid.length <= 8 ? uuid : `${uuid.slice(0, 8)}…`;
}

function bankLabel(uuid: string): string {
  const list = get(banks);
  const bank = list.find((b) => b.uuid === uuid);
  if (!bank) return shortUuid(uuid);
  return `${shortUuid(uuid)}("${bank.name}")`;
}

/** Compact selection snapshot for every SELTRACE line that needs context. */
export function selectionSnapshot(): Record<string, unknown> {
  const m = get(bankMeta);
  return {
    bankCount: m.selectedBankUuids.length,
    banks: m.selectedBankUuids.map(bankLabel),
    bankUuids: m.selectedBankUuids.map(shortUuid),
    deleteFocus: m.deleteFocus,
    selectionSurface: m.selectionSurface,
    presetBank: m.presetSelectionBankUuid
      ? bankLabel(m.presetSelectionBankUuid)
      : null,
    presetCount: m.selectedPresetUuids.length,
    presets: m.selectedPresetUuids.map(shortUuid),
    renamingBank: m.renamingBankUuid ? shortUuid(m.renamingBankUuid) : null,
    renamingPreset: m.renamingPreset
      ? {
          bank: shortUuid(m.renamingPreset.bankUuid),
          preset: shortUuid(m.renamingPreset.presetUuid),
        }
      : null,
  };
}

export type HitDescribe = {
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  dataAttrs?: Record<string, string>;
  text?: string;
  path?: string;
};

/** Describe the element under the cursor (and a short ancestor path). */
export function describeElementAtPoint(
  clientX: number,
  clientY: number,
): HitDescribe | null {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  return describeElement(el);
}

export function describeElement(el: Element | EventTarget | null): HitDescribe | null {
  if (!el || !(el instanceof Element)) return null;
  const html = el as HTMLElement;
  const dataAttrs: Record<string, string> = {};
  for (const attr of html.getAttributeNames?.() ?? []) {
    if (attr.startsWith('data-')) {
      dataAttrs[attr] = html.getAttribute(attr) ?? '';
    }
  }
  const text = (html.innerText ?? html.textContent ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 48);

  const pathParts: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; i < 6 && cur; i++) {
    const tag = cur.tagName.toLowerCase();
    const cls =
      typeof cur.className === 'string'
        ? cur.className
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .join('.')
        : '';
    const dataHint =
      cur.getAttribute('data-bank-header-drop') ||
      cur.getAttribute('data-canvas-background') ||
      cur.getAttribute('data-preset-comment') ||
      '';
    pathParts.push(
      cls
        ? `${tag}.${cls.slice(0, 40)}`
        : dataHint
          ? `${tag}[${dataHint.slice(0, 24)}]`
          : tag,
    );
    cur = cur.parentElement;
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: html.id || undefined,
    className:
      typeof html.className === 'string'
        ? html.className.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
        : undefined,
    role: html.getAttribute('role') ?? undefined,
    dataAttrs: Object.keys(dataAttrs).length > 0 ? dataAttrs : undefined,
    text: text || undefined,
    path: pathParts.join(' < '),
  };
}

export function classifyHit(hit: HitDescribe | null): string {
  if (!hit) return 'none';
  const d = hit.dataAttrs ?? {};
  if (d['data-canvas-background'] === 'true') return 'canvas-background';
  if (d['data-bank-header-drop']) return `bank-header(${shortUuid(d['data-bank-header-drop'])})`;
  if (d['data-preset-comment']) return 'preset-comment';
  if (hit.role === 'button' && hit.path?.includes('preset')) return 'preset-row?';
  if (hit.path?.includes('cursor-grab') || hit.path?.includes('bank-header'))
    return 'bank-header-ish';
  if (hit.text === '- empty -') return 'bank-empty-row';
  if (hit.path?.includes('bg-c15-preset') || hit.path?.includes('preset'))
    return 'preset-or-bank-body';
  if (hit.path?.includes('absolute') && hit.path?.includes('select-none'))
    return 'bank-card-shell';
  return `other(${hit.tag})`;
}

/**
 * Core trace logger. Always uses tag C15-SELTRACE in message + session step SELTRACE.
 */
export function selTrace(
  event: string,
  detail?: Record<string, unknown>,
): void {
  if (!isAppDebugEnabled()) return;
  const n = nextSeq();
  const payload = {
    n,
    event,
    ...detail,
  };
  // Session panel / downloadable log
  log('SELTRACE', `${SELTRACE_TAG} #${n} ${event}`, payload, 'debug');
  // Extra console line with bare tag for easy Ctrl+F (sessionLog already consoles too)
  console.log(SELTRACE_TAG, `#${n}`, event, payload);
}

export function selTraceSelection(
  event: string,
  detail?: Record<string, unknown>,
): void {
  selTrace(event, {
    ...detail,
    selection: selectionSnapshot(),
  });
}

/** Optional extras for pointer capture diagnostics (bank drag lifecycle). */
export type SelTracePointerExtras = {
  /** Element that should own capture (e.g. canvas root). */
  captureEl?: Element | null;
};

export function selTracePointer(
  event: string,
  pe: Pick<
    PointerEvent,
    | 'clientX'
    | 'clientY'
    | 'pointerId'
    | 'button'
    | 'buttons'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'type'
  > & {
    target?: EventTarget | null;
    pointerType?: string;
    isPrimary?: boolean;
    pressure?: number;
  },
  detail?: Record<string, unknown>,
  extras?: SelTracePointerExtras,
): void {
  const targetHit = describeElement(pe.target ?? null);
  const underCursor = describeElementAtPoint(pe.clientX, pe.clientY);
  const targetEl =
    pe.target instanceof Element ? pe.target : null;
  const captureEl = extras?.captureEl ?? null;
  let targetHasCapture: boolean | null = null;
  let captureElHasCapture: boolean | null = null;
  let captureElConnected: boolean | null = null;
  try {
    if (targetEl && 'hasPointerCapture' in targetEl) {
      targetHasCapture = (targetEl as Element).hasPointerCapture(pe.pointerId);
    }
    if (captureEl && 'hasPointerCapture' in captureEl) {
      captureElHasCapture = captureEl.hasPointerCapture(pe.pointerId);
      captureElConnected = captureEl.isConnected;
    }
  } catch {
    /* ignore */
  }
  selTraceSelection(event, {
    ...detail,
    pointer: {
      type: pe.type,
      pointerId: pe.pointerId,
      pointerType: pe.pointerType ?? null,
      isPrimary: pe.isPrimary ?? null,
      button: pe.button,
      buttons: pe.buttons ?? null,
      pressure: pe.pressure ?? null,
      clientX: Math.round(pe.clientX),
      clientY: Math.round(pe.clientY),
      ctrl: pe.ctrlKey,
      meta: pe.metaKey,
      shift: pe.shiftKey,
    },
    capture: {
      targetHasCapture,
      captureElHasCapture,
      captureElConnected,
      captureElTag:
        captureEl instanceof HTMLElement
          ? captureEl.tagName.toLowerCase()
          : captureEl
            ? 'element'
            : null,
    },
    eventTarget: targetHit,
    eventTargetClass: classifyHit(targetHit),
    underCursor,
    underCursorClass: classifyHit(underCursor),
  });
}

/** Throttled hover samples while marquee is active. */
export function selTraceMarqueeHover(
  clientX: number,
  clientY: number,
  extra?: Record<string, unknown>,
): void {
  if (!isAppDebugEnabled()) return;
  const now = performance.now();
  if (now - marqueeHoverSampleAt < MARQUEE_HOVER_SAMPLE_MS) return;
  marqueeHoverSampleAt = now;
  const underCursor = describeElementAtPoint(clientX, clientY);
  selTrace('marquee.hover', {
    clientX: Math.round(clientX),
    clientY: Math.round(clientY),
    underCursor,
    underCursorClass: classifyHit(underCursor),
    selection: selectionSnapshot(),
    ...extra,
  });
}

export function selTraceResetMarqueeHoverThrottle(): void {
  marqueeHoverSampleAt = 0;
}
