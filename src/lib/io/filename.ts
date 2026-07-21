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