import { compareBanksByCreationDate } from './bankSortKey';
import { bankOuterWidth, horizontalAttachStep } from '../canvas/geometry';
import { computeRecommendedStoredPosition } from '../model/positioning';
import { createEmptyBank, snapToGrid } from '../model/bankFactory';
import type { Bank } from '../types/bank';
import {
  bankToC15Rect,
  bboxFromBanks,
  getNoGoShelfEdges,
  getSynthNoGoRect,
  LAYOUT_BANDS,
  rectExceedsMaxX,
  rectOverlapsNoGo,
  rectsOverlap,
  type ClusterBbox,
  type C15Rect,
} from './noGoZones';

/** How banks are ordered within each folder cluster. */
export type FolderBankSort = 'alphabetic' | 'creationDate';

/** Coarse region label for layout reports (derived from final cluster position). */
export type LayoutSide = 'left' | 'bottom' | 'right';

/** Marker on empty folder-label banks created during mass import. */
export const MASS_IMPORT_FOLDER_ATTR = 'massImportFolder';

export interface BankLayoutMeta {
  /** Parent directory of the XML relative to the import root (the folder that contains the bank files). */
  containingFolder: string;
  subPath: string;
  layoutSide: LayoutSide;
  sourceFile: string;
  /** True for the synthetic parent bank named after the containing folder. */
  isFolderParent?: boolean;
}

export function isFolderParentBank(bank: Bank): boolean {
  return bank.attributes[MASS_IMPORT_FOLDER_ATTR] === '1';
}

/** Leaf segment of a containing-folder path — used as the folder parent bank name. */
export function folderDisplayName(containingFolder: string): string {
  const normalized = containingFolder.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || containingFolder;
}

function folderParentChainOffset(): number {
  return horizontalAttachStep();
}

function createFolderParentBank(containingFolder: string, x: number, y: number): Bank {
  const bank = createEmptyBank(folderDisplayName(containingFolder), snapToGrid(x), snapToGrid(y));
  return {
    ...bank,
    attributes: { ...bank.attributes, [MASS_IMPORT_FOLDER_ATTR]: '1' },
  };
}

/**
 * Attach content banks under the folder parent: row lead → right of parent;
 * additional wrapped-row leads → bottom of the previous row lead.
 */
function wireFolderParent(parent: Bank, chainBanks: Bank[]): Bank[] {
  const wired = chainBanks.map((bank) => ({ ...bank }));
  const byUuid = new Map(wired.map((bank) => [bank.uuid, bank]));
  const rowLeads = wired
    .filter((bank) => !bank.attachedToUuid)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  if (rowLeads.length === 0) return [parent, ...wired];

  const lead = byUuid.get(rowLeads[0]!.uuid)!;
  lead.attachedToUuid = parent.uuid;
  lead.attachDirection = 'right';

  for (let i = 1; i < rowLeads.length; i++) {
    const child = byUuid.get(rowLeads[i]!.uuid)!;
    const prevLead = byUuid.get(rowLeads[i - 1]!.uuid)!;
    child.attachedToUuid = prevLead.uuid;
    child.attachDirection = 'bottom';
  }

  return [parent, ...wired];
}

export interface ImportedBankEntry {
  bank: Bank;
  meta: BankLayoutMeta;
}

export interface FolderChainLayoutOptions {
  sortBy: FolderBankSort;
}

/**
 * The folder that directly contains the bank XML file.
 * e.g. `ssc (Stephan Schmitt)/Legacy/foo.xml` → `ssc (Stephan Schmitt)/Legacy`
 */
export function parseContainingFolder(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, -1).join('/');
}

/** @deprecated Use parseContainingFolder */
export function parseTopLevelFolder(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.length > 1 ? parts[0]! : '(root)';
}

export function parseSubPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? relativePath;
}

export function compareFoldersAlphabetic(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Remove every attachment from import — layout rebuilds chains per folder only. */
export function stripAllAttachments(entries: ImportedBankEntry[]): ImportedBankEntry[] {
  return entries.map((entry) => ({
    ...entry,
    bank: {
      ...entry.bank,
      attachedToUuid: null,
      attachDirection: null,
    },
  }));
}

function sortEntriesInFolder(
  entries: ImportedBankEntry[],
  sortBy: FolderBankSort,
): ImportedBankEntry[] {
  return [...entries].sort((a, b) => {
    if (sortBy === 'creationDate') {
      const dateCmp = compareBanksByCreationDate(a.bank, b.bank);
      if (dateCmp !== 0) return dateCmp;
    } else {
      const nameCmp = a.bank.name.localeCompare(b.bank.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (nameCmp !== 0) return nameCmp;
    }
    const fileCmp = a.meta.sourceFile.localeCompare(b.meta.sourceFile, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (fileCmp !== 0) return fileCmp;
    return a.meta.subPath.localeCompare(b.meta.subPath, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

export interface ChainLayoutConstraints {
  /** Wrap the chain to a new row when a bank's right edge exceeds this X. */
  maxChainX?: number;
  /** When true (default), also wrap if a bank overlaps the synth no-go rect. */
  wrapOnNoGo?: boolean;
}

interface ChainLayoutResult {
  banks: Bank[];
  bbox: ClusterBbox | null;
}

function chainNeedsWrap(
  candidate: Bank,
  constraints: ChainLayoutConstraints,
): boolean {
  const rect = bankToC15Rect(candidate);
  if (constraints.maxChainX !== undefined && rectExceedsMaxX(rect, constraints.maxChainX)) {
    return true;
  }
  if (constraints.wrapOnNoGo !== false && rectOverlapsNoGo(rect)) {
    return true;
  }
  return false;
}

function eastWingOriginY(parent: Bank): number {
  if (parent.attachDirection === 'top' || parent.attachDirection === 'bottom') {
    return parent.y - LAYOUT_BANDS.chainRowGap;
  }
  return parent.y;
}

/** Place the next bank east of the synth no-go on the same row (detached root). */
function tryPlaceEastOfNoGo(source: Bank, rowOriginY: number): Bank | null {
  const noGo = getSynthNoGoRect();
  const eastX = snapToGrid(noGo.x + noGo.width + LAYOUT_BANDS.synthMargin);
  const candidate: Bank = {
    ...source,
    x: eastX,
    y: snapToGrid(rowOriginY),
    attachedToUuid: null,
    attachDirection: null,
  };
  return rectOverlapsNoGo(bankToC15Rect(candidate)) ? null : candidate;
}

/**
 * Horizontal attach chain for banks in one folder (caller provides sort order).
 * Wraps to a new detached row when the next bank would exceed bounds or overlap the synth zone.
 */
export function layoutHorizontalAttachChain(
  banks: Bank[],
  originX: number,
  originY: number,
  constraints: ChainLayoutConstraints = {},
): ChainLayoutResult {
  if (banks.length === 0) return { banks: [], bbox: null };

  const placed: Bank[] = [];
  let rowOriginX = snapToGrid(originX);
  let rowOriginY = snapToGrid(originY);
  let rowMaxHeight = 0;
  let previousInRow: Bank | null = null;

  for (const source of banks) {
    let candidate: Bank;

    if (!previousInRow) {
      candidate = {
        ...source,
        x: rowOriginX,
        y: rowOriginY,
        attachedToUuid: null,
        attachDirection: null,
      };
    } else {
      const pos = computeRecommendedStoredPosition(previousInRow, source, 'right');
      candidate = {
        ...source,
        x: snapToGrid(pos.x),
        y: snapToGrid(pos.y),
        attachedToUuid: previousInRow.uuid,
        attachDirection: 'right',
      };
    }

    let needsWrap = previousInRow !== null && chainNeedsWrap(candidate, constraints);

    if (needsWrap && constraints.wrapOnNoGo !== false && rectOverlapsNoGo(bankToC15Rect(candidate))) {
      const eastCandidate = tryPlaceEastOfNoGo(source, eastWingOriginY(previousInRow!));
      if (
        eastCandidate &&
        !chainNeedsWrap(eastCandidate, { ...constraints, wrapOnNoGo: false })
      ) {
        candidate = eastCandidate;
        needsWrap = false;
      }
    }

    if (needsWrap) {
      rowOriginY = snapToGrid(rowOriginY + rowMaxHeight + LAYOUT_BANDS.chainRowGap);
      rowMaxHeight = 0;
      previousInRow = null;

      candidate = {
        ...source,
        x: rowOriginX,
        y: rowOriginY,
        attachedToUuid: null,
        attachDirection: null,
      };
    }

    placed.push(candidate);
    rowMaxHeight = Math.max(rowMaxHeight, bankToC15Rect(candidate).height);
    previousInRow = candidate;
  }

  return { banks: placed, bbox: bboxFromBanks(placed) };
}

function classifyClusterRegion(bbox: ClusterBbox): LayoutSide {
  const noGo = getSynthNoGoRect();
  const margin = LAYOUT_BANDS.synthMargin;

  if (bbox.minY >= noGo.y + noGo.height + margin) return 'bottom';
  if (bbox.minX >= noGo.x + noGo.width + margin) return 'right';
  return 'left';
}

function applyChainToEntries(
  entries: ImportedBankEntry[],
  chainBanks: Bank[],
  bbox: ClusterBbox,
): ImportedBankEntry[] {
  const layoutSide = classifyClusterRegion(bbox);
  const byUuid = new Map(chainBanks.map((b) => [b.uuid, b]));
  return entries.map((entry) => {
    const placed = byUuid.get(entry.bank.uuid);
    if (!placed) return entry;
    return {
      ...entry,
      bank: placed,
      meta: { ...entry.meta, layoutSide },
    };
  });
}

function buildFolderClusterEntries(
  containingFolder: string,
  contentEntries: ImportedBankEntry[],
  clusterBanks: Bank[],
  bbox: ClusterBbox,
): ImportedBankEntry[] {
  const layoutSide = classifyClusterRegion(bbox);
  const contentByUuid = new Map(contentEntries.map((entry) => [entry.bank.uuid, entry]));
  const result: ImportedBankEntry[] = [];

  for (const bank of clusterBanks) {
    if (isFolderParentBank(bank)) {
      result.push({
        bank,
        meta: {
          containingFolder,
          subPath: '',
          layoutSide,
          sourceFile: '',
          isFolderParent: true,
        },
      });
      continue;
    }

    const source = contentByUuid.get(bank.uuid);
    if (!source) continue;
    result.push({
      ...source,
      bank,
      meta: { ...source.meta, layoutSide },
    });
  }

  return result;
}

interface FolderGroup {
  folder: string;
  entries: ImportedBankEntry[];
}

function groupByContainingFolder(entries: ImportedBankEntry[]): FolderGroup[] {
  const map = new Map<string, ImportedBankEntry[]>();
  for (const entry of entries) {
    const key = entry.meta.containingFolder;
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }

  return [...map.entries()]
    .map(([folder, folderEntries]) => ({ folder, entries: folderEntries }))
    .sort((a, b) => compareFoldersAlphabetic(a.folder, b.folder));
}

interface ClusterEstimate {
  width: number;
  height: number;
  area: number;
}

interface GridClusterPlan {
  group: FolderGroup;
  entries: ImportedBankEntry[];
  banks: Bank[];
  estimate: ClusterEstimate;
}

function estimateGridCluster(entries: ImportedBankEntry[], banks: Bank[]): ClusterEstimate {
  const chainOffset = folderParentChainOffset();
  // Pure chain footprint without no-go distortion — used to snug clusters against the shelf.
  const { bbox } = layoutHorizontalAttachChain(banks, chainOffset, 0, {
    wrapOnNoGo: false,
  });
  if (!bbox) return { width: 0, height: 0, area: 0 };
  const width = bbox.width + chainOffset;
  return { width, height: bbox.height, area: width * bbox.height };
}

function planGridClusters(
  groups: FolderGroup[],
  options: FolderChainLayoutOptions,
): GridClusterPlan[] {
  const plans = groups.map((group) => {
    const entries = sortEntriesInFolder(group.entries, options.sortBy);
    const banks = entries.map((e) => e.bank);
    return {
      group,
      entries,
      banks,
      estimate: estimateGridCluster(entries, banks),
    };
  });

  return plans.sort((a, b) => b.estimate.area - a.estimate.area);
}

function bboxToRect(bbox: ClusterBbox): C15Rect {
  return { x: bbox.minX, y: bbox.minY, width: bbox.width, height: bbox.height };
}

function collidesWithPlaced(rect: C15Rect, placed: C15Rect[]): boolean {
  if (rectOverlapsNoGo(rect)) return true;
  return placed.some((other) => rectsOverlap(rect, other, 30));
}

/** If a row overlaps the synth vertically, skip cursor X past the no-go hole. */
function skipNoGoHoleX(cursorX: number, clusterWidth: number, rowY: number, clusterHeight: number): number {
  const noGo = getSynthNoGoRect();
  const margin = LAYOUT_BANDS.synthMargin;
  const rowOverlapsNoGoY = rowY < noGo.y + noGo.height && rowY + clusterHeight > noGo.y;
  if (!rowOverlapsNoGoY) return cursorX;

  const noGoLeft = noGo.x - margin;
  const noGoRight = noGo.x + noGo.width + margin;
  const clusterRight = cursorX + clusterWidth;

  if (cursorX < noGoRight && clusterRight > noGoLeft) {
    return snapToGrid(noGoRight);
  }
  return cursorX;
}

function lowestPlacedY(placed: C15Rect[], fallback: number): number {
  if (placed.length === 0) return fallback;
  return snapToGrid(Math.max(...placed.map((r) => r.y + r.height)) + LAYOUT_BANDS.rowGap);
}

function candidateYs(placed: C15Rect[], originY: number): number[] {
  const ys = new Set<number>([originY]);
  for (const rect of placed) {
    ys.add(snapToGrid(rect.y + rect.height + LAYOUT_BANDS.rowGap));
  }
  return [...ys].sort((a, b) => a - b);
}

function candidateXsOnRow(
  rowY: number,
  clusterWidth: number,
  clusterHeight: number,
  placed: C15Rect[],
  preferredXs: number[],
  gridMaxX: number,
  farWestX: number,
  westEdge: number,
): number[] {
  const preferredOrdered: number[] = [];
  const seen = new Set<number>();

  const pushX = (raw: number, into: number[]): void => {
    const x = skipNoGoHoleX(raw, clusterWidth, rowY, clusterHeight);
    if (seen.has(x)) return;
    if (x < farWestX - LAYOUT_BANDS.synthMargin) return;
    if (x + clusterWidth > gridMaxX + LAYOUT_BANDS.synthMargin) return;
    seen.add(x);
    into.push(x);
  };

  // Preferred origins first (snug west, then east) — do NOT sort leftmost-first
  // or farWest (-6400) always wins over the compact no-go shelf.
  for (const preferred of preferredXs) {
    pushX(preferred, preferredOrdered);
  }

  const neighbors: number[] = [];
  for (const rect of placed) {
    if (rect.y + rect.height + 30 <= rowY || rect.y >= rowY + clusterHeight + 30) continue;
    // Right of an existing cluster (may jump east over the no-go hole).
    pushX(snapToGrid(rect.x + rect.width + LAYOUT_BANDS.clusterGap), neighbors);
    // Left of an existing cluster (expand the west shelf).
    pushX(snapToGrid(rect.x - clusterWidth - LAYOUT_BANDS.clusterGap), neighbors);
  }

  // Among free neighbors, prefer snug against the west shelf (right edge near westEdge).
  const snugTarget = snapToGrid(westEdge - clusterWidth);
  neighbors.sort((a, b) => Math.abs(a - snugTarget) - Math.abs(b - snugTarget) || a - b);

  return [...preferredOrdered, ...neighbors];
}

function trySkylinePlacement(
  plan: GridClusterPlan,
  placed: C15Rect[],
  preferredXs: number[],
  originY: number,
  gridMaxX: number,
  farWestX: number,
  westEdge: number,
): ClusterPlacement | null {
  const { width, height } = plan.estimate;
  const fallbackX = preferredXs[0] ?? farWestX;
  if (width <= 0 || height <= 0) {
    return placeGridCluster(plan, fallbackX, originY, gridMaxX);
  }

  for (const rowY of candidateYs(placed, originY)) {
    for (const x of candidateXsOnRow(
      rowY,
      width,
      height,
      placed,
      preferredXs,
      gridMaxX,
      farWestX,
      westEdge,
    )) {
      const placement = placeGridCluster(plan, x, rowY, gridMaxX);
      if (!placement) continue;
      if (!collidesWithPlaced(bboxToRect(placement.bbox), placed)) {
        return placement;
      }
    }
  }

  return null;
}

interface ClusterPlacement {
  entries: ImportedBankEntry[];
  bbox: ClusterBbox;
}

function placeGridCluster(
  plan: GridClusterPlan,
  originX: number,
  originY: number,
  gridMaxX: number,
): ClusterPlacement | null {
  const chainOffset = folderParentChainOffset();
  const parent = createFolderParentBank(plan.group.folder, originX, originY);
  const { banks: chainBanks, bbox: contentBbox } = layoutHorizontalAttachChain(
    plan.banks,
    snapToGrid(originX + chainOffset),
    originY,
    { maxChainX: gridMaxX, wrapOnNoGo: true },
  );
  if (!contentBbox) return null;

  const clusterBanks = wireFolderParent(parent, chainBanks);
  const bbox = bboxFromBanks(clusterBanks);
  if (!bbox) return null;

  return {
    entries: buildFolderClusterEntries(plan.group.folder, plan.entries, clusterBanks, bbox),
    bbox,
  };
}

/**
 * Preferred X origins for a cluster: snug against the west no-go shelf when it fits,
 * otherwise start at the far-west grid limit (chain will bridge east over the hole).
 * Always also try the east shelf so multi-folder packs can sit on both sides.
 */
function preferredOriginsForPlan(
  plan: GridClusterPlan,
  westEdge: number,
  eastEdge: number,
  farWestX: number,
): number[] {
  const pureW = Math.max(plan.estimate.width, bankOuterWidth());
  const snugWestX = snapToGrid(westEdge - pureW);
  // If the pure chain is wider than the west band, start at far west so wrapOnNoGo
  // fills left of the red zone then jumps to the east wing.
  const westStart = snugWestX < farWestX ? farWestX : snugWestX;
  // Order matters: try compact west first, then east shelf. farWest only as last resort.
  const ordered = [westStart, eastEdge];
  if (snugWestX !== westStart) ordered.push(snugWestX);
  if (farWestX !== westStart) ordered.push(farWestX);
  return ordered;
}

/**
 * Skyline pack folder clusters against the synth no-go shelves.
 * `seedRects` are existing session banks (merge) or empty (replace / fresh).
 * Chains may bridge west→east over the synth hole; the no-go rect stays empty.
 */
function layoutClustersAgainstNoGo(
  groups: FolderGroup[],
  options: FolderChainLayoutOptions,
  seedRects: C15Rect[] = [],
): ImportedBankEntry[] {
  const { westEdge, eastEdge, originY, farWestX, maxX: gridMaxX } = getNoGoShelfEdges();
  const plans = planGridClusters(groups, options);
  const result: ImportedBankEntry[] = [];
  const placedRects: C15Rect[] = [...seedRects];

  for (const plan of plans) {
    const preferredXs = preferredOriginsForPlan(plan, westEdge, eastEdge, farWestX);
    const primaryX = preferredXs[0]!;

    let placement =
      trySkylinePlacement(
        plan,
        placedRects,
        preferredXs,
        originY,
        gridMaxX,
        farWestX,
        westEdge,
      ) ??
      placeGridCluster(
        plan,
        primaryX,
        lowestPlacedY(placedRects, originY),
        gridMaxX,
      );

    if (!placement) {
      throw new Error(`Failed to place folder cluster "${plan.group.folder}"`);
    }

    let rect = bboxToRect(placement.bbox);
    if (collidesWithPlaced(rect, placedRects)) {
      const fallbackY = lowestPlacedY(placedRects, originY);
      placement =
        trySkylinePlacement(
          plan,
          placedRects,
          preferredXs,
          fallbackY,
          gridMaxX,
          farWestX,
          westEdge,
        ) ?? placeGridCluster(plan, primaryX, fallbackY, gridMaxX);
      if (!placement) {
        throw new Error(`Failed to place folder cluster "${plan.group.folder}" (fallback)`);
      }
      rect = bboxToRect(placement.bbox);
      if (collidesWithPlaced(rect, placedRects)) {
        throw new Error(`Cluster collision after fallback for "${plan.group.folder}"`);
      }
    }

    result.push(...placement.entries);
    placedRects.push(rect);
  }

  return result;
}

/**
 * Place each containing folder as its own horizontal attach chain.
 * Fresh / replace: pack against the synth no-go (red zone left empty).
 * Merge: same packing with existing banks as obstacles.
 */
export function applyFolderChainLayout(
  entries: ImportedBankEntry[],
  options: FolderChainLayoutOptions,
  existingBanks: Bank[] = [],
): ImportedBankEntry[] {
  const stripped = stripAllAttachments(entries);
  const groups = groupByContainingFolder(stripped);
  const seedRects = existingBanks.map((bank) => bankToC15Rect(bank));
  return layoutClustersAgainstNoGo(groups, options, seedRects);
}

export function entriesToBanks(entries: ImportedBankEntry[]): Bank[] {
  return entries.map((e) => e.bank);
}

export function buildLayoutMetaMap(
  entries: ImportedBankEntry[],
): Map<string, BankLayoutMeta> {
  return new Map(entries.map((e) => [e.bank.uuid, e.meta]));
}