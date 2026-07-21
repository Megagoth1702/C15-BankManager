import type { ImportableFile } from '../io/folderPicker';
import {
  compareFoldersAlphabetic,
  parseContainingFolder,
  parseSubPath,
} from '../layout/smartLayout';
import { parseFileBytes } from '../xml/parse';

export interface ScanFileResult {
  relativePath: string;
  fileName: string;
  containingFolder: string;
  subPath: string;
  bankCount: number;
  presetCount: number;
  bankNames: string[];
  error: string | null;
}

export interface ScanGroupSummary {
  folder: string;
  fileCount: number;
  bankCount: number;
  presetCount: number;
}

export interface MassImportScanResult {
  files: ScanFileResult[];
  groups: ScanGroupSummary[];
  totalFiles: number;
  totalBanks: number;
  totalPresets: number;
  errorCount: number;
  folderLabel: string;
}

function summarizeGroups(files: ScanFileResult[]): ScanGroupSummary[] {
  const map = new Map<string, ScanGroupSummary>();

  for (const file of files) {
    if (file.error) continue;
    const existing = map.get(file.containingFolder);
    if (existing) {
      existing.fileCount++;
      existing.bankCount += file.bankCount;
      existing.presetCount += file.presetCount;
    } else {
      map.set(file.containingFolder, {
        folder: file.containingFolder,
        fileCount: 1,
        bankCount: file.bankCount,
        presetCount: file.presetCount,
      });
    }
  }

  return [...map.values()].sort((a, b) => compareFoldersAlphabetic(a.folder, b.folder));
}

export async function scanMassImport(
  files: ImportableFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<MassImportScanResult> {
  const results: ScanFileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const entry = files[i]!;
    const containingFolder = parseContainingFolder(entry.relativePath);
    const subPath = parseSubPath(entry.relativePath);

    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const doc = parseFileBytes(bytes, entry.file.name);
      const presetCount = doc.banks.reduce((sum, bank) => sum + bank.presets.length, 0);
      results.push({
        relativePath: entry.relativePath,
        fileName: entry.file.name,
        containingFolder,
        subPath,
        bankCount: doc.banks.length,
        presetCount,
        bankNames: doc.banks.map((b) => b.name),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        relativePath: entry.relativePath,
        fileName: entry.file.name,
        containingFolder,
        subPath,
        bankCount: 0,
        presetCount: 0,
        bankNames: [],
        error: message,
      });
    }

    onProgress?.(i + 1, files.length);

    if (i % 8 === 7) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  const ok = results.filter((r) => !r.error);
  const folderLabel = importRootLabel(files);

  return {
    files: results,
    groups: summarizeGroups(results),
    totalFiles: files.length,
    totalBanks: ok.reduce((sum, r) => sum + r.bankCount, 0),
    totalPresets: ok.reduce((sum, r) => sum + r.presetCount, 0),
    errorCount: results.filter((r) => r.error).length,
    folderLabel,
  };
}

function importRootLabel(files: ImportableFile[]): string {
  const first = files[0];
  if (!first) return 'folder';
  const segment = first.relativePath.split('/')[0];
  return segment || 'folder';
}