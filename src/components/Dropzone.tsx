import { useRef } from 'react';
import { Upload, FileImage } from 'lucide-react';
import { useDropzone } from '../hooks/useDropzone';

interface DropzoneProps {
  accept: string[];
  onDrop: (files: File[]) => void;
  title: string;
  description: string;
  icon?: 'upload' | 'image';
}

export function Dropzone({ accept, onDrop, title, description, icon = 'upload' }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { isDragging, handleDragOver, handleDragLeave, handleDrop, handleFileSelect } = useDropzone({
    accept,
    onDrop,
  });

  const IconComponent = icon === 'image' ? FileImage : Upload;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center w-full h-64 
        border-2 border-dashed rounded-xl cursor-pointer
        transition-all duration-200 ease-in-out
        ${
          isDragging
            ? 'border-blue-500 bg-blue-50 scale-[1.02]'
            : 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <IconComponent
        className={`w-12 h-12 mb-4 transition-colors ${isDragging ? 'text-blue-500' : 'text-gray-400'}`}
      />
      <p className={`text-lg font-medium mb-1 ${isDragging ? 'text-blue-600' : 'text-gray-700'}`}>{title}</p>
      <p className="text-sm text-gray-500">{description}</p>
    </div>
  );
}
