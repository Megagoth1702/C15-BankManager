/**
 * C15 / NonMaps UUID generator — matches `Uuid.random()` in NonMaps Java.
 * @see _ref/nl-firmware/projects/web/static/nonmaps/.../world/Uuid.java
 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function c15RandomUuid(): string {
  const parts: string[] = new Array(36);
  parts[8] = '-';
  parts[13] = '-';
  parts[18] = '-';
  parts[23] = '-';
  parts[14] = '4';

  for (let i = 0; i < 36; i++) {
    if (parts[i]) continue;
    const r = Math.floor(Math.random() * 16);
    parts[i] = CHARS[(i === 19) ? (r & 0x3) | 0x8 : r & 0xf]!;
  }

  return parts.join('');
}

/** Mint a UUID not present in `used` (lowercase keys). */
export function freshC15Uuid(used: Set<string>): string {
  let uuid = '';
  do {
    uuid = c15RandomUuid();
  } while (used.has(uuid.toLowerCase()));
  used.add(uuid.toLowerCase());
  return uuid;
}