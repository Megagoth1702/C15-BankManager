import { BANK_LAYOUT } from '../canvas/geometry';
import type { Bank } from '../types/bank';
import { c15RandomUuid } from '../uuid/c15Uuid';

export function createEmptyBank(name: string, x: number, y: number): Bank {
  return {
    uuid: c15RandomUuid(),
    name,
    x,
    y,
    attachedToUuid: null,
    attachDirection: null,
    presetOrder: [],
    presets: [],
    selectedPreset: '',
    bankSerializeDate: '',
    lastChangedTimestamp: Math.floor(Date.now() / 1000),
    attributes: {},
  };
}

export function snapToGrid(value: number): number {
  const grid = BANK_LAYOUT.snapGrid;
  return Math.round(value / grid) * grid;
}

export function nextDefaultBankName(banks: Bank[]): string {
  const base = 'New Bank';
  if (!banks.some((bank) => bank.name === base)) return base;
  let index = 2;
  while (banks.some((bank) => bank.name === `${base} ${index}`)) {
    index++;
  }
  return `${base} ${index}`;
}