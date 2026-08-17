/**
 * TezGPT — Folder upload support
 * Recursively reads dragged/selected directories (webkitdirectory +
 * DataTransferItem.webkitGetAsEntry) into a flat File[] with relative paths
 * preserved in `filepath` (and webkitRelativePath where available).
 */

export interface FolderFile extends File {
  filepath?: string;
  webkitRelativePath?: string;
}

/** Deep-read a FileSystemEntry (dir or file) into File[]. */
export async function traverseEntry(
  entry: FileSystemEntry | null,
  onProgress?: (count: number) => void,
): Promise<FolderFile[]> {
  if (!entry) {
    return [];
  }
  const out: FolderFile[] = [];
  let count = 0;

  const walk = async (e: FileSystemEntry, parentPath: string): Promise<void> => {
    if (e.isFile) {
      const fileEntry = e as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
      const rel = parentPath ? `${parentPath}/${file.name}` : file.name;
      Object.defineProperty(file, 'filepath', { value: rel, writable: true, configurable: true });
      out.push(file as FolderFile);
      count += 1;
      onProgress?.(count);
      return;
    }
    if (e.isDirectory) {
      const dirEntry = e as FileSystemDirectoryEntry;
      const rel = parentPath ? `${parentPath}/${dirEntry.name}` : dirEntry.name;
      const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        const reader = dirEntry.createReader();
        const all: FileSystemEntry[] = [];
        const readBatch = () => {
          reader.readEntries((batch) => {
            if (!batch.length) {
              resolve(all);
              return;
            }
            all.push(...batch);
            readBatch();
          }, reject);
        };
        readBatch();
      });
      for (const child of entries) {
        await walk(child, rel);
      }
    }
  };

  await walk(entry, '');
  return out;
}

/** Detect whether a drop event carries directory entries. */
export function dropHasDirectories(e: React.DragEvent | DragEvent): boolean {
  const items = e.dataTransfer?.items;
  if (!items) {
    return false;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        return true;
      }
    }
  }
  return false;
}

/** Collect all directory entries from a drop event. */
export function getDirectoryEntries(e: React.DragEvent | DragEvent): FileSystemEntry[] {
  const items = e.dataTransfer?.items;
  const entries: FileSystemEntry[] = [];
  if (!items) {
    return entries;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
      if (entry) {
        entries.push(entry);
      }
    }
  }
  return entries;
}
