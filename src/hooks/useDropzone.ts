import { useCallback, useState } from 'react';

export type FileRejectionReason = 'file-type';

export interface FileRejection {
  file: File;
  reason: FileRejectionReason;
  message: string;
}

export interface UseDropzoneProps {
  accept?: string[];
  onDrop: (files: File[]) => void;
  onReject?: (rejections: FileRejection[]) => void;
  disabled?: boolean;
}

function matchesAcceptedType(file: File, acceptedTypes: string[]): boolean {
  return acceptedTypes.some((acceptedType) => {
    const normalizedType = acceptedType.trim().toLowerCase();
    if (!normalizedType) return false;

    if (normalizedType.startsWith('.')) {
      return file.name.toLowerCase().endsWith(normalizedType);
    }

    if (normalizedType.endsWith('/*')) {
      return file.type.toLowerCase().startsWith(normalizedType.slice(0, -1));
    }

    return file.type.toLowerCase() === normalizedType;
  });
}

function rejectionMessage(file: File, acceptedTypes: string[]): string {
  return `${file.name} は対応していない形式です。対応形式: ${acceptedTypes.join(', ')}`;
}

export function useDropzone({ accept, onDrop, onReject, disabled = false }: UseDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejections, setRejections] = useState<FileRejection[]>([]);

  const processFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;

      const acceptedFiles: File[] = [];
      const rejectedFiles: FileRejection[] = [];

      files.forEach((file) => {
        if (!accept || accept.length === 0 || matchesAcceptedType(file, accept)) {
          acceptedFiles.push(file);
        } else {
          rejectedFiles.push({
            file,
            reason: 'file-type',
            message: rejectionMessage(file, accept),
          });
        }
      });

      setRejections(rejectedFiles);
      if (rejectedFiles.length > 0) onReject?.(rejectedFiles);
      if (acceptedFiles.length > 0) onDrop(acceptedFiles);
    },
    [accept, disabled, onDrop, onReject],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      processFiles(Array.from(event.dataTransfer.files));
    },
    [processFiles],
  );

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(event.target.files ? Array.from(event.target.files) : []);
      event.target.value = '';
    },
    [processFiles],
  );

  const clearRejections = useCallback(() => setRejections([]), []);

  return {
    isDragging,
    rejections,
    clearRejections,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
  };
}
