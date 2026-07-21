import type { ImportableFile } from '../io/folderPicker';
import type { BankLayoutMeta, FolderBankSort } from '../layout/smartLayout';
import {
  applyFolderChainLayout,
  entriesToBanks,
  parseContainingFolder,
  parseSubPath,
  type ImportedBankEntry,
} from '../layout/smartLayout';
import type { Bank } from '../types/bank';
import { parseFileBytes } from '../xml/parse';
import { remapIncomingAgainstSession } from './importMerge';


export type MassImportCanvasMode = 'replace' | 'merge';

export interface MassImportOptions {
  canvasMode: MassImportCanvasMode;
  showSynthZone: boolean;
  /** Default alphabetic; optional creation-date sort within each folder. */
  sortBy: FolderBankSort;
}

export interface MassImportResult {
  bankCount: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface MassImportPipelineResult {
  banks: Bank[];
  result: MassImportResult;
  /** Layout meta for imported banks only, keyed by final bank UUID. */
  layoutMeta: Map<string, BankLayoutMeta>;
}

async function parseAllEntries(
  files: ImportableFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ entries: ImportedBankEntry[]; errors: string[] }> {
  const entries: ImportedBankEntry[] = [];
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i]!;
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const doc = parseFileBytes(bytes, item.file.name);
      const containingFolder = parseContainingFolder(item.relativePath);
      const subPath = parseSubPath(item.relativePath);

      for (const bank of doc.banks) {
        entries.push({
          bank,
          meta: {
            containingFolder,
            subPath,
            layoutSide: 'left',
            sourceFile: item.file.name,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${item.relativePath}: ${message}`);
    }

    onProgress?.(i + 1, files.length);

    if (i % 8 === 7) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  return { entries, errors };
}

function remapMetaForIncoming(
  laidOut: ImportedBankEntry[],
  remappedIncoming: Bank[],
): Map<string, BankLayoutMeta> {
  const map = new Map<string, BankLayoutMeta>();
  for (let i = 0; i < remappedIncoming.length; i++) {
    const meta = laidOut[i]?.meta;
    const bank = remappedIncoming[i];
    if (meta && bank) {
      map.set(bank.uuid, meta);
    }
  }
  return map;
}

export async function runMassImportPipeline(
  files: ImportableFile[],
  options: MassImportOptions,
  existingBanks: Bank[],
  onProgress?: (done: number, total: number) => void,
): Promise<MassImportPipelineResult> {
  const { entries: rawEntries, errors } = await parseAllEntries(files, onProgress);

  const baseBanks = options.canvasMode === 'replace' ? [] : existingBanks;
  const laidOut = applyFolderChainLayout(rawEntries, { sortBy: options.sortBy }, baseBanks);

  const incoming = entriesToBanks(laidOut);
  const remapped = remapIncomingAgainstSession(baseBanks, incoming);
  const layoutMeta = remapMetaForIncoming(laidOut, remapped);
  const merged = options.canvasMode === 'replace' ? remapped : [...baseBanks, ...remapped];
  // Layout assigns fresh coordinates; import-heal would break folder-parent attachments.
  const healed = merged;

  return {
    banks: healed,
    layoutMeta,
    result: {
      bankCount: healed.length,
      succeeded: files.length - errors.length,
      failed: errors.length,
      errors,
    },
  };
}