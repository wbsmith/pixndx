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
}

// =============================================================================
// SEARCH SCORING
// =============================================================================

function scoreImage(image: ImageMetadata, query: string): number {
  if (!query.trim()) return 1;
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);
  
  let score = 0;
  
  // Get all tags as flat array
  const allTags = Object.values(image.tags)
    .flat()
    .map((t) => t.toLowerCase());
  
  // Get tag category names too
  const tagCategories = Object.keys(image.tags).map(c => c.toLowerCase());
  
  // Filename matching (high priority)
  const filenameLower = image.filename.toLowerCase();
  
  for (const word of queryWords) {
    // Filename match (highest priority)
    if (filenameLower.includes(word)) {
      score += 4;
    }
    // Exact tag match
    else if (allTags.includes(word)) {
      score += 3;
    }
    // Tag category match
    else if (tagCategories.includes(word)) {
      score += 2.5;
    }
    // Partial tag match
    else if (allTags.some((t) => t.includes(word))) {
      score += 2;
    }
    // Description match
    else if (image.description.toLowerCase().includes(word)) {
      score += 1.5;
    }
    // Mood match
    else if (image.mood.toLowerCase().includes(word)) {
      score += 2;
    }
    // Main subject match
    else if (image.main_subject.toLowerCase().includes(word)) {
      score += 2;
    }
  }
  
  // Bonus for matching multiple words (phrase match)
  if (queryWords.length > 1) {
    const phrase = queryLower;
    if (image.description.toLowerCase().includes(phrase)) {
      score += 2;
    }
    if (image.main_subject.toLowerCase().includes(phrase)) {
      score += 2;
    }
  }
  
  // Color matching - check color names in main_colors keys
  const colorWords = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan', 'gold', 'golden', 'warm', 'cool', 'bright', 'dark', 'white', 'black', 'gray', 'grey', 'teal', 'amber'];
  const colorNames = Object.keys(image.main_colors).map(n => n.toLowerCase());
  
  for (const word of queryWords) {
    if (colorWords.includes(word)) {
      // Check if color name contains the word
      if (colorNames.some(name => name.includes(word))) {
        score += 2.5;
      }
      // Also check description for color mentions
      if (image.description.toLowerCase().includes(word)) {
        score += 1;
      }
    }
  }
  
  return score;
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
  colorMode: 'uniform' as ColorMode,
  
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
    // Clear edges when switching away from network
    if (layout.type !== 'network') {
      set({ edges: [] });
    } else {
      // Auto-compute edges when switching TO network
      get().recomputeEdges();
    }
  },
  
  setSimilarity: (config) => {
    set({ similarity: config });
    // NOTE: Does NOT auto-recompute edges
  },
  
  setForceSettings: (settings) => {
    set({ forceSettings: settings, graphVersion: get().graphVersion + 1 });
    // Incrementing graphVersion forces graph to re-render with new settings
    // User must click "Apply" button to trigger recomputeEdges()
  },
  
  setColorMode: (mode) => {
    // Just update color mode - affects rendering, not layout
    set({ colorMode: mode, graphVersion: get().graphVersion + 1 });
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
    
    // Apply text search
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
}));
