import { bankCardVariant, bankLodMode, type BankLodMode } from '../canvas/lod';
import { isAppDebugEnabled } from './debugFlags';
import { log } from './sessionLog';
import type { Bank } from '../types/bank';

export interface BankRenderEntry {
  /** 1-based display index */
  index: number;
  name: string;
  uuid: string;
}

let prevFullUuids = new Set<string>();
let prevLodMode: BankLodMode | null = null;
let prevBankCount = 0;

export function resetRenderPerfLog(): void {
  prevFullUuids = new Set();
  prevLodMode = null;
  prevBankCount = 0;
}

export function recordBankRenderSnapshot(
  banks: readonly Bank[],
  visibleUuids: ReadonlySet<string>,
  viewportZoom: number,
): void {
  // Hot path (visibility / edge-scroll). Do not walk banks when debug is off.
  if (!isAppDebugEnabled()) return;

  if (banks.length !== prevBankCount) {
    prevFullUuids = new Set();
    prevLodMode = null;
    prevBankCount = banks.length;
  }

  const lodMode = bankLodMode(viewportZoom);

  if (lodMode === 'lite') {
    if (prevLodMode === 'full') {
      log('render', 'lod mode transition', {
        viewportZoom,
        lodMode,
        from: 'full',
        fullCount: 0,
        liteCount: visibleUuids.size,
        culledCount: Math.max(0, banks.length - visibleUuids.size),
      });
    }
    prevFullUuids = new Set();
    prevLodMode = lodMode;
    return;
  }

  const fullUuids = new Set<string>();
  let liteCount = 0;
  banks.forEach((bank) => {
    const variant = bankCardVariant(viewportZoom, bank.uuid, visibleUuids);
    if (variant === 'full') fullUuids.add(bank.uuid);
    else if (variant === 'lite') liteCount++;
  });
  const culledCount = Math.max(0, banks.length - fullUuids.size - liteCount);

  const added: BankRenderEntry[] = [];
  const removed: BankRenderEntry[] = [];

  for (const uuid of fullUuids) {
    if (!prevFullUuids.has(uuid)) {
      const index = banks.findIndex((b) => b.uuid === uuid);
      if (index >= 0) {
        added.push({ index: index + 1, name: banks[index]!.name, uuid });
      }
    }
  }

  for (const uuid of prevFullUuids) {
    if (!fullUuids.has(uuid)) {
      const index = banks.findIndex((b) => b.uuid === uuid);
      if (index >= 0) {
        removed.push({ index: index + 1, name: banks[index]!.name, uuid });
      }
    }
  }

  if (added.length > 0 || removed.length > 0 || prevLodMode === 'lite') {
    log('render', 'full banks changed', {
      viewportZoom,
      lodMode,
      fullCount: fullUuids.size,
      liteCount,
      culledCount,
      added,
      removed,
    });
  }

  prevFullUuids = fullUuids;
  prevLodMode = lodMode;
}