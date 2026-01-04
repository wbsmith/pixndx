import { create } from 'zustand';
import type {
  ImageMetadata,
  LayoutConfig,
  SearchQuery,
  SimilarityConfig,
  SimilarityEdge,
} from '@/types/gallery';
import { localImages } from '@/data/localImages';
import { computeEdges } from '@/lib/similarity/edgeComputation';

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
  
  // Search
  searchQuery: string;
  searchFilters: SearchQuery['filters'];
  
  // UI State
  loading: boolean;
  sidebarOpen: boolean;
  modalOpen: boolean;
  
  // Actions
  setImages: (images: ImageMetadata[]) => void;
  setSelectedImage: (image: ImageMetadata | null) => void;
  setHoveredImage: (image: ImageMetadata | null) => void;
  setLayout: (layout: LayoutConfig) => void;
  setSimilarity: (config: SimilarityConfig) => void;
  setForceSettings: (settings: ForceSettings) => void;
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
  // Initial state
  images: localImages,
  filteredImages: localImages,
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
  
  searchQuery: '',
  searchFilters: undefined,
  loading: false,
  sidebarOpen: true,
  modalOpen: false,
  
  // ==========================================================================
  // ACTIONS
  // ==========================================================================
  
  setImages: (images) => {
    set({ images, filteredImages: images, edges: [] });
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
