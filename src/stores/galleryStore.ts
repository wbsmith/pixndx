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
// STORE INTERFACE
// =============================================================================

interface GalleryStore {
  // Data
  images: ImageMetadata[];
  filteredImages: ImageMetadata[];
  edges: SimilarityEdge[];
  
  // Selection
  selectedImage: ImageMetadata | null;
  hoveredImage: ImageMetadata | null;
  
  // Layout
  layout: LayoutConfig;
  similarity: SimilarityConfig;
  
  // Edge computation params (interactive controls)
  edgeParams: {
    maxEdgesPerNode: number;
  };
  
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
  setEdgeParams: (params: { maxEdgesPerNode?: number }) => void;
  setSearchQuery: (query: string) => void;
  setSearchFilters: (filters: SearchQuery['filters']) => void;
  performSearch: () => void;
  recomputeEdges: () => void;
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
  selectedImage: null,
  hoveredImage: null,
  
  layout: {
    type: 'grid',
    similarity: {
      mode: 'composite',
      threshold: 0.6,
      weights: { visual: 0.3, semantic: 0.3, color: 0.2, mood: 0.2 },
    },
  },
  
  similarity: {
    mode: 'composite',
    threshold: 0.6,
    weights: { visual: 0.3, semantic: 0.3, color: 0.2, mood: 0.2 },
  },
  
  edgeParams: {
    maxEdgesPerNode: 15,
  },
  
  searchQuery: '',
  searchFilters: undefined,
  loading: false,
  sidebarOpen: true,
  modalOpen: false,
  
  // ==========================================================================
  // ACTIONS
  // ==========================================================================
  
  setImages: (images) => {
    set({ images, filteredImages: images });
    get().recomputeEdges();
  },
  
  setSelectedImage: (image) => set({ selectedImage: image }),
  
  setHoveredImage: (image) => set({ hoveredImage: image }),
  
  setLayout: (layout) => {
    set({ layout });
    if (layout.similarity) {
      get().setSimilarity(layout.similarity);
    }
    // Recompute edges when switching to network layout
    if (layout.type === 'network') {
      get().recomputeEdges();
    }
  },
  
  setSimilarity: (config) => {
    set({ similarity: config });
    get().recomputeEdges();
  },
  
  setEdgeParams: (params) => {
    set((state) => ({
      edgeParams: { ...state.edgeParams, ...params },
    }));
    get().recomputeEdges();
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
    
    set({ filteredImages: filtered });
    get().recomputeEdges();
  },
  
  recomputeEdges: () => {
    const { filteredImages, similarity, edgeParams, layout } = get();
    
    // Skip edge computation for grid layout
    if (layout.type === 'grid') {
      set({ edges: [] });
      return;
    }
    
    // Compute edges at runtime using the new utility
    const edges = computeEdges(filteredImages, {
      mode: similarity.mode,
      threshold: similarity.threshold,
      maxEdgesPerNode: edgeParams.maxEdgesPerNode,
      weights: {
        clip: 0.6,
        metadata: 0.4,
      },
    });
    
    set({ edges });
  },
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  openModal: (image) => set({ modalOpen: true, selectedImage: image }),
  
  closeModal: () => set({ modalOpen: false }),
}));
