import DragDropOverlay from '~/components/Chat/Input/Files/DragDropOverlay';
import DragDropModal from '~/components/Chat/Input/Files/DragDropModal';
import { DragDropProvider, UploadModalProvider } from '~/Providers';
import { useDragHelpers } from '~/hooks';
import { cn } from '~/utils';
import { dropHasDirectories, getDirectoryEntries, traverseEntry } from '~/lib/byok/folderTraversal';
import { flashIndicator } from '~/lib/byok/indicator';

interface DragDropWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/** Native capture-phase handler: folder drops bypass react-dnd and are
 *  traversed here, then handed to the file pipeline via a DOM event. */
async function handleNativeFolderDrop(e: React.DragEvent) {
  if (!dropHasDirectories(e)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const entries = getDirectoryEntries(e);
  const files: File[] = [];
  let count = 0;
  for (const entry of entries) {
    const collected = await traverseEntry(entry, (n) => {
      count = n;
    });
    files.push(...collected);
  }
  if (files.length) {
    window.dispatchEvent(
      new CustomEvent('tezgpt:folder-drop', { detail: { files } }),
    );
    flashIndicator({ text: `📁 ${files.length} file(s) from ${entries.length} folder(s) added` });
  }
}

function DragDropArea({ children, className }: DragDropWrapperProps) {
  const { isOver, canDrop, drop } = useDragHelpers();
  const isActive = canDrop && isOver;

  return (
    <div
      ref={drop}
      onDropCapture={handleNativeFolderDrop}
      className={cn('relative flex h-full w-full', className)}
    >
      {children}
      {/** Always render overlay to avoid mount/unmount overhead */}
      <DragDropOverlay isActive={isActive} />
      <DragDropModal />
    </div>
  );
}

export default function DragDropWrapper({ children, className }: DragDropWrapperProps) {
  return (
    <DragDropProvider>
      <UploadModalProvider>
        <DragDropArea className={className}>{children}</DragDropArea>
      </UploadModalProvider>
    </DragDropProvider>
  );
}
