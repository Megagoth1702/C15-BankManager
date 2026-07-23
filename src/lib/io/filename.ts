const INVALID_CHARS = /[\\/:*?"<>|]/g;

/** Normalize a user-provided backup filename for download. */
export function sanitizeBackupFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Filename cannot be empty.');
  }
  const cleaned = trimmed.replace(INVALID_CHARS, '-');
  return cleaned.toLowerCase().endsWith('.nlbackup') ? cleaned : `${cleaned}.nlbackup`;
}

/**
 * Sanitize a display name into a bare filename stem (no extension).
 * Collapses whitespace; strips path separators and reserved characters.
 */
export function sanitizeFilenameStem(name: string): string {
  const cleaned = name
    .trim()
    .replace(INVALID_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'bank';
}

/**
 * Build a unique `.xml` filename from a bank name.
 * @param usedLowercase Optional set of already-used lowercase filenames (mutated when provided).
 */
export function buildBankXmlFilename(
  bankName: string,
  usedLowercase?: Set<string>,
): string {
  const stem = sanitizeFilenameStem(bankName);
  let candidate = `${stem}.xml`;
  if (!usedLowercase) {
    return candidate;
  }

  let n = 2;
  while (usedLowercase.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n}).xml`;
    n += 1;
  }
  usedLowercase.add(candidate.toLowerCase());
  return candidate;
}

/** Ensure a user-facing string ends with `.xml` after sanitizing. */
export function sanitizeXmlFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Filename cannot be empty.');
  }
  const cleaned = trimmed.replace(INVALID_CHARS, '-');
  return cleaned.toLowerCase().endsWith('.xml') ? cleaned : `${cleaned}.xml`;
}
