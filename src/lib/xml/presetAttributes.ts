const ATTRIBUTE_BLOCK_RE = /<attributes>([\s\S]*?)<\/attributes>/;
const ATTRIBUTE_RE = /<attribute\s+name="([^"]+)">([\s\S]*?)<\/attribute>/g;
const NAME_RE = /<name>([\s\S]*?)<\/name>/;

export const PRESET_COLOR_NAMES = [
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'red',
  'none',
] as const;

export type PresetColorName = (typeof PRESET_COLOR_NAMES)[number];

export interface PresetMetadata {
  comment: string;
  deviceName: string;
  color: PresetColorName | '';
  storeTime: string;
}

const EMPTY_METADATA: PresetMetadata = {
  comment: '',
  deviceName: '',
  color: '',
  storeTime: '',
};

function parseAttributeBlock(block: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const re = new RegExp(ATTRIBUTE_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    attributes[match[1]] = match[2].trim();
  }
  return attributes;
}

export function getPresetAttributes(rawXml: string): PresetMetadata {
  const blockMatch = rawXml.match(ATTRIBUTE_BLOCK_RE);
  if (!blockMatch) return { ...EMPTY_METADATA };

  const attrs = parseAttributeBlock(blockMatch[1]);
  const colorRaw = attrs.color ?? '';
  const color = PRESET_COLOR_NAMES.includes(colorRaw as PresetColorName)
    ? (colorRaw as PresetColorName)
    : '';

  return {
    comment: attrs.Comment ?? '',
    deviceName: attrs.DeviceName ?? '',
    color,
    storeTime: attrs.StoreTime ?? '',
  };
}

function upsertAttributeBlock(rawXml: string, key: string, value: string): string {
  const blockMatch = rawXml.match(ATTRIBUTE_BLOCK_RE);
  if (blockMatch) {
    const block = blockMatch[1];
    const attrRe = new RegExp(
      `<attribute\\s+name="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?<\\/attribute>`,
    );
    const line = `   <attribute name="${key}">${value}</attribute>`;
    if (attrRe.test(block)) {
      const updatedBlock = block.replace(attrRe, line);
      return rawXml.replace(ATTRIBUTE_BLOCK_RE, `<attributes>${updatedBlock}</attributes>`);
    }
    const insert = `${block.trimEnd()}\n${line}\n`;
    return rawXml.replace(ATTRIBUTE_BLOCK_RE, `<attributes>${insert}</attributes>`);
  }

  const closeIdx = rawXml.lastIndexOf('</preset>');
  if (closeIdx === -1) return rawXml;
  const insertion = `  <attributes>\n   <attribute name="${key}">${value}</attribute>\n  </attributes>\n `;
  return rawXml.slice(0, closeIdx) + insertion + rawXml.slice(closeIdx);
}

export function patchPresetName(rawXml: string, name: string): string {
  if (NAME_RE.test(rawXml)) {
    return rawXml.replace(NAME_RE, `<name>${name}</name>`);
  }
  return rawXml;
}

export function patchPresetAttribute(rawXml: string, key: string, value: string): string {
  return upsertAttributeBlock(rawXml, key, value);
}

export function patchPresetMetadata(
  rawXml: string,
  patch: Partial<{ name: string; comment: string; deviceName: string; color: PresetColorName }>,
): string {
  let next = rawXml;
  if (patch.name !== undefined) next = patchPresetName(next, patch.name);
  if (patch.comment !== undefined) next = patchPresetAttribute(next, 'Comment', patch.comment);
  if (patch.deviceName !== undefined) next = patchPresetAttribute(next, 'DeviceName', patch.deviceName);
  if (patch.color !== undefined) next = patchPresetAttribute(next, 'color', patch.color);
  return next;
}