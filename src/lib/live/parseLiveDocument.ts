/**
 * Parse playground WebSocket `<nonlinear-world>` documents (live format).
 * Distinct from offline backup XML (`<bank>` / `attached-to-bank`).
 * @see docs/C15_LIVE_PROTOCOL.md
 * @see firmware Bank::writeDocument / Preset::writeDocument
 */

import type { AttachDirection, PresetType } from '../types/bank';

export interface LivePresetSnapshot {
  uuid: string;
  name: string;
  type: PresetType;
  changed: boolean;
  partIName: string;
  partIIName: string;
  hashtags: string;
  /** From live `<attribute key="…">` children (only when preset changed). */
  attributes: Record<string, string>;
}

export interface LiveBankSnapshot {
  uuid: string;
  name: string;
  x: number;
  y: number;
  selectedPreset: string;
  orderNumber: number;
  changed: boolean;
  attachedToUuid: string | null;
  attachDirection: AttachDirection | null;
  collapsed: boolean;
  dateOfLastChange: string;
  state: string;
  attributes: Record<string, string>;
  /**
   * Preset children when `changed` (full or partial per-preset).
   * `null` when the bank shell was sent with changed=0 (keep previous content).
   */
  presets: LivePresetSnapshot[] | null;
}

export interface LiveDocumentSnapshot {
  updateId: number | null;
  omitOracles: boolean;
  /** False when preset-manager section was unchanged for this client. */
  presetManagerChanged: boolean;
  banksSectionChanged: boolean;
  selectedBankUuid: string;
  selectedMidiBankUuid: string;
  /**
   * All banks currently on the device (shell or full), in device order.
   * `null` when the banks section was not present / not changed.
   */
  banks: LiveBankSnapshot[] | null;
}

/**
 * Device undo tip from Scope::writeDocument.
 * `present` false when this push omitted the undo section (unchanged for client).
 */
export interface DeviceUndoSnapshot {
  present: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Raw tip id ("0" when empty). */
  undoId: string;
  redoId: string;
}

/**
 * Parse playground `<undo><undo>…</undo><redo>…</redo>…</undo>`.
 * Nested same-name tags: match outer open then first text children.
 */
export function parseDeviceUndoSection(xml: string): DeviceUndoSnapshot {
  // Outer block: first <undo> that immediately contains child <undo> + <redo>
  const m = xml.match(
    /<undo\b[^>]*>\s*<undo\b[^>]*>([\s\S]*?)<\/undo>\s*<redo\b[^>]*>([\s\S]*?)<\/redo>/,
  );
  if (!m) {
    return { present: false, canUndo: false, canRedo: false, undoId: '', redoId: '' };
  }
  const undoId = decodeXmlEntities(m[1]!.trim());
  const redoId = decodeXmlEntities(m[2]!.trim());
  // Firmware writes "0" when canUndo is false; null redo → "0" via pointer stream.
  const canUndo = undoId !== '' && undoId !== '0';
  const canRedo = redoId !== '' && redoId !== '0';
  return { present: true, canUndo, canRedo, undoId, redoId };
}

const ATTACH_DIRECTIONS = new Set<AttachDirection>(['left', 'right', 'top', 'bottom']);

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrMap(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(openTag)) !== null) {
    attrs[m[1]!] = decodeXmlEntities(m[2]!);
  }
  return attrs;
}

function isChangedFlag(value: string | undefined): boolean {
  if (value == null) return false;
  return value === '1' || value === 'true' || value === 'True';
}

function extractTagInner(xml: string, tag: string): string | null {
  const open = xml.match(new RegExp(`<${tag}\\b([^>]*)>`));
  if (!open || open.index == null) return null;
  const start = open.index + open[0].length;
  if (open[0].endsWith('/>')) return '';
  const close = `</${tag}>`;
  const end = xml.indexOf(close, start);
  if (end === -1) return null;
  return xml.slice(start, end);
}

function extractTextChild(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]!.trim()) : '';
}

/** Live AttributesOwner: `<attribute key="k">v</attribute>` (not `name=`). */
function parseLiveAttributes(xml: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const re = /<attribute\b([^>]*)>([\s\S]*?)<\/attribute>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const openAttrs = parseAttrMap(m[1] ?? '');
    const key = openAttrs.key ?? openAttrs.name;
    if (!key) continue;
    attributes[key] = decodeXmlEntities(m[2]!.trim());
  }
  return attributes;
}

function parseAttachDirection(value: string): AttachDirection | null {
  if (!value) return null;
  if (ATTACH_DIRECTIONS.has(value as AttachDirection)) {
    return value as AttachDirection;
  }
  return null;
}

function parsePresetType(value: string): PresetType {
  if (value === 'Layer' || value === 'Split' || value === 'Single') return value;
  return 'Single';
}

/**
 * Extract top-level element slices matching `tag` from `xml` (non-nested siblings).
 * Returns open-tag + body for each match (self-closing included as open only).
 */
function extractElements(xml: string, tag: string): Array<{ open: string; body: string }> {
  const out: Array<{ open: string; body: string }> = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const open = m[0];
    const selfClosing = m[2] === '/' || open.endsWith('/>');
    if (selfClosing) {
      out.push({ open, body: '' });
      continue;
    }
    const start = m.index + open.length;
    const close = `</${tag}>`;
    const end = xml.indexOf(close, start);
    if (end === -1) {
      out.push({ open, body: '' });
      continue;
    }
    out.push({ open, body: xml.slice(start, end) });
    re.lastIndex = end + close.length;
  }
  return out;
}

function parseLivePreset(open: string, body: string): LivePresetSnapshot | null {
  const attrs = parseAttrMap(open);
  const uuid = attrs.uuid?.trim() ?? '';
  if (!uuid) return null;
  const changed = isChangedFlag(attrs.changed);
  return {
    uuid,
    name: attrs.name ?? '',
    type: parsePresetType(attrs.type ?? ''),
    changed,
    partIName: attrs['part-I-name'] ?? '',
    partIIName: attrs['part-II-name'] ?? '',
    hashtags: attrs.Hashtags ?? attrs.hashtags ?? '',
    attributes: changed ? parseLiveAttributes(body) : {},
  };
}

function parseLiveBank(open: string, body: string): LiveBankSnapshot | null {
  const attrs = parseAttrMap(open);
  const uuid = attrs.uuid?.trim() ?? '';
  if (!uuid) return null;

  const changed = isChangedFlag(attrs.changed);
  const x = Number.parseFloat(attrs.x ?? '0');
  const y = Number.parseFloat(attrs.y ?? '0');
  const orderNumber = Number.parseInt(attrs['order-number'] ?? '0', 10);

  let presets: LivePresetSnapshot[] | null = null;
  if (changed) {
    presets = extractElements(body, 'preset')
      .map(({ open: pOpen, body: pBody }) => parseLivePreset(pOpen, pBody))
      .filter((p): p is LivePresetSnapshot => p != null);
  }

  const attachedRaw = changed ? extractTextChild(body, 'attached-to').trim() : '';
  const dirRaw = changed ? extractTextChild(body, 'attached-direction').trim() : '';
  const collapsedRaw = changed ? extractTextChild(body, 'collapsed').trim() : '';

  return {
    uuid,
    name: attrs.name ?? 'Unnamed Bank',
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    selectedPreset: attrs['selected-preset'] ?? '',
    orderNumber: Number.isFinite(orderNumber) ? orderNumber : 0,
    changed,
    attachedToUuid: attachedRaw || null,
    attachDirection: parseAttachDirection(dirRaw),
    collapsed: collapsedRaw === 'true',
    dateOfLastChange: changed ? extractTextChild(body, 'date-of-last-change') : '',
    state: changed ? extractTextChild(body, 'state') : '',
    attributes: changed ? parseLiveAttributes(body) : {},
    presets,
  };
}

/**
 * Parse a full or partial playground document push.
 * Returns null if the payload is not a nonlinear-world document.
 */
export function parseLiveDocument(xml: string): LiveDocumentSnapshot | null {
  if (!xml.includes('<nonlinear-world')) return null;

  const worldOpen = xml.match(/<nonlinear-world\b([^>]*)>/);
  const worldAttrs = worldOpen ? parseAttrMap(worldOpen[1] ?? '') : {};
  const updateIdRaw = worldAttrs.updateID ?? worldAttrs.updateId;
  const updateId =
    updateIdRaw != null && updateIdRaw !== ''
      ? Number.parseInt(updateIdRaw, 10)
      : null;

  const omitOracles = isChangedFlag(worldAttrs['omit-oracles']);

  const pmMatch = xml.match(/<preset-manager\b([^>]*)>/);
  if (!pmMatch) {
    return {
      updateId: Number.isFinite(updateId as number) ? updateId : null,
      omitOracles,
      presetManagerChanged: false,
      banksSectionChanged: false,
      selectedBankUuid: '',
      selectedMidiBankUuid: '',
      banks: null,
    };
  }

  const pmAttrs = parseAttrMap(pmMatch[1] ?? '');
  const presetManagerChanged = isChangedFlag(pmAttrs.changed);

  if (!presetManagerChanged) {
    return {
      updateId: Number.isFinite(updateId as number) ? updateId : null,
      omitOracles,
      presetManagerChanged: false,
      banksSectionChanged: false,
      selectedBankUuid: '',
      selectedMidiBankUuid: '',
      banks: null,
    };
  }

  const pmInner = extractTagInner(xml, 'preset-manager');
  if (pmInner == null) {
    return {
      updateId: Number.isFinite(updateId as number) ? updateId : null,
      omitOracles,
      presetManagerChanged: true,
      banksSectionChanged: false,
      selectedBankUuid: '',
      selectedMidiBankUuid: '',
      banks: null,
    };
  }

  const banksOpen = pmInner.match(/<banks\b([^>]*)>/);
  if (!banksOpen) {
    return {
      updateId: Number.isFinite(updateId as number) ? updateId : null,
      omitOracles,
      presetManagerChanged: true,
      banksSectionChanged: false,
      selectedBankUuid: '',
      selectedMidiBankUuid: '',
      banks: null,
    };
  }

  const banksAttrs = parseAttrMap(banksOpen[1] ?? '');
  const banksSectionChanged = isChangedFlag(banksAttrs.changed);
  const selectedBankUuid = banksAttrs['selected-bank'] ?? '';
  const selectedMidiBankUuid = banksAttrs['selected-midi-bank'] ?? '';

  if (!banksSectionChanged) {
    return {
      updateId: Number.isFinite(updateId as number) ? updateId : null,
      omitOracles,
      presetManagerChanged: true,
      banksSectionChanged: false,
      selectedBankUuid,
      selectedMidiBankUuid,
      banks: null,
    };
  }

  const banksInner = extractTagInner(pmInner, 'banks') ?? '';
  const banks = extractElements(banksInner, 'preset-bank')
    .map(({ open, body }) => parseLiveBank(open, body))
    .filter((b): b is LiveBankSnapshot => b != null);

  // Device order = document order (order-number is 1-based display index).
  banks.sort((a, b) => a.orderNumber - b.orderNumber || a.name.localeCompare(b.name));

  return {
    updateId: Number.isFinite(updateId as number) ? updateId : null,
    omitOracles,
    presetManagerChanged: true,
    banksSectionChanged: true,
    selectedBankUuid,
    selectedMidiBankUuid,
    banks,
  };
}
