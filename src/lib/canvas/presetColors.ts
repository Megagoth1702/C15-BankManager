import { getPresetAttributes, type PresetColorName } from '../xml/presetAttributes';

/** C15 preset color tags — matches NonMaps `ColorTag.Color.toRGB()`. */
const PRESET_TAG_COLORS: Record<string, string> = {
  green: '#52AD45',
  blue: '#4B69D5',
  yellow: '#CCC536',
  orange: '#DD9537',
  purple: '#B75FAE',
  red: '#CF2B3B',
};

export const PRESET_COLOR_RGB: Record<PresetColorName, string | null> = {
  green: PRESET_TAG_COLORS.green,
  blue: PRESET_TAG_COLORS.blue,
  yellow: PRESET_TAG_COLORS.yellow,
  orange: PRESET_TAG_COLORS.orange,
  purple: PRESET_TAG_COLORS.purple,
  red: PRESET_TAG_COLORS.red,
  none: null,
};

/** Parse preset `color` attribute from preserved raw XML. */
export function presetColorFromRawXml(rawXml: string): string | null {
  const color = getPresetAttributes(rawXml).color;
  if (!color || color === 'none') return null;
  return PRESET_TAG_RGB(color);
}

export function presetColorFromName(color: string): string | null {
  if (!color || color === 'none') return null;
  return PRESET_TAG_COLORS[color] ?? null;
}

function PRESET_TAG_RGB(color: PresetColorName): string | null {
  if (color === 'none') return null;
  return PRESET_TAG_COLORS[color] ?? null;
}