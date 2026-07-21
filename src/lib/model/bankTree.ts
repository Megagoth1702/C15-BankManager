import type { Bank } from '../types/bank';

export interface BankTreeNode {
  bank: Bank;
  children: BankTreeNode[];
  depth: number;
}

/**
 * Build a forest of attachment trees for the sidebar.
 * Roots are banks with no parent or a missing parent; children follow import order.
 */
export function buildBankForest(banks: Bank[]): BankTreeNode[] {
  if (banks.length === 0) return [];

  const byUuid = new Map(banks.map((bank) => [bank.uuid, bank]));
  const childrenByParent = new Map<string, Bank[]>();

  for (const bank of banks) {
    const parentUuid = bank.attachedToUuid;
    if (!parentUuid || !byUuid.has(parentUuid)) continue;
    const siblings = childrenByParent.get(parentUuid) ?? [];
    siblings.push(bank);
    childrenByParent.set(parentUuid, siblings);
  }

  function buildNode(bank: Bank, depth: number): BankTreeNode {
    const children = (childrenByParent.get(bank.uuid) ?? []).map((child) =>
      buildNode(child, depth + 1),
    );
    return { bank, children, depth };
  }

  const roots = banks.filter((bank) => {
    const parentUuid = bank.attachedToUuid;
    return !parentUuid || !byUuid.has(parentUuid);
  });

  return roots.map((bank) => buildNode(bank, 0));
}

/** Parent first, then descendants in sibling/import order. */
export function flattenCluster(root: BankTreeNode): BankTreeNode[] {
  const flat: BankTreeNode[] = [];
  function walk(node: BankTreeNode): void {
    flat.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(root);
  return flat;
}

export function clusterHasChildren(root: BankTreeNode): boolean {
  return root.children.length > 0;
}

/** Flatten tree nodes for keyed rendering (stable order, depth preserved). */
export function flattenBankForest(forest: BankTreeNode[]): BankTreeNode[] {
  const flat: BankTreeNode[] = [];
  function walk(node: BankTreeNode): void {
    flat.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of forest) {
    walk(root);
  }
  return flat;
}