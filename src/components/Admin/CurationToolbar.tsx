/**
 * Curation Toolbar
 *
 * Fixed bottom toolbar that appears in admin mode.
 * Provides batch operations, undo/redo, and export functions.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Archive,
  Trash2,
  Undo,
  Redo,
  Download,
  X,
  Star,
  ChevronUp,
  ChevronDown,
  Settings,
  Copy,
  FileJson,
  Terminal,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useCurationStore } from '@/stores/curationStore';
import { useGalleryStore } from '@/stores/galleryStore';
import { IS_LOCAL_DEV } from '@/config';

export function CurationToolbar() {
  const {
    isAdminMode,
    selectedIds,
    batchSetStatus,
    batchSetRating,
    undo,
    redo,
    canUndo,
    canRedo,
    clearSelection,
    getStats,
    getIdsByStatus,
    removeDecisions,
    exportAsJSON,
    exportAsShellScript,
  } = useCurationStore();

  const { removeImages } = useGalleryStore();

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isAdminMode) return null;

  const selectedCount = selectedIds.size;
  const stats = getStats();
  const deleteMarkedCount = stats.delete;

  // Apply deletions via GraphQL mutation (batch operation)
  const handleApplyDeletions = async () => {
    if (IS_LOCAL_DEV) {
      setDeleteError('Deletion API not available in local dev mode');
      return;
    }

    const idsToDelete = getIdsByStatus('delete');
    if (idsToDelete.length === 0) {
      setDeleteError('No images marked for deletion');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);
    setDeleteProgress({ current: 0, total: idsToDelete.length });

    try {
      // Dynamically import Amplify client
      const { generateClient } = await import('aws-amplify/api');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = generateClient() as any;

      // Batch delete - send all IDs at once, manifest regenerated once
      const result = await client.graphql({
        query: `mutation DeleteImageFiles($imageIds: [String!]!) {
          deleteImageFiles(imageIds: $imageIds) {
            success
            deletedImageIds
            failedImageIds
            deletedFiles
            message
            manifestUpdated
          }
        }`,
        variables: { imageIds: idsToDelete },
      });

      const data = result.data?.deleteImageFiles;

      if (data?.deletedImageIds?.length > 0) {
        removeImages(data.deletedImageIds);
        removeDecisions(data.deletedImageIds);
        console.log(`Batch deleted: ${data.deletedImageIds.length} images`, data.message);
      }

      if (data?.failedImageIds?.length > 0) {
        setDeleteError(`Deleted ${data.deletedImageIds.length}/${idsToDelete.length}. Failed: ${data.failedImageIds.join(', ')}`);
      } else if (!data?.success) {
        setDeleteError(data?.message || 'Delete operation failed');
      }

      setDeleteProgress({ current: idsToDelete.length, total: idsToDelete.length });
    } catch (err) {
      setDeleteError(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };
  
  const handleExportJSON = () => {
    const json = exportAsJSON();
    downloadFile(json, 'curation-decisions.json', 'application/json');
    setShowExportMenu(false);
  };
  
  const handleExportScript = () => {
    const script = exportAsShellScript('./processed_gallery');
    downloadFile(script, 'apply-curation.sh', 'text/x-shellscript');
    setShowExportMenu(false);
  };
  
  const handleCopyScript = async () => {
    const script = exportAsShellScript('./processed_gallery');
    await navigator.clipboard.writeText(script);
    setShowExportMenu(false);
  };
  
  return (
    <>
      {/* Stats panel (collapsible) */}
      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-80 
                       bg-nebula-900/95 backdrop-blur border border-nebula-700 
                       rounded-lg p-4 shadow-xl z-40"
          >
            <h3 className="text-sm font-medium text-white mb-3">Curation Statistics</h3>
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatItem label="Total Reviewed" value={stats.total} />
              <StatItem label="Unreviewed" value={stats.unreviewed} color="text-nebula-400" />
              <StatItem label="Keep" value={stats.keep} color="text-green-400" />
              <StatItem label="Favorite" value={stats.favorite} color="text-stellar-gold" />
              <StatItem label="Archive" value={stats.archive} color="text-yellow-400" />
              <StatItem label="Delete" value={stats.delete} color="text-red-400" />
            </div>
            
            {stats.rated > 0 && (
              <div className="mt-3 pt-3 border-t border-nebula-700">
                <div className="flex justify-between text-sm">
                  <span className="text-nebula-400">Rated images</span>
                  <span className="text-white">{stats.rated}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-nebula-400">Average rating</span>
                  <span className="text-stellar-gold flex items-center gap-1">
                    {stats.avgRating.toFixed(1)}
                    <Star size={12} fill="currentColor" />
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Export menu */}
      <AnimatePresence>
        {showExportMenu && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-20 right-4 w-56
                       bg-nebula-900/95 backdrop-blur border border-nebula-700 
                       rounded-lg shadow-xl z-40 overflow-hidden"
          >
            <button
              onClick={handleExportJSON}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-nebula-800 transition-colors"
            >
              <FileJson size={18} className="text-stellar-cyan" />
              <span className="text-sm text-white">Export as JSON</span>
            </button>
            <button
              onClick={handleExportScript}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-nebula-800 transition-colors"
            >
              <Terminal size={18} className="text-stellar-violet" />
              <span className="text-sm text-white">Export Shell Script</span>
            </button>
            <button
              onClick={handleCopyScript}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-nebula-800 transition-colors"
            >
              <Copy size={18} className="text-nebula-400" />
              <span className="text-sm text-white">Copy Script to Clipboard</span>
            </button>
            {deleteMarkedCount > 0 && !IS_LOCAL_DEV && (
              <>
                <div className="border-t border-nebula-700" />
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    handleApplyDeletions();
                  }}
                  disabled={isDeleting}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-900/30 transition-colors text-red-400"
                >
                  {isDeleting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                  <span className="text-sm">
                    {isDeleting
                      ? `Deleting ${deleteProgress.current}/${deleteProgress.total}...`
                      : `Apply Deletions (${deleteMarkedCount})`}
                  </span>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete error notification */}
      <AnimatePresence>
        {deleteError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96
                       bg-red-900/95 backdrop-blur border border-red-700
                       rounded-lg p-4 shadow-xl z-40"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-200">{deleteError}</p>
                <button
                  onClick={() => setDeleteError(null)}
                  className="mt-2 text-xs text-red-400 hover:text-red-300"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main toolbar */}
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        exit={{ y: 100 }}
        className="fixed bottom-0 left-0 right-0 
                   bg-nebula-900/95 backdrop-blur
                   border-t border-nebula-700 
                   px-4 py-3 z-50"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Selection info */}
          <div className="flex items-center gap-4">
            <div className="text-sm">
              {selectedCount > 0 ? (
                <span className="text-white">
                  <span className="text-stellar-cyan font-mono">{selectedCount}</span>
                  {' '}selected
                </span>
              ) : (
                <span className="text-nebula-400">No selection</span>
              )}
            </div>
            
            {selectedCount > 0 && (
              <button
                onClick={clearSelection}
                className="text-nebula-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          {/* Center: Actions */}
          <div className="flex items-center gap-2">
            {/* Undo/Redo */}
            <div className="flex items-center gap-1 mr-2">
              <ToolbarButton
                onClick={undo}
                disabled={!canUndo()}
                title="Undo"
              >
                <Undo size={18} />
              </ToolbarButton>
              <ToolbarButton
                onClick={redo}
                disabled={!canRedo()}
                title="Redo"
              >
                <Redo size={18} />
              </ToolbarButton>
            </div>
            
            <div className="w-px h-6 bg-nebula-700" />
            
            {/* Quick ratings */}
            <div className="flex items-center gap-1 mx-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <ToolbarButton
                  key={rating}
                  onClick={() => batchSetRating(rating)}
                  disabled={selectedCount === 0}
                  title={`Rate ${rating} star${rating > 1 ? 's' : ''}`}
                  className="w-8"
                >
                  <span className="text-xs font-mono">{rating}★</span>
                </ToolbarButton>
              ))}
            </div>
            
            <div className="w-px h-6 bg-nebula-700" />
            
            {/* Status actions */}
            <ToolbarButton
              onClick={() => batchSetStatus('keep')}
              disabled={selectedCount === 0}
              variant="success"
              title="Keep selected"
            >
              <Check size={18} />
              <span className="hidden sm:inline ml-1">Keep</span>
            </ToolbarButton>
            
            <ToolbarButton
              onClick={() => batchSetStatus('archive')}
              disabled={selectedCount === 0}
              variant="warning"
              title="Archive selected"
            >
              <Archive size={18} />
              <span className="hidden sm:inline ml-1">Archive</span>
            </ToolbarButton>
            
            <ToolbarButton
              onClick={() => batchSetStatus('delete')}
              disabled={selectedCount === 0}
              variant="danger"
              title="Delete selected"
            >
              <Trash2 size={18} />
              <span className="hidden sm:inline ml-1">Delete</span>
            </ToolbarButton>
          </div>
          
          {/* Right: Export & Stats */}
          <div className="flex items-center gap-2">
            <ToolbarButton
              onClick={() => setShowStats(!showStats)}
              title="Show statistics"
              active={showStats}
            >
              <Settings size={18} />
              {showStats ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </ToolbarButton>
            
            <ToolbarButton
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="Export decisions"
              active={showExportMenu}
            >
              <Download size={18} />
            </ToolbarButton>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  title?: string;
  className?: string;
  children: React.ReactNode;
}

function ToolbarButton({
  onClick,
  disabled = false,
  active = false,
  variant = 'default',
  title,
  className = '',
  children,
}: ToolbarButtonProps) {
  const variantClasses = {
    default: `
      text-nebula-300 hover:text-white hover:bg-nebula-800
      ${active ? 'bg-nebula-800 text-white' : ''}
    `,
    success: `
      text-green-400 hover:text-green-300 hover:bg-green-900/30
      disabled:text-green-900
    `,
    warning: `
      text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30
      disabled:text-yellow-900
    `,
    danger: `
      text-red-400 hover:text-red-300 hover:bg-red-900/30
      disabled:text-red-900
    `,
  };
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        px-3 py-2 rounded-lg text-sm font-medium
        flex items-center justify-center
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

function StatItem({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-nebula-400">{label}</span>
      <span className={`font-mono ${color}`}>{value}</span>
    </div>
  );
}

// =============================================================================
// UTILITIES
// =============================================================================

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


