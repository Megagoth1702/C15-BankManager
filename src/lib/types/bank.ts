export type AttachDirection = 'left' | 'right' | 'top' | 'bottom';

export type PresetType = 'Single' | 'Layer' | 'Split';

export interface Preset {
  pos: number;
  uuid: string;
  name: string;
  type: PresetType;
  /** Cached from rawXml — search and UI only; export uses rawXml. */
  comment: string;
  deviceName: string;
  color: string;
  storeTime: string;
  /** Original <preset> XML block — preserved verbatim for lossless export. */
  rawXml: string;
}

export interface Bank {
  uuid: string;
  name: string;
  x: number;
  y: number;
  attachedToUuid: string | null;
  attachDirection: AttachDirection | null;
  presetOrder: string[];
  presets: Preset[];
  selectedPreset: string;
  bankSerializeDate: string;
  lastChangedTimestamp: number;
  attributes: Record<string, string>;
}

export type DocumentSource = 'preset-manager' | 'single-bank';

export interface PresetManagerDoc {
  version: 16;
  source: DocumentSource;
  serializeDate: string;
  selectedBankUuid: string;
  selectedMidiBankUuid: string;
  banks: Bank[];
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}