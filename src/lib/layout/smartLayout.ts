import { compareBanksByCreationDate } from './bankSortKey';
import { bankOuterWidth } from '../canvas/geometry';
import { computeRecommendedStoredPosition } from '../model/positioning';
import { snapToGrid } from '../model/bankFactory';
import type { Bank } from '../types/bank';
import {
  bankToC15Rect,
  bboxFromBanks,
  getNoGoShelfEdges,
  getSynthNoGoRect,
  LAYOUT_BANDS,
  rectOverlapsNoGo,
  rectsOverlap,
  type ClusterBbox,
  type C15Rect,
} from './noGoZones';

/** How banks are ordered within each folder cluster. */
export type FolderBankSort = 'alphabetic' | 'creationDate';

/** Coarse region label for layout reports (derived from final cluster position). */
export type LayoutSide = 'left' | 'bottom' | 'right';

/**
 * Legacy marker for empty folder-label banks that older mass imports created.
 * New imports no longer create helper banks; kept so reports can still tag them.
 */
export const MASS_IMPORT_FOLDER_ATTR = 'massImportFolder';

export interface BankLayoutMeta {
  /** Parent directory of the XML relative to the import root (the folder that contains the bank files). */
  containingFolder: string;
  subPath: string;
  layoutSide: LayoutSide;
  sourceFile: string;
  /** True for legacy synthetic folder-label banks (no longer created on import). */
  isFolderParent?: boolean;
}

export function isFolderParentBank(bank: Bank): boolean {
  return bank.attributes[MASS_IMPORT_FOLDER_ATTR] === '1';
}

/** Leaf segment of a containing-folder path (layout grouping / display). */
export function folderDisplayName(containingFolder: string): string {
  const normalized = containingFolder.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || containingFolder;
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
 *
 * When the file sits at the import pick root (no `/` in the relative path), uses
 * `rootFolderName` from the directory picker so root-level files share one cluster
 * key instead of a generic "(root)" group.
 */
export function parseContainingFolder(
  relativePath: string,
  rootFolderName?: string,
): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    const root = rootFolderName?.trim();
    return root || '(root)';
  }
  return parts.slice(0, -1).join('/');
}

/** @deprecated Use parseContainingFolder */
export function parseTopLevelFolder(
  relativePath: string,
  rootFolderName?: string,
): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length > 1) return parts[0]!;
  const root = rootFolderName?.trim();
  return root || '(root)';
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

interface ChainLayoutResult {
  banks: Bank[];
  bbox: ClusterBbox | null;
}

/**
 * Rigid horizontal right-attach chain for one folder (caller provides sort order).
 *
 * Always a single row of `right` attaches — no mid-chain wrap / bottom links.
 * Mass import measures this footprint first, then chooses the lead origin so the
 * whole chain clears the synth no-go and packs against the shelves.
 *
 * `@param _constraints` kept for call-site compatibility; ignored (no wrap).
 */
export function layoutHorizontalAttachChain(
  banks: Bank[],
  originX: number,
  originY: number,
  _constraints?: unknown,
): ChainLayoutResult {
  if (banks.length === 0) return { banks: [], bbox: null };

  const placed: Bank[] = [];
  const leadX = snapToGrid(originX);
  const leadY = snapToGrid(originY);
  let previous: Bank | null = null;

  for (const source of banks) {
    let candidate: Bank;
    if (!previous) {
      candidate = {
        ...source,
        x: leadX,
        y: leadY,
        attachedToUuid: null,
        attachDirection: null,
      };
    } else {
      const pos = computeRecommendedStoredPosition(previous, source, 'right');
      candidate = {
        ...source,
        x: snapToGrid(pos.x),
        y: snapToGrid(pos.y),
        attachedToUuid: previous.uuid,
        attachDirection: 'right',
      };
    }
    placed.push(candidate);
    previous = candidate;
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
  contentEntries: ImportedBankEntry[],
  clusterBanks: Bank[],
  bbox: ClusterBbox,
): ImportedBankEntry[] {
  const layoutSide = classifyClusterRegion(bbox);
  const contentByUuid = new Map(contentEntries.map((entry) => [entry.bank.uuid, entry]));
  const result: ImportedBankEntry[] = [];

  for (const bank of clusterBanks) {
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

/**
 * Dry-run the folder as a single right-attach row at (0,0) to get true W×H.
 * The packer uses this footprint to choose the lead origin (measure-then-place).
 */
function estimateUnwrappedCluster(banks: Bank[]): ClusterEstimate {
  const { bbox } = layoutHorizontalAttachChain(banks, 0, 0);
  if (!bbox) return { width: 0, height: 0, area: 0 };
  return { width: bbox.width, height: bbox.height, area: bbox.width * bbox.height };
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
      estimate: estimateUnwrappedCluster(banks),
    };
  });

  return plans.sort((a, b) => b.estimate.area - a.estimate.area);
}

function bboxToRect(bbox: ClusterBbox): C15Rect {
  return { x: bbox.minX, y: bbox.minY, width: bbox.width, height: bbox.height };
}

/** Min gap between folder-cluster bboxes (isotropic separation). */
function clusterSeparation(): number {
  return Math.max(LAYOUT_BANDS.clusterGap, LAYOUT_BANDS.rowGap);
}

function collidesWithPlaced(rect: C15Rect, placed: C15Rect[]): boolean {
  if (rectOverlapsNoGo(rect)) return true;
  const gap = clusterSeparation();
  return placed.some((other) => rectsOverlap(rect, other, gap));
}

function lowestPlacedY(placed: C15Rect[], fallback: number): number {
  if (placed.length === 0) return fallback;
  return snapToGrid(Math.max(...placed.map((r) => r.y + r.height)) + clusterSeparation());
}

interface ClusterPlacement {
  entries: ImportedBankEntry[];
  bbox: ClusterBbox;
}

/** Axis-aligned free rectangle for MaxRects-style residual packing. */
interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Generous vertical runway for free-rect pack (expanded if exhausted). */
const FREE_RECT_RUNWAY = 120_000;

function freeRectArea(r: FreeRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function freeRectsOverlap(a: FreeRect, b: FreeRect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function freeRectContains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Drop free rects fully contained in another (MaxRects prune). */
function pruneFreeRects(rects: FreeRect[]): FreeRect[] {
  const kept: FreeRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i]!;
    if (a.width < 1 || a.height < 1) continue;
    let contained = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j]!;
      if (b.width < 1 || b.height < 1) continue;
      if (freeRectContains(b, a)) {
        contained = true;
        break;
      }
    }
    if (!contained) kept.push(a);
  }
  return kept;
}

/**
 * Split free rect by an occupied region (MaxRects). Residuals may overlap;
 * prune removes fully contained leftovers.
 */
function splitFreeRect(free: FreeRect, used: FreeRect): FreeRect[] {
  if (!freeRectsOverlap(free, used)) return [free];
  const out: FreeRect[] = [];
  // Left
  if (used.x > free.x) {
    out.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
  }
  // Right
  const usedRight = used.x + used.width;
  const freeRight = free.x + free.width;
  if (usedRight < freeRight) {
    out.push({
      x: usedRight,
      y: free.y,
      width: freeRight - usedRight,
      height: free.height,
    });
  }
  // Above (smaller Y)
  if (used.y > free.y) {
    out.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
  }
  // Below (larger Y)
  const usedBottom = used.y + used.height;
  const freeBottom = free.y + free.height;
  if (usedBottom < freeBottom) {
    out.push({
      x: free.x,
      y: usedBottom,
      width: free.width,
      height: freeBottom - usedBottom,
    });
  }
  return out.filter((r) => r.width >= 1 && r.height >= 1);
}

function subtractUsedFromFreeList(freeList: FreeRect[], used: FreeRect): FreeRect[] {
  const next: FreeRect[] = [];
  for (const free of freeList) {
    if (!freeRectsOverlap(free, used)) next.push(free);
    else next.push(...splitFreeRect(free, used));
  }
  return pruneFreeRects(next);
}

/** Inflate a placed cluster so free-space bookkeeping reserves inter-folder gap. */
function inflateForSeparation(rect: C15Rect): FreeRect {
  const gap = clusterSeparation();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width + gap,
    height: rect.height + gap,
  };
}

/**
 * Initial free regions: west of no-go, east of no-go, and full-width band below
 * the no-go (so long chains that cannot fit beside the zone still pack as
 * unwrapped rows).
 */
function initialFreeRects(
  farWestX: number,
  gridMaxX: number,
  originY: number,
  runway: number,
): FreeRect[] {
  const noGo = getSynthNoGoRect();
  const margin = LAYOUT_BANDS.synthMargin;
  const noGoLeft = noGo.x - margin;
  const noGoRight = noGo.x + noGo.width + margin;
  const noGoBottom = noGo.y + noGo.height + margin;
  const free: FreeRect[] = [];

  const westW = noGoLeft - farWestX;
  if (westW >= 1) {
    free.push({ x: farWestX, y: originY, width: westW, height: runway });
  }
  const eastW = gridMaxX - noGoRight;
  if (eastW >= 1) {
    free.push({ x: noGoRight, y: originY, width: eastW, height: runway });
  }
  const belowY = Math.max(originY, snapToGrid(noGoBottom));
  free.push({
    x: farWestX,
    y: belowY,
    width: gridMaxX - farWestX,
    height: runway,
  });
  return pruneFreeRects(free);
}

const CONTACT_TOL = 45;

/**
 * True when the candidate cluster would snug a no-go shelf or sit residual-tight
 * against an already-placed cluster (with inter-folder gap).
 */
function hasStructuralContact(
  x: number,
  y: number,
  width: number,
  height: number,
  placed: C15Rect[],
  westEdge: number,
  eastEdge: number,
): boolean {
  const gap = clusterSeparation();
  const right = x + width;
  const bottom = y + height;
  if (Math.abs(right - westEdge) <= CONTACT_TOL) return true;
  if (Math.abs(x - eastEdge) <= CONTACT_TOL) return true;

  for (const p of placed) {
    const pRight = p.x + p.width;
    const pBottom = p.y + p.height;
    const vOverlap = !(bottom + CONTACT_TOL < p.y || pBottom + CONTACT_TOL < y);
    const hOverlap = !(right + CONTACT_TOL < p.x || pRight + CONTACT_TOL < x);
    // Residual right of host
    if (vOverlap && Math.abs(x - (pRight + gap)) <= CONTACT_TOL) return true;
    // Residual left of host
    if (vOverlap && Math.abs(right + gap - p.x) <= CONTACT_TOL) return true;
    // Residual below host
    if (hOverlap && Math.abs(y - (pBottom + gap)) <= CONTACT_TOL) return true;
    // Residual above host
    if (hOverlap && Math.abs(bottom + gap - p.y) <= CONTACT_TOL) return true;
  }
  return false;
}

/**
 * Lower score = better.
 * 1) Low Y (residual high on canvas beats deep shelf stacks)
 * 2) Structural contact with a shelf or existing cluster (no floating islands)
 * 3) Shelf snug / compact X as weak tie-breakers
 */
function freeRectPlacementScore(
  x: number,
  y: number,
  width: number,
  height: number,
  placed: C15Rect[],
  westEdge: number,
  eastEdge: number,
  originY: number,
): number {
  const right = x + width;
  const distWestShelf = Math.abs(right - westEdge);
  const distEastShelf = Math.abs(x - eastEdge);
  // Snap/grid can leave a few units of shelf error — treat near-snug as snug.
  const shelfDist = Math.min(distWestShelf, distEastShelf);
  const shelfSoft = shelfDist <= CONTACT_TOL ? 0 : shelfDist;
  const yDist = Math.max(0, y - originY);
  const contact = hasStructuralContact(x, y, width, height, placed, westEdge, eastEdge)
    ? 0
    : 50_000;
  // Prefer west shelf over east when both snug (inside-out left-first).
  const westBias = distWestShelf <= distEastShelf + CONTACT_TOL ? 0 : 20;
  return yDist * 40 + contact + shelfSoft * 2 + westBias;
}

/**
 * Candidate lead origins inside a free rect that can hold W×H.
 * Free-rect corners, shelf snugs, and residual docks against placed hosts.
 */
function originsInFreeRect(
  free: FreeRect,
  width: number,
  height: number,
  placed: C15Rect[],
  westEdge: number,
  eastEdge: number,
  farWestX: number,
  gridMaxX: number,
): Array<{ x: number; y: number }> {
  if (free.width < width || free.height < height) return [];
  const maxX = free.x + free.width - width;
  const maxY = free.y + free.height - height;
  const gap = clusterSeparation();
  const xs = new Set<number>([snapToGrid(free.x), snapToGrid(maxX)]);
  const ys = new Set<number>([snapToGrid(free.y)]);

  const westSnug = snapToGrid(westEdge - width);
  if (westSnug >= free.x - CONTACT_TOL && westSnug <= maxX + CONTACT_TOL) xs.add(westSnug);
  const eastSnug = snapToGrid(eastEdge);
  if (eastSnug >= free.x - CONTACT_TOL && eastSnug <= maxX + CONTACT_TOL) xs.add(eastSnug);

  for (const p of placed) {
    const rightOf = snapToGrid(p.x + p.width + gap);
    const leftOf = snapToGrid(p.x - width - gap);
    const below = snapToGrid(p.y + p.height + gap);
    if (rightOf >= free.x - CONTACT_TOL && rightOf <= maxX + CONTACT_TOL) xs.add(rightOf);
    if (leftOf >= free.x - CONTACT_TOL && leftOf <= maxX + CONTACT_TOL) xs.add(leftOf);
    if (below >= free.y - CONTACT_TOL && below <= maxY + CONTACT_TOL) ys.add(below);
    // Align tops with hosts when residual docks horizontally
    const hostY = snapToGrid(p.y);
    if (hostY >= free.y - CONTACT_TOL && hostY <= maxY + CONTACT_TOL) ys.add(hostY);
  }

  const out: Array<{ x: number; y: number }> = [];
  for (const x of xs) {
    if (x < farWestX - LAYOUT_BANDS.synthMargin) continue;
    if (x + width > gridMaxX + LAYOUT_BANDS.synthMargin) continue;
    if (x < free.x - CONTACT_TOL || x > maxX + CONTACT_TOL) continue;
    for (const y of ys) {
      if (y < free.y - CONTACT_TOL || y > maxY + CONTACT_TOL) continue;
      // Candidate must fit fully inside free rect
      if (x + width > free.x + free.width + CONTACT_TOL) continue;
      if (y + height > free.y + free.height + CONTACT_TOL) continue;
      out.push({ x: snapToGrid(x), y: snapToGrid(y) });
    }
  }
  return out;
}

/**
 * Free-rectangle residual pack: place rigid unwrapped folder chains into free
 * space (including holes beside taller/wider hosts). Never mid-chain wraps.
 */
function tryFreeRectPlacement(
  plan: GridClusterPlan,
  freeList: FreeRect[],
  placed: C15Rect[],
  originY: number,
  gridMaxX: number,
  farWestX: number,
  westEdge: number,
  eastEdge: number,
): ClusterPlacement | null {
  const { width, height } = plan.estimate;
  if (width <= 0 || height <= 0) {
    return placeGridCluster(plan, snapToGrid(westEdge - bankOuterWidth()), originY);
  }

  type Scored = { x: number; y: number; score: number; waste: number };
  const scored: Scored[] = [];
  const seen = new Set<string>();

  for (const free of freeList) {
    for (const origin of originsInFreeRect(
      free,
      width,
      height,
      placed,
      westEdge,
      eastEdge,
      farWestX,
      gridMaxX,
    )) {
      const key = `${origin.x}:${origin.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const waste = freeRectArea(free) - width * height;
      scored.push({
        x: origin.x,
        y: origin.y,
        score: freeRectPlacementScore(
          origin.x,
          origin.y,
          width,
          height,
          placed,
          westEdge,
          eastEdge,
          originY,
        ),
        waste,
      });
    }
  }

  scored.sort(
    (a, b) => a.score - b.score || a.waste - b.waste || a.y - b.y || a.x - b.x,
  );

  // Prefer lower score; among equal scores prefer smaller X (west-first).
  for (const candidate of scored) {
    const placement = placeGridCluster(plan, candidate.x, candidate.y);
    if (!placement) continue;
    if (collidesWithPlaced(bboxToRect(placement.bbox), placed)) continue;
    return placement;
  }
  return null;
}

/**
 * Stamp the rigid unwrapped right-chain at (originX, originY).
 * Returns null if any bank would land in the synth no-go.
 */
function placeGridCluster(
  plan: GridClusterPlan,
  originX: number,
  originY: number,
): ClusterPlacement | null {
  const { banks: chainBanks, bbox } = layoutHorizontalAttachChain(
    plan.banks,
    snapToGrid(originX),
    originY,
  );
  if (!bbox) return null;
  if (rectOverlapsNoGo(bboxToRect(bbox))) return null;
  for (const bank of chainBanks) {
    if (rectOverlapsNoGo(bankToC15Rect(bank))) return null;
  }

  return {
    entries: buildFolderClusterEntries(plan.entries, chainBanks, bbox),
    bbox,
  };
}

/**
 * Preferred fallback X when free-rect search fails: west snug, then east.
 */
function preferredFallbackX(
  plan: GridClusterPlan,
  westEdge: number,
  eastEdge: number,
  farWestX: number,
  gridMaxX: number,
): number {
  const width = Math.max(plan.estimate.width, bankOuterWidth());
  return snapToGrid(Math.max(farWestX, westEdge - width));
}

/**
 * Free-rect pack folder clusters against the synth no-go (residual fill).
 * `seedRects` are existing session banks (merge) or empty (replace / fresh).
 * Each folder is a rigid right-only horizontal chain (measure-then-place).
 * Largest-area folders first; free rectangles absorb residual width beside hosts.
 */
function layoutClustersAgainstNoGo(
  groups: FolderGroup[],
  options: FolderChainLayoutOptions,
  seedRects: C15Rect[] = [],
): ImportedBankEntry[] {
  const { westEdge, eastEdge, originY, farWestX, maxX: gridMaxX } = getNoGoShelfEdges();
  const plans = planGridClusters(groups, options);
  const result: ImportedBankEntry[] = [];
  const placedRects: C15Rect[] = [];

  let runway = FREE_RECT_RUNWAY;
  let freeList = initialFreeRects(farWestX, gridMaxX, originY, runway);

  // Seed obstacles (merge): reserve separation so new folders clear existing banks.
  for (const seed of seedRects) {
    placedRects.push(seed);
    freeList = subtractUsedFromFreeList(freeList, inflateForSeparation(seed));
  }

  for (const plan of plans) {
    let placement = tryFreeRectPlacement(
      plan,
      freeList,
      placedRects,
      originY,
      gridMaxX,
      farWestX,
      westEdge,
      eastEdge,
    );

    if (!placement) {
      // Expand runway downward and retry (still unwrapped; no mid-chain wrap).
      runway += FREE_RECT_RUNWAY;
      freeList = [
        ...freeList,
        {
          x: farWestX,
          y: lowestPlacedY(placedRects, originY),
          width: gridMaxX - farWestX,
          height: FREE_RECT_RUNWAY,
        },
      ];
      freeList = pruneFreeRects(freeList);
      placement = tryFreeRectPlacement(
        plan,
        freeList,
        placedRects,
        originY,
        gridMaxX,
        farWestX,
        westEdge,
        eastEdge,
      );
    }

    if (!placement) {
      const fallbackX = preferredFallbackX(plan, westEdge, eastEdge, farWestX, gridMaxX);
      const fallbackY = lowestPlacedY(placedRects, originY);
      placement = placeGridCluster(plan, fallbackX, fallbackY);
    }

    if (!placement) {
      // Last resort: fully below no-go as a rigid unwrapped row.
      const noGo = getSynthNoGoRect();
      const belowY = snapToGrid(
        Math.max(
          lowestPlacedY(placedRects, originY),
          noGo.y + noGo.height + LAYOUT_BANDS.synthMargin + clusterSeparation(),
        ),
      );
      const fallbackX = preferredFallbackX(plan, westEdge, eastEdge, farWestX, gridMaxX);
      placement = placeGridCluster(plan, fallbackX, belowY);
    }

    if (!placement) {
      throw new Error(`Failed to place folder cluster "${plan.group.folder}"`);
    }

    let rect = bboxToRect(placement.bbox);
    if (collidesWithPlaced(rect, placedRects)) {
      const fallbackY = lowestPlacedY(placedRects, originY);
      const fallbackX = preferredFallbackX(plan, westEdge, eastEdge, farWestX, gridMaxX);
      placement = placeGridCluster(plan, fallbackX, fallbackY);
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
    freeList = subtractUsedFromFreeList(freeList, inflateForSeparation(rect));
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