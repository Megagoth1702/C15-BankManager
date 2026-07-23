/** Case-insensitive UUID key for C15 (firmware treats UUID case as insignificant). */
export function uuidKey(uuid: string): string {
  return uuid.toLowerCase();
}

export function uuidEquals(a: string, b: string): boolean {
  return uuidKey(a) === uuidKey(b);
}

export function findByUuid<T extends { uuid: string }>(
  items: readonly T[],
  uuid: string,
): T | undefined {
  const key = uuidKey(uuid);
  return items.find((item) => uuidKey(item.uuid) === key);
}

export function uniqueUuids(uuids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uuid of uuids) {
    const key = uuidKey(uuid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(uuid);
  }
  return out;
}
