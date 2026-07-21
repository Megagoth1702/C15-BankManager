import type { Bank } from '../types/bank';
import type { BankTreeNode } from './bankTree';
import { flattenCluster } from './bankTree';

export function bankNameMatches(bank: Bank, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return bank.name.toLowerCase().includes(needle);
}

/** Banks visible in a cluster when the filter is active. */
export function filterClusterMembers(root: BankTreeNode, query: string): BankTreeNode[] {
  const members = flattenCluster(root);
  if (!query.trim()) return members;
  return members.filter((node) => bankNameMatches(node.bank, query));
}

export function clusterMatchesFilter(root: BankTreeNode, query: string): boolean {
  return filterClusterMembers(root, query).length > 0;
}

export function filterBankForest(forest: BankTreeNode[], query: string): BankTreeNode[] {
  if (!query.trim()) return forest;
  return forest.filter((root) => clusterMatchesFilter(root, query));
}