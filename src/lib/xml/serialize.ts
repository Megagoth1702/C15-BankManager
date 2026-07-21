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

function serializePresetBlocks(bank: Bank): string[] {
  const lines: string[] = [];
  const emitted = new Set<string>();

  for (const uuid of bank.presetOrder) {
    const preset = presetByUuid(bank, uuid);
    if (!preset?.rawXml) continue;
    emitted.add(preset.uuid.toLowerCase());
    for (const line of preset.rawXml.split(/\r?\n/)) {
      lines.push(line);
    }
  }

  for (const preset of bank.presets) {
    if (emitted.has(preset.uuid.toLowerCase()) || !preset.rawXml) continue;
    for (const line of preset.rawXml.split(/\r?\n/)) {
      lines.push(line);
    }
  }

  return lines;
}

function serializeBank(bank: Bank, serializeDate: string): string {
  const lines: string[] = [];
  const attachment = serializeAttachmentFields(bank);

  lines.push(' <bank>');
  lines.push(`  <bank-serialize-date>${bank.bankSerializeDate || serializeDate}</bank-serialize-date>`);
  lines.push(`  <name>${escapeXml(bank.name)}</name>`);
  lines.push(`  <uuid>${bank.uuid}</uuid>`);
  lines.push(`  <x>${formatCoordForC15Xml(bank.x)}</x>`);
  lines.push(`  <y>${formatCoordForC15Xml(bank.y)}</y>`);
  lines.push(`  <selected-preset>${bank.selectedPreset}</selected-preset>`);
  lines.push(`  <attached-to-bank>${attachment.attachedToUuid}</attached-to-bank>`);
  lines.push(`  <attach-direction>${attachment.attachDirection}</attach-direction>`);
  lines.push('  <preset-order>');
  for (const uuid of bank.presetOrder) {
    lines.push(`   <uuid>${uuid}</uuid>`);
  }
  lines.push('  </preset-order>');
  lines.push('  <attributes>');
  for (const [name, value] of Object.entries(bank.attributes)) {
    lines.push(
      `   <attribute name="${escapeXmlAttr(name)}">${escapeXml(value)}</attribute>`,
    );
  }
  lines.push('  </attributes>');
  lines.push(
    `  <last-changed-timestamp>${formatLastChangedTimestamp(bank.lastChangedTimestamp)}</last-changed-timestamp>`,
  );

  for (const presetLine of serializePresetBlocks(bank)) {
    lines.push(presetLine);
  }

  lines.push(' </bank>');
  return lines.join('\n');
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
    lines.push(serializeBank(bank, serializeDate));
  }

  lines.push('</preset-manager>');
  return `${lines.join('\n')}\n`;
}

export { attachDirectionForC15, validateBanksForC15Export } from './c15XmlFormat';