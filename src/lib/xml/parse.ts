import type { AttachDirection, Bank, Preset, PresetManagerDoc, PresetType } from '../types/bank';
import { ParseError } from '../types/bank';
import { decompressToString, isGzip } from './gzip';
import { getPresetAttributes } from './presetAttributes';

const BANK_BLOCK_RE = /<bank(?:\s+version="[^"]*")?>([\s\S]*?)<\/bank>/g;
const PRESET_BLOCK_RE = /<preset\s+pos="(\d+)">([\s\S]*?)<\/preset>/g;
const PRESET_ORDER_UUID_RE = /<uuid>([\s\S]*?)<\/uuid>/g;
const ATTRIBUTE_RE = /<attribute\s+name="([^"]+)">([\s\S]*?)<\/attribute>/g;

const ATTACH_DIRECTIONS = new Set<AttachDirection>(['left', 'right', 'top', 'bottom']);

function extractText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : '';
}

function extractBankBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(BANK_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function parseAttributes(bankXml: string): Record<string, string> {
  const attributesBlock = extractText(bankXml, 'attributes');
  if (!attributesBlock) return {};

  const attributes: Record<string, string> = {};
  const re = new RegExp(ATTRIBUTE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(attributesBlock)) !== null) {
    attributes[match[1]] = match[2].trim();
  }
  return attributes;
}

function parsePresetOrder(bankXml: string): string[] {
  const orderBlock = extractText(bankXml, 'preset-order');
  if (!orderBlock) return [];

  const order: string[] = [];
  const re = new RegExp(PRESET_ORDER_UUID_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(orderBlock)) !== null) {
    const uuid = match[1].trim();
    if (uuid) order.push(uuid);
  }
  return order;
}

function parsePresets(bankXml: string): Preset[] {
  const presets: Preset[] = [];
  const re = new RegExp(PRESET_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(bankXml)) !== null) {
    const inner = match[2];
    const type = extractText(inner, 'type') as PresetType;
    const rawXml = match[0];
    const meta = getPresetAttributes(rawXml);
    presets.push({
      pos: Number.parseInt(match[1], 10),
      uuid: extractText(inner, 'uuid'),
      name: extractText(inner, 'name'),
      type: type || 'Single',
      comment: meta.comment,
      deviceName: meta.deviceName,
      color: meta.color,
      storeTime: meta.storeTime,
      rawXml,
    });
  }

  return presets.sort((a, b) => a.pos - b.pos);
}

function parseAttachDirection(value: string): AttachDirection | null {
  if (!value) return null;
  if (ATTACH_DIRECTIONS.has(value as AttachDirection)) {
    return value as AttachDirection;
  }
  return null;
}

function parseBankBlock(bankXml: string): Bank {
  const name = extractText(bankXml, 'name');
  const uuid = extractText(bankXml, 'uuid');

  if (!uuid) {
    throw new ParseError('Bank is missing required <uuid>');
  }

  const x = Number.parseFloat(extractText(bankXml, 'x'));
  const y = Number.parseFloat(extractText(bankXml, 'y'));
  const attachedRaw = extractText(bankXml, 'attached-to-bank');
  const timestampRaw = extractText(bankXml, 'last-changed-timestamp');

  return {
    uuid,
    name: name || 'Unnamed Bank',
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    attachedToUuid: attachedRaw || null,
    attachDirection: parseAttachDirection(extractText(bankXml, 'attach-direction')),
    presetOrder: parsePresetOrder(bankXml),
    presets: parsePresets(bankXml),
    selectedPreset: extractText(bankXml, 'selected-preset'),
    bankSerializeDate: extractText(bankXml, 'bank-serialize-date'),
    lastChangedTimestamp: Number.parseInt(timestampRaw, 10) || 0,
    attributes: parseAttributes(bankXml),
  };
}

export function decodeXmlFromBytes(bytes: Uint8Array, filename: string): string {
  if (filename.endsWith('.nlbackup') || isGzip(bytes)) {
    return decompressToString(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function parsePresetManagerXml(xml: string): PresetManagerDoc {
  if (!xml.includes('<preset-manager')) {
    throw new ParseError('Expected <preset-manager> root element');
  }

  const versionMatch = xml.match(/<preset-manager\s+version="(\d+)"/);
  const version = Number.parseInt(versionMatch?.[1] ?? '16', 10);
  if (version !== 16) {
    throw new ParseError(`Unsupported preset-manager version: ${version}`);
  }

  const bankBlocks = extractBankBlocks(xml);
  if (bankBlocks.length === 0) {
    throw new ParseError('No <bank> elements found in preset-manager');
  }

  return {
    version: 16,
    source: 'preset-manager',
    serializeDate: extractText(xml, 'serialize-date'),
    selectedBankUuid: extractText(xml, 'selected-bank-uuid'),
    selectedMidiBankUuid: extractText(xml, 'selected-midi-bank-uuid'),
    banks: bankBlocks.map(parseBankBlock),
  };
}

export function parseSingleBankXml(xml: string): Bank {
  const bankBlocks = extractBankBlocks(xml);
  if (bankBlocks.length !== 1) {
    throw new ParseError('Expected exactly one <bank> element');
  }
  return parseBankBlock(bankBlocks[0]);
}

export function parseXmlDocument(xml: string): PresetManagerDoc {
  if (xml.includes('<preset-manager')) {
    return parsePresetManagerXml(xml);
  }

  if (/<bank(?:\s+version="[^"]*")?>/.test(xml)) {
    const bank = parseSingleBankXml(xml);
    return {
      version: 16,
      source: 'single-bank',
      serializeDate: new Date().toISOString(),
      selectedBankUuid: bank.uuid,
      selectedMidiBankUuid: '',
      banks: [bank],
    };
  }

  throw new ParseError('Unrecognized XML format — expected preset-manager or bank root');
}

export function parseFileBytes(bytes: Uint8Array, filename: string): PresetManagerDoc {
  const xml = decodeXmlFromBytes(bytes, filename);
  return parseXmlDocument(xml);
}

/** Log parsed bank summary to the console (Bucket 1 debug helper). */
export function logParseSummary(doc: PresetManagerDoc, filename: string): void {
  console.group(`[C15 Parse] ${filename} — ${doc.banks.length} banks`);
  for (const bank of doc.banks) {
    const attach = bank.attachDirection
      ? `${bank.attachDirection} → ${bank.attachedToUuid?.slice(0, 8)}…`
      : 'none';
    console.log(
      `  ${bank.name}: (${bank.x}, ${bank.y}) attach=${attach} presets=${bank.presets.length} rawXml preserved=${bank.presets.every((p) => p.rawXml.length > 0)}`,
    );
  }
  console.groupEnd();
}