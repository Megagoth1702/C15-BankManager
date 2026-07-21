const IMPORTABLE_EXT = /\.(xml|nlbackup)$/i;

export interface ImportableFile {
  file: File;
  /** Path relative to the picked folder root, e.g. `ssc (Stephan Schmitt)/ssc Pad 05.xml`. */
  relativePath: string;
}

function isImportableFile(name: string): boolean {
  return IMPORTABLE_EXT.test(name);
}

async function collectFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  parentPath = '',
): Promise<ImportableFile[]> {
  const files: ImportableFile[] = [];

  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      if (isImportableFile(file.name)) {
        const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
        files.push({ file, relativePath });
      }
    } else if (entry.kind === 'directory') {
      const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      files.push(
        ...(await collectFromDirectoryHandle(entry as FileSystemDirectoryHandle, childPath)),
      );
    }
  }

  return files;
}

export function supportsDirectoryPicker(): boolean {
  return 'showDirectoryPicker' in window;
}

/** Returns files from the native folder picker, or null if the user cancelled. */
export async function pickFolderViaDirectoryPicker(): Promise<ImportableFile[] | null> {
  const handle = await window.showDirectoryPicker();
  const files = await collectFromDirectoryHandle(handle);
  return files;
}

export function toImportableFiles(files: FileList | File[]): ImportableFile[] {
  return [...files]
    .filter((file) => isImportableFile(file.name))
    .map((file) => {
      const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      return { file, relativePath: relative.replace(/\\/g, '/') };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** @deprecated Use toImportableFiles */
export function filterImportableFiles(files: FileList | File[]): File[] {
  return toImportableFiles(files).map((entry) => entry.file);
}

export function folderLabelFromImportable(files: ImportableFile[]): string {
  const first = files[0];
  if (!first) return 'folder';
  const segment = first.relativePath.split('/')[0];
  return segment || 'folder';
}

/** @deprecated Use folderLabelFromImportable */
export function folderLabelFromFiles(files: File[]): string {
  return folderLabelFromImportable(toImportableFiles(files));
}