import {
  attachDirectionForC15,
  formatCoordForC15Xml,
  formatLastChangedTimestamp,
  serializeAttachmentFields,
} from './c15XmlFormat';
import type { Bank } from '../types/bank';

export interface SerializePresetManagerInput {
  banks: Bank[];
  serializeDate?: string;
  selectedBankUuid?: string;
  selectedMidiBankUuid?: string;
}

export interface SerializeSingleBankOptions {
  /** Override serialize date (default: now, ISO without ms). */
  serializeDate?: string;
  /**
   * Attribute values merged over `bank.attributes` for this write only
   * (e.g. Date/Name of Export File). Does not mutate the bank.
   */
  attributeOverrides?: Record<string, string>;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlAttr(text: string): string {
  return escapeXml(text);
}

/** ISO timestamp without fractional seconds — matches C15 backup format. */
export function formatSerializeDate(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function presetByUuid(bank: Bank, uuid: string) {
  const needle = uuid.toLowerCase();
  return bank.presets.find((preset) => preset.uuid.toLowerCase() === needle);
}

/**
 * C15 load fills bank slots by `<preset pos="N">` (see PresetBankSerializer).
 * After reorder/sort, `preset-order` alone is not enough — pos must match the
 * new slot index or the hardware restores the old content order.
 */
export function rewritePresetPos(rawXml: string, pos: number): string {
  if (/<preset\s+pos="\d+"/.test(rawXml)) {
    return rawXml.replace(/<preset\s+pos="\d+"/, `<preset pos="${pos}"`);
  }
  if (/<preset\b/.test(rawXml)) {
    return rawXml.replace(/<preset\b/, `<preset pos="${pos}"`);
  }
  return rawXml;
}

function serializePresetBlocks(bank: Bank): string[] {
  const lines: string[] = [];
  const emitted = new Set<string>();

  bank.presetOrder.forEach((uuid, index) => {
    const preset = presetByUuid(bank, uuid);
    if (!preset?.rawXml) return;
    emitted.add(preset.uuid.toLowerCase());
    // Always renumber pos to match preset-order index (C15 + lossless re-import).
    const rawXml = rewritePresetPos(preset.rawXml, index);
    for (const line of rawXml.split(/\r?\n/)) {
      lines.push(line);
    }
  });

  let orphanPos = bank.presetOrder.length;
  for (const preset of bank.presets) {
    if (emitted.has(preset.uuid.toLowerCase()) || !preset.rawXml) continue;
    const rawXml = rewritePresetPos(preset.rawXml, orphanPos++);
    for (const line of rawXml.split(/\r?\n/)) {
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Serialize one bank's body fields + presets.
 * @param contentIndent Number of spaces for direct children of `<bank>`.
 * @param attributes Effective attribute map for this write.
 */
function serializeBankBody(
  bank: Bank,
  serializeDate: string,
  contentIndent: number,
  attributes: Record<string, string>,
): string[] {
  const pad = ' '.repeat(contentIndent);
  const padChild = ' '.repeat(contentIndent + 1);
  const lines: string[] = [];
  const attachment = serializeAttachmentFields(bank);

  lines.push(`${pad}<bank-serialize-date>${bank.bankSerializeDate || serializeDate}</bank-serialize-date>`);
  lines.push(`${pad}<name>${escapeXml(bank.name)}</name>`);
  lines.push(`${pad}<uuid>${bank.uuid}</uuid>`);
  lines.push(`${pad}<x>${formatCoordForC15Xml(bank.x)}</x>`);
  lines.push(`${pad}<y>${formatCoordForC15Xml(bank.y)}</y>`);
  lines.push(`${pad}<selected-preset>${bank.selectedPreset}</selected-preset>`);
  lines.push(`${pad}<attached-to-bank>${attachment.attachedToUuid}</attached-to-bank>`);
  lines.push(`${pad}<attach-direction>${attachment.attachDirection}</attach-direction>`);
  lines.push(`${pad}<preset-order>`);
  for (const uuid of bank.presetOrder) {
    lines.push(`${padChild}<uuid>${uuid}</uuid>`);
  }
  lines.push(`${pad}</preset-order>`);
  lines.push(`${pad}<attributes>`);
  for (const [name, value] of Object.entries(attributes)) {
    lines.push(
      `${padChild}<attribute name="${escapeXmlAttr(name)}">${escapeXml(value)}</attribute>`,
    );
  }
  lines.push(`${pad}</attributes>`);
  lines.push(
    `${pad}<last-changed-timestamp>${formatLastChangedTimestamp(bank.lastChangedTimestamp)}</last-changed-timestamp>`,
  );

  for (const presetLine of serializePresetBlocks(bank)) {
    lines.push(presetLine);
  }

  return lines;
}

/** Nested bank under `<preset-manager>` (no version attr; 1-space outer indent). */
function serializeNestedBank(bank: Bank, serializeDate: string): string {
  const lines: string[] = [];
  lines.push(' <bank>');
  lines.push(...serializeBankBody(bank, serializeDate, 2, bank.attributes));
  lines.push(' </bank>');
  return lines.join('\n');
}

/**
 * Build a C15 single-bank export document: plain UTF-8 XML, root `<bank version="16">`.
 * Exactly one bank — never wraps in `<preset-manager>`.
 */
export function serializeSingleBankXml(
  bank: Bank,
  options: SerializeSingleBankOptions = {},
): string {
  const serializeDate = options.serializeDate ?? formatSerializeDate();
  const attributes = options.attributeOverrides
    ? { ...bank.attributes, ...options.attributeOverrides }
    : bank.attributes;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><bank version="16">',
    ...serializeBankBody(bank, serializeDate, 1, attributes),
    '</bank>',
  ];
  return `${lines.join('\n')}\n`;
}

/** Build decompressed `<preset-manager>` XML from in-memory banks. */
export function serializePresetManagerXml(input: SerializePresetManagerInput): string {
  const { banks } = input;
  if (banks.length === 0) {
    throw new Error('Cannot serialize an empty bank list');
  }

  const serializeDate = input.serializeDate ?? formatSerializeDate();
  const selectedBankUuid =
    input.selectedBankUuid && banks.some((bank) => bank.uuid === input.selectedBankUuid)
      ? input.selectedBankUuid
      : banks[0]!.uuid;
  const selectedMidiBankUuid = input.selectedMidiBankUuid ?? '';

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><preset-manager version="16">',
    ` <serialize-date>${serializeDate}</serialize-date>`,
    ` <selected-bank-uuid>${selectedBankUuid}</selected-bank-uuid>`,
    ` <selected-midi-bank-uuid>${selectedMidiBankUuid}</selected-midi-bank-uuid>`,
  ];

  for (const bank of banks) {
    lines.push(serializeNestedBank(bank, serializeDate));
  }

  lines.push('</preset-manager>');
  return `${lines.join('\n')}\n`;
}

export {
  attachDirectionForC15,
  detachOrphanAttachmentsForExport,
  validateBanksForC15Export,
} from './c15XmlFormat';
