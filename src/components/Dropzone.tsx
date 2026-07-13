import { useId, useRef } from 'react';
import { FileImage, Upload } from 'lucide-react';
import { useDropzone } from '../hooks/useDropzone';
import type { FileRejection } from '../hooks/useDropzone';

interface DropzoneProps {
  accept: string[];
  onDrop: (files: File[]) => void;
  title: string;
  description: string;
  icon?: 'upload' | 'image';
  onReject?: (rejections: FileRejection[]) => void;
  disabled?: boolean;
}

export function Dropzone({
  accept,
  onDrop,
  title,
  description,
  icon = 'upload',
  onReject,
  disabled = false,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const rejectionId = `${id}-rejection`;
  const { isDragging, rejections, handleDragOver, handleDragLeave, handleDrop, handleFileSelect } =
    useDropzone({ accept, onDrop, onReject, disabled });

  const IconComponent = icon === 'image' ? FileImage : Upload;
  const openFilePicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${rejections.length > 0 ? ` ${rejectionId}` : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFilePicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openFilePicker();
          }
        }}
        className={`relative flex h-64 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
          disabled
            ? 'cursor-not-allowed border-gray-200 bg-gray-100 opacity-60'
            : isDragging
              ? 'scale-[1.02] cursor-copy border-blue-500 bg-blue-50'
              : 'cursor-pointer border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          multiple
          disabled={disabled}
          onChange={handleFileSelect}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <IconComponent
          className={`mb-4 h-12 w-12 transition-colors ${isDragging ? 'text-blue-500' : 'text-gray-400'}`}
          aria-hidden="true"
        />
        <p id={titleId} className={`mb-1 text-lg font-medium ${isDragging ? 'text-blue-700' : 'text-gray-700'}`}>
          {isDragging ? 'ここにドロップしてください' : title}
        </p>
        <p id={descriptionId} className="text-sm text-gray-500">
          {description}
        </p>
        <p className="mt-2 text-xs text-gray-400">Enter または Space キーでもファイルを選べます</p>
      </div>

      {rejections.length > 0 && (
        <div
          id={rejectionId}
          role="alert"
          aria-live="assertive"
          className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {rejections.length === 1
            ? rejections[0].message
            : `${rejections.length}件のファイルは対応していない形式のため追加できませんでした。`}
        </div>
      )}
    </div>
  );
}
