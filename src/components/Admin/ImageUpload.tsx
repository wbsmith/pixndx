import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { uploadData } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

type UploadStatus = 'pending' | 'uploading' | 'processing' | 'complete' | 'error';

interface FileUpload {
  id: string;
  file: File;
  preview: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

const client = generateClient<Schema>();

export function ImageUpload() {
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateUpload = useCallback((id: string, updates: Partial<FileUpload>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
  }, []);

  const processFile = useCallback(async (upload: FileUpload) => {
    const { id, file } = upload;

    try {
      // Stage 1: Upload to S3
      updateUpload(id, { status: 'uploading', progress: 0 });

      const key = `uploads/admin/${Date.now()}-${file.name}`;

      await uploadData({
        path: key,
        data: file,
        options: {
          contentType: file.type,
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (totalBytes) {
              const progress = Math.round((transferredBytes / totalBytes) * 100);
              updateUpload(id, { progress });
            }
          },
        },
      }).result;

      // Stage 2: Trigger processing
      updateUpload(id, { status: 'processing', progress: 100 });

      const result = await client.mutations.processImage({ sourceKey: key });

      if (result.errors) {
        throw new Error(result.errors.map(e => e.message).join(', '));
      }

      updateUpload(id, { status: 'complete' });
    } catch (error) {
      console.error('Upload failed:', error);
      updateUpload(id, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed'
      });
    }
  }, [updateUpload]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));

    const newUploads: FileUpload[] = imageFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
      status: 'pending' as const,
      progress: 0,
    }));

    setUploads(prev => [...prev, ...newUploads]);

    // Start uploading each file
    newUploads.forEach(upload => processFile(upload));
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads(prev => {
      const upload = prev.find(u => u.id === id);
      if (upload) {
        URL.revokeObjectURL(upload.preview);
      }
      return prev.filter(u => u.id !== id);
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads(prev => {
      prev.filter(u => u.status === 'complete').forEach(u => URL.revokeObjectURL(u.preview));
      return prev.filter(u => u.status !== 'complete');
    });
  }, []);

  const hasCompleted = uploads.some(u => u.status === 'complete');

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative p-6 rounded-lg border-2 border-dashed cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-stellar-cyan bg-stellar-cyan/10'
            : 'border-nebula-600 hover:border-nebula-500 bg-nebula-800/30'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-2 text-center">
          <Upload
            size={24}
            className={isDragging ? 'text-stellar-cyan' : 'text-nebula-400'}
          />
          <p className="text-sm text-nebula-300">
            Drop images or click to upload
          </p>
          <p className="text-xs text-nebula-500">
            JPG, PNG, WebP
          </p>
        </div>
      </div>

      {/* Upload list */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {/* Clear completed button */}
            {hasCompleted && (
              <button
                onClick={clearCompleted}
                className="text-xs text-nebula-400 hover:text-nebula-300"
              >
                Clear completed
              </button>
            )}

            {uploads.map((upload) => (
              <UploadItem
                key={upload.id}
                upload={upload}
                onRemove={() => removeUpload(upload.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface UploadItemProps {
  upload: FileUpload;
  onRemove: () => void;
}

function UploadItem({ upload, onRemove }: UploadItemProps) {
  const { preview, file, status, progress, error } = upload;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex items-center gap-3 p-2 rounded-lg bg-nebula-800/50"
    >
      {/* Thumbnail */}
      <div className="relative w-10 h-10 rounded overflow-hidden flex-shrink-0">
        <img
          src={preview}
          alt={file.name}
          className="w-full h-full object-cover"
        />
        {status === 'complete' && (
          <div className="absolute inset-0 bg-stellar-green/30 flex items-center justify-center">
            <Check size={16} className="text-stellar-green" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
            <AlertCircle size={16} className="text-red-400" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-nebula-300 truncate">{file.name}</p>
        <div className="flex items-center gap-2">
          <StatusIndicator status={status} progress={progress} />
          {error && (
            <span className="text-xs text-red-400 truncate">{error}</span>
          )}
        </div>
      </div>

      {/* Remove button */}
      {(status === 'complete' || status === 'error') && (
        <button
          onClick={onRemove}
          className="p-1 text-nebula-500 hover:text-nebula-300"
        >
          <X size={14} />
        </button>
      )}
    </motion.div>
  );
}

function StatusIndicator({ status, progress }: { status: UploadStatus; progress: number }) {
  switch (status) {
    case 'pending':
      return <span className="text-xs text-nebula-500">Pending...</span>;
    case 'uploading':
      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1 bg-nebula-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-stellar-cyan transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-nebula-400">{progress}%</span>
        </div>
      );
    case 'processing':
      return (
        <div className="flex items-center gap-1 text-stellar-violet">
          <Loader2 size={12} className="animate-spin" />
          <span className="text-xs">Processing...</span>
        </div>
      );
    case 'complete':
      return <span className="text-xs text-stellar-green">Complete</span>;
    case 'error':
      return <span className="text-xs text-red-400">Failed</span>;
  }
}
