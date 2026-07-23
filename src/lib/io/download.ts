export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/gzip',
): void {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Download a UTF-8 text file (e.g. single-bank `.xml`). */
export function downloadText(
  text: string,
  filename: string,
  mimeType = 'application/xml;charset=utf-8',
): void {
  const bytes = new TextEncoder().encode(text);
  downloadBytes(bytes, filename, mimeType);
}

/**
 * Stagger multiple downloads so browsers are less likely to drop all but the first.
 * Still initiated from the same user gesture chain when awaited immediately.
 */
export async function downloadTextFiles(
  files: ReadonlyArray<{ text: string; filename: string }>,
  options: { delayMs?: number; mimeType?: string } = {},
): Promise<void> {
  const delayMs = options.delayMs ?? 150;
  const mimeType = options.mimeType ?? 'application/xml;charset=utf-8';

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    downloadText(file.text, file.filename, mimeType);
    if (i < files.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
