import { create } from 'zustand';
import type {
  ImageMetadata,
  LayoutConfig,
  SearchQuery,
  SimilarityConfig,
  SimilarityEdge,
} from '@/types/gallery';
import { computeEdges } from '@/lib/similarity/edgeComputation';
import { loadImagesProgressively, loadRemainingImages, type LoadProgress } from '@/lib/dataLoader';
import { useRatingStore } from '@/stores/ratingStore';

// =============================================================================
// FORCE LAYOUT SETTINGS
// =============================================================================

export interface ForceSettings {
  gravity: number;        // 0.01 - 0.3, pull toward center
  scaling: number;        // 0.3 - 3.0, node spacing multiplier
  edgeWeightInfluence: number;  // 0 - 2.0, how much edge weight affects clustering
}

export const DEFAULT_FORCE_SETTINGS: ForceSettings = {
  gravity: 0.05,
  scaling: 1.0,
  edgeWeightInfluence: 1.0,
};

// Node coloring modes for network graph
export type ColorMode = 'uniform' | 'cluster' | 'community' | 'mood' | 'color';

// =============================================================================
// STORE INTERFACE
// =============================================================================

interface GalleryStore {
  // Data
  images: ImageMetadata[];
  filteredImages: ImageMetadata[];
  edges: SimilarityEdge[];
  graphVersion: number;  // Increments to force graph re-render
  
  // Selection
  selectedImage: ImageMetadata | null;
  hoveredImage: ImageMetadata | null;
  
  // Layout
  layout: LayoutConfig;
  similarity: SimilarityConfig;
  forceSettings: ForceSettings;  // Force layout parameters
  colorMode: ColorMode;  // How nodes are colored in network graph
  
  // Search
  searchQuery: string;
  searchFilters: SearchQuery['filters'];
  
  // UI State
  loading: boolean;
  loadProgress: LoadProgress | null;  // Progressive loading state
  sidebarOpen: boolean;
  modalOpen: boolean;
  
  // Actions
  initializeData: () => Promise<void>;  // Load data progressively
  setImages: (images: ImageMetadata[]) => void;
  addImages: (images: ImageMetadata[]) => void;  // Append more images
  setSelectedImage: (image: ImageMetadata | null) => void;
  setHoveredImage: (image: ImageMetadata | null) => void;
  setLayout: (layout: LayoutConfig) => void;
  setSimilarity: (config: SimilarityConfig) => void;
  setForceSettings: (settings: ForceSettings) => void;
  setColorMode: (mode: ColorMode) => void;
  setSearchQuery: (query: string) => void;
  setSearchFilters: (filters: SearchQuery['filters']) => void;
  performSearch: () => void;
  recomputeEdges: () => void;  // Explicit edge recomputation
  toggleSidebar: () => void;
  openModal: (image: ImageMetadata) => void;
  closeModal: () => void;
  sortByRatings: () => void;  // Sort filtered images by rating (called after ratings load)
}

// =============================================================================
// SEARCH SCORING - AND LOGIC (all words must match)
// =============================================================================

/**
 * Check if a single word matches an image
 * Returns a score > 0 if matched, 0 if not matched
 */
function wordMatchScore(image: ImageMetadata, word: string): number {
  const allTags = Object.values(image.tags)
    .flat()
    .map((t) => t.toLowerCase());
  const tagCategories = Object.keys(image.tags).map(c => c.toLowerCase());
  const filenameLower = image.filename.toLowerCase();
  const descriptionLower = image.description.toLowerCase();
  const moodLower = image.mood.toLowerCase();
  const subjectLower = image.main_subject.toLowerCase();
  const colorNames = Object.keys(image.main_colors).map(n => n.toLowerCase());
  
  // Check each field for a match - return score for best match found
  if (filenameLower.includes(word)) return 4;
  if (allTags.includes(word)) return 3;
  if (tagCategories.includes(word)) return 2.5;
  if (allTags.some((t) => t.includes(word))) return 2;
  if (subjectLower.includes(word)) return 2;
  if (moodLower.includes(word)) return 2;
  if (colorNames.some(name => name.includes(word))) return 2;
  if (descriptionLower.includes(word)) return 1.5;
  
  return 0; // No match
}

/**
 * Score an image against a search query.
 * Uses AND logic: ALL words must match for the image to be included.
 * Returns 0 if any word doesn't match.
 */
function scoreImage(image: ImageMetadata, query: string): number {
  if (!query.trim()) return 1;
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
  
  if (queryWords.length === 0) return 1;
  
  // AND logic: check that EVERY word matches
  let totalScore = 0;
  for (const word of queryWords) {
    const wordScore = wordMatchScore(image, word);
    if (wordScore === 0) {
      // This word didn't match - fail the entire image
      return 0;
    }
    totalScore += wordScore;
  }
  
  // Bonus for exact phrase match in description or subject
  if (queryWords.length > 1) {
    const phrase = queryLower;
    if (image.description.toLowerCase().includes(phrase)) {
      totalScore += 3;
    }
    if (image.main_subject.toLowerCase().includes(phrase)) {
      totalScore += 3;
    }
  }
  
  return totalScore;
}

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  // Initial state - START EMPTY, load progressively
  images: [],
  filteredImages: [],
  edges: [],
  graphVersion: 0,
  selectedImage: null,
  hoveredImage: null,
  
  layout: {
    type: 'grid',
  },
  
  // Default similarity settings
  similarity: {
    mode: 'clip',
    thresholdMin: 0.35,  // Lower bound - show edges above this weight
    thresholdMax: 1.0,   // Upper bound - include all up to duplicates
    maxEdgesPerNode: 25,
  },
  
  // Force layout settings
  forceSettings: DEFAULT_FORCE_SETTINGS,
  colorMode: 'color' as ColorMode,  // Default to color-based node outlines
  
  searchQuery: '',
  searchFilters: undefined,
  loading: true,  // Start in loading state
  loadProgress: null,
  sidebarOpen: true,
  modalOpen: false,
  
  // ==========================================================================
  // ACTIONS
  // ==========================================================================
  
  /**
   * Initialize data with progressive loading.
   * Shows first 50 images almost immediately, then loads the rest in background.
   */
  initializeData: async () => {
    // Guard against double-initialization (React StrictMode)
    const { images } = get();
    if (images.length > 0) {
      console.log('initializeData already called, skipping');
      return;
    }
    
    set({ loading: true });
    
    try {
      // Load initial batch (fast!)
      const initialImages = await loadImagesProgressively((progress) => {
        set({ loadProgress: progress });
      });
      
      // Deduplicate initial images (in case source has duplicates)
      const seen = new Set<string>();
      const uniqueInitial = initialImages.filter(img => {
        if (seen.has(img.id)) return false;
        seen.add(img.id);
        return true;
      });
      
      // Show initial images immediately
      set({ 
        images: uniqueInitial, 
        filteredImages: uniqueInitial,
        loading: uniqueInitial.length < 100,  // Still loading if more to come
      });
      
      // Load remaining in background
      await loadRemainingImages((chunk, progress) => {
        const { images, searchQuery } = get();
        
        // Deduplicate by ID to prevent React key warnings
        const existingIds = new Set(images.map(img => img.id));
        const uniqueChunk = chunk.filter(img => !existingIds.has(img.id));
        const newImages = [...images, ...uniqueChunk];
        
        // If there's no search query, also update filteredImages
        const newFiltered = searchQuery ? get().filteredImages : newImages;
        
        set({ 
          images: newImages,
          filteredImages: newFiltered,
          loadProgress: progress,
          loading: !progress.complete,
        });
      });
      
      console.log(`✅ Loaded ${get().images.length} images`);
    } catch (error) {
      console.error('Failed to load images:', error);
      set({ loading: false });
    }
  },
  
  setImages: (images) => {
    set({ images, filteredImages: images, edges: [] });
  },
  
  addImages: (newImages) => {
    const { images, searchQuery } = get();
    // Deduplicate by ID
    const existingIds = new Set(images.map(img => img.id));
    const uniqueNew = newImages.filter(img => !existingIds.has(img.id));
    const allImages = [...images, ...uniqueNew];
    const filtered = searchQuery ? get().filteredImages : allImages;
    set({ images: allImages, filteredImages: filtered });
  },
  
  setSelectedImage: (image) => set({ selectedImage: image }),
  
  setHoveredImage: (image) => set({ hoveredImage: image }),
  
  setLayout: (layout) => {
    set({ layout });
    // Auto-compute edges when switching TO network (if not already computed)
    if (layout.type === 'network' && get().edges.length === 0) {
      get().recomputeEdges();
    }
    // Don't clear edges when switching away - they're just data in memory
    // and clearing them causes a flash as the network re-renders with 0 edges
  },
  
  setSimilarity: (config) => {
    set({ similarity: config });
    // NOTE: Does NOT auto-recompute edges
  },
  
  setForceSettings: (settings) => {
    // Just update settings - don't trigger re-render
    // User must click "Apply" button to trigger recomputeEdges() which increments graphVersion
    set({ forceSettings: settings });
  },
  
  setColorMode: (mode) => {
    // Just update color mode - does NOT trigger full re-layout
    // Graph components will update colors via a separate effect
    set({ colorMode: mode });
  },
  
  setSearchQuery: (query) => {
    set({ searchQuery: query });
    get().performSearch();
  },
  
  setSearchFilters: (filters) => {
    set({ searchFilters: filters });
    get().performSearch();
  },
  
  performSearch: () => {
    const { images, searchQuery, searchFilters } = get();
    
    let filtered = [...images];
    
    // Special case: Top Rated sorting
    if (searchQuery === '__top_rated__') {
      const ratingStore = useRatingStore.getState();
      
      // Sort by average rating (highest first), with count as tiebreaker
      filtered = filtered.sort((a, b) => {
        const ratingA = ratingStore.getRating(a.id);
        const ratingB = ratingStore.getRating(b.id);
        
        // Primary sort: by average rating (descending)
        if (ratingB.avg !== ratingA.avg) {
          return ratingB.avg - ratingA.avg;
        }
        // Secondary sort: by count (more ratings = more trustworthy)
        return ratingB.count - ratingA.count;
      });
      
      // Filter to only show rated images
      filtered = filtered.filter(img => {
        const rating = ratingStore.getRating(img.id);
        return rating.count > 0;
      });
      
      set({ filteredImages: filtered, edges: [] });
      return;
    }
    
    // Apply text search with AND logic
    if (searchQuery.trim()) {
      const scored = filtered.map((img) => ({
        image: img,
        score: scoreImage(img, searchQuery),
      }));
      
      filtered = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.image);
    }
    
    // Apply filters
    if (searchFilters) {
      if (searchFilters.tags?.length) {
        filtered = filtered.filter((img) => {
          const allTags = Object.values(img.tags).flat();
          return searchFilters.tags!.some((t) =>
            allTags.some((imgTag) => imgTag.toLowerCase().includes(t.toLowerCase()))
          );
        });
      }
      
      if (searchFilters.mood?.length) {
        filtered = filtered.filter((img) =>
          searchFilters.mood!.some((m) =>
            img.mood.toLowerCase().includes(m.toLowerCase())
          )
        );
      }
    }
    
    set({ filteredImages: filtered, edges: [] });
  },
  
  /**
   * Recompute edges from precomputed neighbors.
   * Call this explicitly when user clicks "Apply" button.
   */
  recomputeEdges: () => {
    const { filteredImages, similarity, layout } = get();
    
    // Skip for non-network layouts
    if (layout.type !== 'network') {
      set({ edges: [] });
      return;
    }
    
    // Skip if no images
    if (filteredImages.length === 0) {
      set({ edges: [] });
      return;
    }
    
    // Filter precomputed edges (fast!)
    const edges = computeEdges(filteredImages, {
      mode: similarity.mode,
      thresholdMin: similarity.thresholdMin,
      thresholdMax: similarity.thresholdMax,
      maxEdgesPerNode: similarity.maxEdgesPerNode,
    });
    
    // Increment graphVersion to force graph re-render
    set({ edges, graphVersion: get().graphVersion + 1 });
  },
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  openModal: (image) => set({ modalOpen: true, selectedImage: image }),
  
  closeModal: () => set({ modalOpen: false }),
  
  sortByRatings: () => {
    const { filteredImages, searchQuery } = get();
    
    // Don't override if there's an active search (let search handle sorting)
    if (searchQuery.trim()) return;
    
    const ratingStore = useRatingStore.getState();
    
    // Sort: highest rated first, then by count, then unrated images at the end
    const sorted = [...filteredImages].sort((a, b) => {
      const ratingA = ratingStore.getRating(a.id);
      const ratingB = ratingStore.getRating(b.id);
      
      // Both have ratings: sort by avg (desc), then count (desc)
      if (ratingA.count > 0 && ratingB.count > 0) {
        if (ratingB.avg !== ratingA.avg) {
          return ratingB.avg - ratingA.avg;
        }
        return ratingB.count - ratingA.count;
      }
      
      // Only one has rating: rated images come first
      if (ratingA.count > 0 && ratingB.count === 0) return -1;
      if (ratingB.count > 0 && ratingA.count === 0) return 1;
      
      // Neither has rating: maintain original order (by ID for stability)
      return 0;
    });
    
    set({ filteredImages: sorted });
    console.log('[GalleryStore] Sorted images by rating');
  },
}));
