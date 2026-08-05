import { bankOuterHeight, bankOuterWidth } from '../canvas/geometry';
import { getLogEntries, log } from '../debug/sessionLog';
import type { Bank } from '../types/bank';
import {
  bankToC15Rect,
  bboxFromBanks,
  getGridBounds,
  getSynthNoGoRect,
  LAYOUT_BANDS,
  rectOverlapsNoGo,
  rectsOverlap,
  type ClusterBbox,
} from './noGoZones';
import type { BankLayoutMeta, FolderBankSort, LayoutSide } from './smartLayout';
import { compareFoldersAlphabetic, isFolderParentBank } from './smartLayout';

export interface LayoutReportBank {
  name: string;
  uuid: string;
  x: number;
  y: number;
  width: number;
  height: number;
  presetCount: number;
  attachedToUuid: string | null;
  attachDirection: string | null;
  parentName: string | null;
  sourceFile: string;
  containingFolder: string;
  isFolderParent: boolean;
}

export interface LayoutReportGroup {
  folder: string;
  layoutSide: LayoutSide;
  bankCount: number;
  presetCount: number;
  bbox: ClusterBbox | null;
  banks: LayoutReportBank[];
  warnings: string[];
}

export interface FolderSeparation {
  upperFolder: string;
  lowerFolder: string;
  gapY: number;
}

export interface LayoutImportReport {
  sortBy: FolderBankSort;
  totalBanks: number;
  totalPresets: number;
  canvasBbox: ClusterBbox | null;
  synthNoGo: ReturnType<typeof getSynthNoGoRect>;
  groups: LayoutReportGroup[];
  folderSeparations: FolderSeparation[];
  globalWarnings: string[];
}

function groupBanksByFolder(
  banks: Bank[],
  metaMap: Map<string, BankLayoutMeta>,
): Map<string, { layoutSide: LayoutSide; banks: Bank[] }> {
  const groups = new Map<string, { layoutSide: LayoutSide; banks: Bank[] }>();

  for (const bank of banks) {
    const meta = metaMap.get(bank.uuid);
    // Prefer packing key so multi-bank backups report as separate clusters.
    const folder = meta?.layoutClusterKey ?? meta?.containingFolder ?? '(unknown)';
    const layoutSide = meta?.layoutSide ?? 'left';
    const existing = groups.get(folder);
    if (existing) {
      existing.banks.push(bank);
    } else {
      groups.set(folder, { layoutSide, banks: [bank] });
    }
  }

  return groups;
}

function areAdjacentChainPair(a: Bank, b: Bank): boolean {
  return a.attachedToUuid === b.uuid || b.attachedToUuid === a.uuid;
}

function detectIntraGroupOverlaps(banks: Bank[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < banks.length; i++) {
    const rectA = bankToC15Rect(banks[i]!);
    for (let j = i + 1; j < banks.length; j++) {
      const bankA = banks[i]!;
      const bankB = banks[j]!;
      const margin = areAdjacentChainPair(bankA, bankB) ? 0 : 15;
      const rectB = bankToC15Rect(bankB);
      if (rectsOverlap(rectA, rectB, margin)) {
        warnings.push(`Overlap: "${bankA.name}" and "${bankB.name}"`);
      }
    }
  }
  return warnings;
}

function detectCrossFolderOverlaps(groups: LayoutReportGroup[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const groupA = groups[i]!;
      const groupB = groups[j]!;
      for (const bankA of groupA.banks) {
        for (const bankB of groupB.banks) {
          const rectA = {
            x: bankA.x,
            y: bankA.y,
            width: bankA.width,
            height: bankA.height,
          };
          const rectB = {
            x: bankB.x,
            y: bankB.y,
            width: bankB.width,
            height: bankB.height,
          };
          if (rectsOverlap(rectA, rectB, 30)) {
            warnings.push(
              `Cross-folder overlap: "${groupA.folder}/${bankA.name}" vs "${groupB.folder}/${bankB.name}"`,
            );
          }
        }
      }
    }
  }
  return warnings;
}

function computeFolderSeparations(groups: LayoutReportGroup[]): FolderSeparation[] {
  const separations: FolderSeparation[] = [];

  for (const side of ['left', 'bottom', 'right'] as LayoutSide[]) {
    const onSide = groups
      .filter((g) => g.layoutSide === side && g.bbox)
      .sort((a, b) => a.bbox!.minY - b.bbox!.minY);

    for (let i = 0; i < onSide.length - 1; i++) {
      const upper = onSide[i]!;
      const lower = onSide[i + 1]!;
      separations.push({
        upperFolder: upper.folder,
        lowerFolder: lower.folder,
        gapY: lower.bbox!.minY - upper.bbox!.maxY,
      });
    }
  }

  return separations;
}

function sortBanksForLog(banks: LayoutReportBank[]): LayoutReportBank[] {
  return [...banks].sort((a, b) => {
    if (a.isFolderParent !== b.isFolderParent) return a.isFolderParent ? -1 : 1;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

export function buildLayoutImportReport(
  banks: Bank[],
  metaMap: Map<string, BankLayoutMeta>,
  sortBy: FolderBankSort,
): LayoutImportReport {
  const grouped = groupBanksByFolder(banks, metaMap);
  const groups: LayoutReportGroup[] = [];
  let totalPresets = 0;

  const nameByUuid = new Map(banks.map((b) => [b.uuid, b.name]));

  for (const [folder, { layoutSide, banks: groupBanks }] of [...grouped.entries()].sort(
    (a, b) => compareFoldersAlphabetic(a[0], b[0]),
  )) {
    const bbox = bboxFromBanks(groupBanks);
    const presetCount = groupBanks.reduce((sum, b) => sum + b.presets.length, 0);
    totalPresets += presetCount;

    const warnings = detectIntraGroupOverlaps(groupBanks);
    for (const bank of groupBanks) {
      if (rectOverlapsNoGo(bankToC15Rect(bank))) {
        warnings.push(`No-go overlap: "${bank.name}" at (${bank.x}, ${bank.y})`);
      }
    }

    groups.push({
      folder,
      layoutSide,
      bankCount: groupBanks.length,
      presetCount,
      bbox,
      banks: groupBanks.map((bank) => ({
        name: bank.name,
        uuid: bank.uuid,
        x: bank.x,
        y: bank.y,
        width: bankOuterWidth(),
        height: bankOuterHeight(bank),
        presetCount: bank.presets.length,
        attachedToUuid: bank.attachedToUuid,
        attachDirection: bank.attachDirection,
        parentName: bank.attachedToUuid
          ? (nameByUuid.get(bank.attachedToUuid) ?? bank.attachedToUuid.slice(0, 8))
          : null,
        sourceFile: metaMap.get(bank.uuid)?.sourceFile ?? '',
        containingFolder: metaMap.get(bank.uuid)?.containingFolder ?? folder,
        isFolderParent: isFolderParentBank(bank),
      })),
      warnings,
    });
  }

  const globalWarnings = detectCrossFolderOverlaps(groups);
  const folderSeparations = computeFolderSeparations(groups);

  for (const sep of folderSeparations) {
    if (sep.gapY < LAYOUT_BANDS.rowGap - 60) {
      globalWarnings.push(
        `Tight folder gap (${Math.round(sep.gapY)} C15): "${sep.upperFolder}" → "${sep.lowerFolder}"`,
      );
    }
  }

  return {
    sortBy,
    totalBanks: banks.length,
    totalPresets,
    canvasBbox: bboxFromBanks(banks),
    synthNoGo: getSynthNoGoRect(),
    groups,
    folderSeparations,
    globalWarnings,
  };
}

function formatBbox(bbox: ClusterBbox | null): string {
  if (!bbox) return 'empty';
  return `min=(${bbox.minX}, ${bbox.minY}) max=(${bbox.maxX}, ${bbox.maxY}) size=${Math.round(bbox.width)}×${Math.round(bbox.height)}`;
}

function formatBankLine(bank: LayoutReportBank, isFolderParent = false): string {
  const attach = bank.parentName
    ? `${bank.attachDirection}→${bank.parentName}`
    : 'root';
  return [
    `folder=${bank.containingFolder}`,
    `name=${bank.name}`,
    ...(isFolderParent ? ['kind=folder-parent'] : []),
    `x=${bank.x}`,
    `y=${bank.y}`,
    `size=${bank.width}×${bank.height}`,
    `presets=${bank.presetCount}`,
    `attach=${attach}`,
    `file=${bank.sourceFile}`,
    `uuid=${bank.uuid}`,
  ].join(' | ');
}

/** Write a full layout snapshot to the session log (downloadable via Debug log panel). */
export function logLayoutImportReport(report: LayoutImportReport): void {
  log('import-layout', '========== MASS IMPORT LAYOUT REPORT BEGIN ==========');

  log('import-layout', 'Summary', {
    sortBy: report.sortBy,
    totalBanks: report.totalBanks,
    totalPresets: report.totalPresets,
    groupCount: report.groups.length,
    canvasBbox: formatBbox(report.canvasBbox),
    layoutConstants: LAYOUT_BANDS,
    gridBounds: getGridBounds(),
    synthNoGo: report.synthNoGo,
  });

  for (const group of report.groups) {
    log('import-layout', `GROUP ${group.folder}`, {
      side: group.layoutSide,
      banks: group.bankCount,
      presets: group.presetCount,
      bbox: formatBbox(group.bbox),
      warningCount: group.warnings.length,
    });

    for (const bank of sortBanksForLog(group.banks)) {
      log('import-layout', 'BANK', formatBankLine(bank, bank.isFolderParent));
    }

    for (const warning of group.warnings) {
      log('import-layout', `WARN [${group.folder}]`, warning, 'warn');
    }
  }

  log('import-layout', 'Folder vertical separations (stack order by minY)', {
    count: report.folderSeparations.length,
    expectedGap: LAYOUT_BANDS.rowGap,
  });

  for (const sep of report.folderSeparations) {
    log('import-layout', 'FOLDER_GAP', {
      from: sep.upperFolder,
      to: sep.lowerFolder,
      gapY: Math.round(sep.gapY),
    });
  }

  for (const warning of report.globalWarnings) {
    log('import-layout', 'GLOBAL_WARN', warning, 'warn');
  }

  log('import-layout', '========== MASS IMPORT LAYOUT REPORT END ==========');

  console.group('[C15 mass-import layout]');
  console.log(
    `Sort: ${report.sortBy} · ${report.totalBanks} banks · ${report.totalPresets} presets · ${report.groups.length} groups`,
  );
  console.log('Canvas bbox:', report.canvasBbox);
  for (const group of report.groups) {
    console.groupCollapsed(`${group.folder} — ${group.bankCount} banks — ${formatBbox(group.bbox)}`);
    console.table(
      sortBanksForLog(group.banks).map((b) => ({
        name: b.name,
        kind: b.isFolderParent ? 'folder-parent' : 'content',
        x: b.x,
        y: b.y,
        h: b.height,
        presets: b.presetCount,
        attach: b.parentName ? `${b.attachDirection}→${b.parentName}` : 'root',
        file: b.sourceFile,
      })),
    );
    console.groupEnd();
  }
  console.groupEnd();
}

/** Download only import-layout log lines (smaller file to share after mass import). */
export function downloadLayoutImportLog(): boolean {
  const lines = getLogEntries().filter((e) => e.step === 'import-layout');
  if (lines.length === 0) return false;

  const header = `# C15 Mass Import Layout Log\n# exported: ${new Date().toISOString()}\n# entries: ${lines.length}\n\n`;
  const body = lines
    .map(
      (e) =>
        `${e.time} [${e.level}] ${e.message}${e.detail ? ` | ${e.detail}` : ''}`,
    )
    .join('\n');

  const blob = new Blob([header + body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `c15-mass-import-layout-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

export function hasLayoutImportLog(): boolean {
  return getLogEntries().some((e) => e.step === 'import-layout');
}