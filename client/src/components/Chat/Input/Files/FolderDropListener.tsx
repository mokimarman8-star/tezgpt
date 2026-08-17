/**
 * TezGPT — receives folder-drop events from DragDropWrapper and feeds the
 * collected files into the normal upload pipeline (real chat file state).
 */

import { useEffect } from 'react';
import { useFileHandlingNoChatContext } from '~/hooks';
import type { TConversation } from 'tezgpt-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';

interface FolderDropListenerProps {
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  conversation: TConversation | null;
}

export default function FolderDropListener({
  files,
  setFiles,
  setFilesLoading,
  conversation,
}: FolderDropListenerProps) {
  const { handleFiles } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  useEffect(() => {
    const onFolderDrop = (e: Event) => {
      const detail = (e as CustomEvent<{ files: File[] }>).detail;
      if (!detail?.files?.length) {
        return;
      }
      handleFiles(detail.files, undefined, undefined).catch(() => {
        /* pipeline reports its own errors */
      });
    };
    window.addEventListener('tezgpt:folder-drop', onFolderDrop);
    return () => window.removeEventListener('tezgpt:folder-drop', onFolderDrop);
  }, [handleFiles]);

  return null;
}
