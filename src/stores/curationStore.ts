/**
 * Curation Store
 * 
 * Manages the admin/curation mode for reviewing, rating, and organizing images.
 * Uses IndexedDB (via Dexie.js pattern) for persistent storage across sessions.
 * 
 * Key features:
 * - Rate images 0-5 stars
 * - Mark images as keep/archive/delete
 * - Batch operations on selections
 * - Undo/redo with full history
 * - Export decisions for file operations
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ImageMetadata } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

export type CurationStatus = 
  | 'unreviewed'   // Not yet reviewed
  | 'keep'         // Keep in gallery
  | 'archive'      // Move to archive
  | 'delete'       // Mark for deletion
  | 'favorite';    // Best of the best

export interface CurationDecision {
  imageId: string;
  status: CurationStatus;
  rating: number;        // 0-5 stars (0 = unrated)
  notes?: string;
  reviewedAt: number;    // Unix timestamp
}

export interface DuplicateGroup {
  masterId: string;       // The one to keep
  duplicateIds: string[]; // Others to consider deleting
  similarity: number;     // 0-1
}

export interface CurationSession {
  startedAt: number;
  imagesReviewed: number;
  deletesMarked: number;
  archivesMarked: number;
}

// For undo/redo
interface HistoryEntry {
  decisions: CurationDecision[];
  description: string;
}

// =============================================================================
// STORE
// =============================================================================

interface CurationStore {
  // Mode
  isAdminMode: boolean;
  toggleAdminMode: () => void;
  
  // Current session
  session: CurationSession | null;
  startSession: () => void;
  endSession: () => void;
  
  // Decisions (persisted)
  decisions: Record<string, CurationDecision>;
  setDecision: (imageId: string, update: Partial<CurationDecision>) => void;
  getDecision: (imageId: string) => CurationDecision | undefined;
  clearAllDecisions: () => void;
  
  // Ratings shorthand
  setRating: (imageId: string, rating: number) => void;
  setStatus: (imageId: string, status: CurationStatus) => void;
  
  // Batch selection
  selectedIds: Set<string>;
  toggleSelected: (imageId: string) => void;
  selectRange: (startId: string, endId: string, allIds: string[]) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (imageId: string) => boolean;
  
  // Batch operations
  batchSetStatus: (status: CurationStatus) => void;
  batchSetRating: (rating: number) => void;
  
  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  
  // Duplicates
  duplicateGroups: DuplicateGroup[];
  loadDuplicates: (groups: DuplicateGroup[]) => void;
  currentDuplicateIndex: number;
  nextDuplicateGroup: () => void;
  prevDuplicateGroup: () => void;
  getCurrentDuplicateGroup: () => DuplicateGroup | null;
  
  // Statistics
  getStats: () => {
    total: number;
    unreviewed: number;
    keep: number;
    archive: number;
    delete: number;
    favorite: number;
    rated: number;
    avgRating: number;
  };
  
  // Export
  exportAsJSON: () => string;
  exportAsShellScript: (baseDir: string) => string;
  importDecisions: (json: string) => void;
}

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

export const useCurationStore = create<CurationStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isAdminMode: false,
      session: null,
      decisions: {},
      selectedIds: new Set(),
      undoStack: [],
      redoStack: [],
      duplicateGroups: [],
      currentDuplicateIndex: 0,
      
      // Mode toggle
      toggleAdminMode: () => {
        const current = get().isAdminMode;
        if (!current) {
          get().startSession();
        } else {
          get().endSession();
        }
        set({ isAdminMode: !current });
      },
      
      // Session management
      startSession: () => {
        set({
          session: {
            startedAt: Date.now(),
            imagesReviewed: 0,
            deletesMarked: 0,
            archivesMarked: 0,
          },
        });
      },
      
      endSession: () => {
        set({ session: null });
      },
      
      // Decision management
      setDecision: (imageId: string, update: Partial<CurationDecision>) => {
        const state = get();
        const existing = state.decisions[imageId];
        
        // Save to undo stack
        const previousDecisions = existing ? [existing] : [];
        
        const newDecision: CurationDecision = {
          imageId,
          status: update.status ?? existing?.status ?? 'unreviewed',
          rating: update.rating ?? existing?.rating ?? 0,
          notes: update.notes ?? existing?.notes,
          reviewedAt: Date.now(),
        };
        
        set({
          decisions: {
            ...state.decisions,
            [imageId]: newDecision,
          },
          undoStack: [
            ...state.undoStack,
            { decisions: previousDecisions, description: `Update ${imageId}` },
          ],
          redoStack: [], // Clear redo on new action
        });
        
        // Update session stats
        if (state.session && !existing) {
          set({
            session: {
              ...state.session,
              imagesReviewed: state.session.imagesReviewed + 1,
            },
          });
        }
      },
      
      getDecision: (imageId: string) => {
        return get().decisions[imageId];
      },
      
      clearAllDecisions: () => {
        const state = get();
        // Save all to undo
        set({
          undoStack: [
            ...state.undoStack,
            { decisions: Object.values(state.decisions), description: 'Clear all' },
          ],
          decisions: {},
          redoStack: [],
        });
      },
      
      // Rating shortcuts
      setRating: (imageId: string, rating: number) => {
        get().setDecision(imageId, { rating: Math.max(0, Math.min(5, rating)) });
      },
      
      setStatus: (imageId: string, status: CurationStatus) => {
        get().setDecision(imageId, { status });
      },
      
      // Selection
      toggleSelected: (imageId: string) => {
        const selected = new Set(get().selectedIds);
        if (selected.has(imageId)) {
          selected.delete(imageId);
        } else {
          selected.add(imageId);
        }
        set({ selectedIds: selected });
      },
      
      selectRange: (startId: string, endId: string, allIds: string[]) => {
        const startIdx = allIds.indexOf(startId);
        const endIdx = allIds.indexOf(endId);
        if (startIdx === -1 || endIdx === -1) return;
        
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = allIds.slice(from, to + 1);
        
        const selected = new Set(get().selectedIds);
        rangeIds.forEach(id => selected.add(id));
        set({ selectedIds: selected });
      },
      
      selectAll: (ids: string[]) => {
        set({ selectedIds: new Set(ids) });
      },
      
      clearSelection: () => {
        set({ selectedIds: new Set() });
      },
      
      isSelected: (imageId: string) => {
        return get().selectedIds.has(imageId);
      },
      
      // Batch operations
      batchSetStatus: (status: CurationStatus) => {
        const state = get();
        const ids = Array.from(state.selectedIds);
        if (ids.length === 0) return;
        
        // Save to undo
        const previousDecisions = ids
          .map(id => state.decisions[id])
          .filter(Boolean) as CurationDecision[];
        
        // Apply to all
        const newDecisions = { ...state.decisions };
        ids.forEach(id => {
          newDecisions[id] = {
            ...newDecisions[id],
            imageId: id,
            status,
            rating: newDecisions[id]?.rating ?? 0,
            reviewedAt: Date.now(),
          };
        });
        
        set({
          decisions: newDecisions,
          undoStack: [
            ...state.undoStack,
            { decisions: previousDecisions, description: `Batch ${status} (${ids.length})` },
          ],
          redoStack: [],
          selectedIds: new Set(), // Clear selection after batch
        });
      },
      
      batchSetRating: (rating: number) => {
        const state = get();
        const ids = Array.from(state.selectedIds);
        if (ids.length === 0) return;
        
        const previousDecisions = ids
          .map(id => state.decisions[id])
          .filter(Boolean) as CurationDecision[];
        
        const newDecisions = { ...state.decisions };
        ids.forEach(id => {
          newDecisions[id] = {
            ...newDecisions[id],
            imageId: id,
            status: newDecisions[id]?.status ?? 'keep',
            rating: Math.max(0, Math.min(5, rating)),
            reviewedAt: Date.now(),
          };
        });
        
        set({
          decisions: newDecisions,
          undoStack: [
            ...state.undoStack,
            { decisions: previousDecisions, description: `Batch rate ${rating}★ (${ids.length})` },
          ],
          redoStack: [],
        });
      },
      
      // Undo/Redo
      undo: () => {
        const state = get();
        if (state.undoStack.length === 0) return;
        
        const lastEntry = state.undoStack[state.undoStack.length - 1];
        const newUndo = state.undoStack.slice(0, -1);
        
        // Get current state of those decisions for redo
        const currentDecisions = lastEntry.decisions
          .map(d => state.decisions[d.imageId])
          .filter(Boolean) as CurationDecision[];
        
        // Restore previous decisions
        const newDecisions = { ...state.decisions };
        lastEntry.decisions.forEach(d => {
          if (d.status === 'unreviewed' && d.rating === 0) {
            delete newDecisions[d.imageId];
          } else {
            newDecisions[d.imageId] = d;
          }
        });
        
        set({
          decisions: newDecisions,
          undoStack: newUndo,
          redoStack: [
            ...state.redoStack,
            { decisions: currentDecisions, description: lastEntry.description },
          ],
        });
      },
      
      redo: () => {
        const state = get();
        if (state.redoStack.length === 0) return;
        
        const lastEntry = state.redoStack[state.redoStack.length - 1];
        const newRedo = state.redoStack.slice(0, -1);
        
        // Get current state for undo
        const currentDecisions = lastEntry.decisions
          .map(d => state.decisions[d.imageId])
          .filter(Boolean) as CurationDecision[];
        
        // Apply redo
        const newDecisions = { ...state.decisions };
        lastEntry.decisions.forEach(d => {
          newDecisions[d.imageId] = d;
        });
        
        set({
          decisions: newDecisions,
          redoStack: newRedo,
          undoStack: [
            ...state.undoStack,
            { decisions: currentDecisions, description: lastEntry.description },
          ],
        });
      },
      
      canUndo: () => get().undoStack.length > 0,
      canRedo: () => get().redoStack.length > 0,
      
      // Duplicates
      loadDuplicates: (groups: DuplicateGroup[]) => {
        set({ duplicateGroups: groups, currentDuplicateIndex: 0 });
      },
      
      nextDuplicateGroup: () => {
        const state = get();
        if (state.currentDuplicateIndex < state.duplicateGroups.length - 1) {
          set({ currentDuplicateIndex: state.currentDuplicateIndex + 1 });
        }
      },
      
      prevDuplicateGroup: () => {
        const state = get();
        if (state.currentDuplicateIndex > 0) {
          set({ currentDuplicateIndex: state.currentDuplicateIndex - 1 });
        }
      },
      
      getCurrentDuplicateGroup: () => {
        const state = get();
        return state.duplicateGroups[state.currentDuplicateIndex] ?? null;
      },
      
      // Statistics
      getStats: () => {
        const decisions = Object.values(get().decisions);
        const total = decisions.length;
        
        const byCounts = {
          unreviewed: 0,
          keep: 0,
          archive: 0,
          delete: 0,
          favorite: 0,
        };
        
        let ratedCount = 0;
        let ratingSum = 0;
        
        decisions.forEach(d => {
          byCounts[d.status]++;
          if (d.rating > 0) {
            ratedCount++;
            ratingSum += d.rating;
          }
        });
        
        return {
          total,
          ...byCounts,
          rated: ratedCount,
          avgRating: ratedCount > 0 ? ratingSum / ratedCount : 0,
        };
      },
      
      // Export
      exportAsJSON: () => {
        const state = get();
        return JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          decisions: Object.values(state.decisions),
          stats: state.getStats(),
        }, null, 2);
      },
      
      exportAsShellScript: (baseDir: string) => {
        const decisions = Object.values(get().decisions);
        const deleteCount = decisions.filter(d => d.status === 'delete').length;
        const archiveCount = decisions.filter(d => d.status === 'archive').length;
        
        const lines = [
          '#!/bin/bash',
          '#',
          '# PixNdx Gallery Curation Script',
          `# Generated: ${new Date().toISOString()}`,
          `# Deletions: ${deleteCount}, Archives: ${archiveCount}`,
          '#',
          '# Usage: ./pixndx_curation.sh /path/to/gallery_processed',
          '#',
          '',
          '# Check for required argument',
          'if [ -z "$1" ]; then',
          `  echo "Usage: $0 /path/to/gallery_processed"`,
          `  echo ""`,
          `  echo "Default: ${baseDir}"`,
          `  echo ""`,
          '  exit 1',
          'fi',
          '',
          'BASE_DIR="$1"',
          '',
          '# Verify directory exists',
          'if [ ! -d "$BASE_DIR" ]; then',
          '  echo "❌ Directory not found: $BASE_DIR"',
          '  exit 1',
          'fi',
          '',
          'echo "📁 Processing gallery: $BASE_DIR"',
          'echo ""',
          '',
          '# Create output directories',
          'mkdir -p "$BASE_DIR/archive/full" "$BASE_DIR/archive/medium" "$BASE_DIR/archive/small" "$BASE_DIR/archive/metadata"',
          'mkdir -p "$BASE_DIR/deleted/full" "$BASE_DIR/deleted/medium" "$BASE_DIR/deleted/small" "$BASE_DIR/deleted/metadata"',
          '',
          '# Counters',
          'DELETED=0',
          'ARCHIVED=0',
          '',
          '# Process images',
        ];
        
        decisions.forEach(d => {
          if (d.status === 'delete') {
            lines.push(`# Delete: ${d.imageId}`);
            lines.push(`if ls "$BASE_DIR/full/${d.imageId}."* 1>/dev/null 2>&1; then`);
            lines.push(`  mv "$BASE_DIR/full/${d.imageId}."* "$BASE_DIR/deleted/full/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/medium/${d.imageId}."* "$BASE_DIR/deleted/medium/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/small/${d.imageId}."* "$BASE_DIR/deleted/small/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/metadata/${d.imageId}.json" "$BASE_DIR/deleted/metadata/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/metadata/${d.imageId}.npy" "$BASE_DIR/deleted/metadata/" 2>/dev/null`);
            lines.push('  ((DELETED++))');
            lines.push(`  echo "🗑️  Deleted: ${d.imageId}"`);
            lines.push('fi');
            lines.push('');
          } else if (d.status === 'archive') {
            lines.push(`# Archive: ${d.imageId}`);
            lines.push(`if ls "$BASE_DIR/full/${d.imageId}."* 1>/dev/null 2>&1; then`);
            lines.push(`  mv "$BASE_DIR/full/${d.imageId}."* "$BASE_DIR/archive/full/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/medium/${d.imageId}."* "$BASE_DIR/archive/medium/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/small/${d.imageId}."* "$BASE_DIR/archive/small/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/metadata/${d.imageId}.json" "$BASE_DIR/archive/metadata/" 2>/dev/null`);
            lines.push(`  mv "$BASE_DIR/metadata/${d.imageId}.npy" "$BASE_DIR/archive/metadata/" 2>/dev/null`);
            lines.push('  ((ARCHIVED++))');
            lines.push(`  echo "📦 Archived: ${d.imageId}"`);
            lines.push('fi');
            lines.push('');
          }
        });
        
        lines.push('echo ""');
        lines.push('echo "════════════════════════════════════════════════"');
        lines.push('echo "✅ Complete: $DELETED deleted, $ARCHIVED archived"');
        lines.push('echo ""');
        lines.push('echo "Deleted files are in: $BASE_DIR/deleted/"');
        lines.push('echo "Archived files are in: $BASE_DIR/archive/"');
        lines.push('echo ""');
        lines.push('echo "⚠️  To permanently remove deleted files:"');
        lines.push('echo "    rm -rf \\"$BASE_DIR/deleted\\""');
        lines.push('echo ""');
        lines.push('echo "🔄 To recompute neighbors after deletion:"');
        lines.push('echo "    ~/pixndx/preprocessing/venv/bin/python ~/pixndx/preprocessing/compute_neighbors.py --gallery \\"$BASE_DIR\\" --threshold 0.25 --max-neighbors 150"');
        lines.push('echo ""');
        
        return lines.join('\n');
      },
      
      importDecisions: (json: string) => {
        try {
          const data = JSON.parse(json);
          if (data.decisions && Array.isArray(data.decisions)) {
            const state = get();
            const newDecisions: Record<string, CurationDecision> = {};
            
            data.decisions.forEach((d: CurationDecision) => {
              if (d.imageId) {
                newDecisions[d.imageId] = d;
              }
            });
            
            set({
              decisions: { ...state.decisions, ...newDecisions },
            });
          }
        } catch (e) {
          console.error('Failed to import decisions:', e);
        }
      },
    }),
    {
      name: 'nebula-curation',
      // Only persist these fields
      partialize: (state) => ({
        decisions: state.decisions,
        duplicateGroups: state.duplicateGroups,
      }),
      // Custom serialization for Set
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

// =============================================================================
// HELPER HOOKS
// =============================================================================

/**
 * Hook to get curation info for a specific image
 */
export function useImageCuration(imageId: string) {
  const { decisions, setRating, setStatus, toggleSelected, isSelected } = useCurationStore();
  const decision = decisions[imageId];
  
  return {
    status: decision?.status ?? 'unreviewed',
    rating: decision?.rating ?? 0,
    notes: decision?.notes,
    isReviewed: !!decision,
    isSelected: isSelected(imageId),
    setRating: (r: number) => setRating(imageId, r),
    setStatus: (s: CurationStatus) => setStatus(imageId, s),
    toggleSelected: () => toggleSelected(imageId),
  };
}


