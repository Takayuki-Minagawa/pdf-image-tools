import { useCallback, useState } from 'react';

interface UseDropzoneProps {
  accept?: string[];
  onDrop: (files: File[]) => void;
}

export function useDropzone({ accept, onDrop }: UseDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const filteredFiles = accept
        ? files.filter((file) =>
            accept.some((type) => {
              if (type.startsWith('.')) {
                return file.name.toLowerCase().endsWith(type.toLowerCase());
              }
              return file.type.match(type);
            })
          )
        : files;

      if (filteredFiles.length > 0) {
        onDrop(filteredFiles);
      }
    },
    [accept, onDrop]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        onDrop(files);
      }
      e.target.value = '';
    },
    [onDrop]
  );

  return {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
  };
}
