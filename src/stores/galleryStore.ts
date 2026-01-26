import { create } from 'zustand';
import type {
  ImageMetadata,
  LayoutConfig,
  SearchQuery,
  SimilarityConfig,
  SimilarityEdge,
} from '@/types/gallery';
import { computeEdges } from '@/lib/similarity/edgeComputation';
import { loadImagesProgressively, loadRemainingImages, subscribeToManifestUpdates, refetchManifestFresh, type LoadProgress } from '@/lib/dataLoader';
import { useRatingStore } from '@/stores/ratingStore';

// =============================================================================
// FORCE LAYOUT SETTINGS
// =============================================================================

export interface ForceSettings {
  // Basic parameters (work for both D3 and ForceAtlas2)
  gravity: number;              // Pull toward center (0.01 - 1.0)
  scaling: number;              // Node spacing / repulsion (0.1 - 10.0)
  edgeWeightInfluence: number;  // How much edge weight affects layout (0 - 5.0)
  
  // ForceAtlas2-specific (Gephi-like controls)
  linLogMode: boolean;          // Logarithmic attraction - makes clusters more distinct
  strongGravityMode: boolean;   // Stronger pull for isolated nodes
  outboundAttractionDistribution: boolean;  // Hubs attract less (degree-normalized)
}

export const DEFAULT_FORCE_SETTINGS: ForceSettings = {
  gravity: 0.5,                 // Moderate center pull
  scaling: 1.0,                 // Default spacing
  edgeWeightInfluence: 1.0,     // Normal weight influence
  linLogMode: false,            // Linear mode by default
  strongGravityMode: false,     // Normal gravity
  outboundAttractionDistribution: false,  // Normal attraction
};

// Node coloring modes for network graph
export type ColorMode = 'uniform' | 'cluster' | 'community' | 'mood' | 'color';

// Sort modes for gallery view
export type SortMode = 'rating' | 'date' | 'random';

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
  sortMode: SortMode;  // Current sort mode for gallery
  
  // Search
  searchQuery: string;
  searchFilters: SearchQuery['filters'];
  
  // UI State
  loading: boolean;
  loadProgress: LoadProgress | null;  // Progressive loading state
  ready: boolean;  // True when images loaded AND ratings sorted (production)
  sidebarOpen: boolean;
  modalOpen: boolean;
  
  // Actions
  initializeData: () => Promise<void>;  // Load data progressively
  setImages: (images: ImageMetadata[]) => void;
  addImages: (images: ImageMetadata[]) => void;  // Append more images
  removeImages: (imageIds: string[]) => void;  // Remove images by ID
  setSelectedImage: (image: ImageMetadata | null) => void;
  setHoveredImage: (image: ImageMetadata | null) => void;
  setLayout: (layout: LayoutConfig) => void;
  setSimilarity: (config: SimilarityConfig) => void;
  setForceSettings: (settings: ForceSettings) => void;
  setColorMode: (mode: ColorMode) => void;
  setSortMode: (mode: SortMode) => void;
  setSearchQuery: (query: string) => void;
  setSearchFilters: (filters: SearchQuery['filters']) => void;
  performSearch: () => void;
  recomputeEdges: () => void;  // Explicit edge recomputation
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openModal: (image: ImageMetadata) => void;
  closeModal: () => void;
  applyDefaultSort: () => void;  // Apply rating sort and mark ready - call after ratings loaded
}

// =============================================================================
// RATING SORT - Single source of truth for default sort order
// =============================================================================

/**
 * Sort images by rating (highest first), with unrated images at the end.
 * This is THE canonical way to get the default display order.
 */
function applyRatingSort(images: ImageMetadata[]): ImageMetadata[] {
  const ratingStore = useRatingStore.getState();

  return [...images].sort((a, b) => {
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

    // Neither has rating: maintain original order
    return 0;
  });
}

/**
 * Extract a sortable date from image EXIF data.
 * Returns epoch timestamp or 0 if no date found.
 */
function getImageDate(image: ImageMetadata): number {
  const exif = image.exif;
  if (!exif) return 0;

  // Try EXIF date fields in order of preference
  const dateStr = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate || exif.FileModifyDate;
  if (!dateStr) return 0;

  // Parse EXIF date format: "YYYY:MM:DD HH:MM:SS" or ISO format
  const parsed = Date.parse(String(dateStr).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Sort images by date (newest first).
 * Images without date info are placed at the end.
 */
function applyDateSort(images: ImageMetadata[]): ImageMetadata[] {
  return [...images].sort((a, b) => {
    const dateA = getImageDate(a);
    const dateB = getImageDate(b);

    // Both have dates: sort newest first
    if (dateA > 0 && dateB > 0) {
      return dateB - dateA;
    }

    // Only one has date: dated images come first
    if (dateA > 0 && dateB === 0) return -1;
    if (dateB > 0 && dateA === 0) return 1;

    // Neither has date: maintain original order
    return 0;
  });
}

/**
 * Shuffle images randomly using Fisher-Yates algorithm.
 */
function applyRandomSort(images: ImageMetadata[]): ImageMetadata[] {
  const shuffled = [...images];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Apply the specified sort mode to images.
 */
function applySortMode(images: ImageMetadata[], mode: SortMode): ImageMetadata[] {
  switch (mode) {
    case 'rating':
      return applyRatingSort(images);
    case 'date':
      return applyDateSort(images);
    case 'random':
      return applyRandomSort(images);
    default:
      return images;
  }
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

  // EXIF camera info
  const cameraMake = (image.exif?.Make || '').toLowerCase();
  const cameraModel = (image.exif?.Model || '').toLowerCase();
  const lensModel = (image.exif?.LensModel || '').toLowerCase();

  // Check each field for a match - return score for best match found
  if (filenameLower.includes(word)) return 4;
  if (allTags.includes(word)) return 3;
  if (tagCategories.includes(word)) return 2.5;
  if (allTags.some((t) => t.includes(word))) return 2;
  if (subjectLower.includes(word)) return 2;
  if (moodLower.includes(word)) return 2;
  if (colorNames.some(name => name.includes(word))) return 2;
  if (cameraModel.includes(word)) return 2;
  if (cameraMake.includes(word)) return 2;
  if (lensModel.includes(word)) return 2;
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
  sortMode: 'rating' as SortMode,  // Default to rating sort

  searchQuery: '',
  searchFilters: undefined,
  loading: true,  // Start in loading state
  loadProgress: null,
  ready: false,  // Becomes true when images loaded AND ratings sorted
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
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

      // Subscribe to manifest updates (new images processed by GPU)
      subscribeToManifestUpdates(() => {
        console.log('[GalleryStore] Manifest updated, reloading images...');
        // Refetch with cache-busting to bypass CloudFront cache
        refetchManifestFresh().then(newImages => {
          const existingIds = new Set(get().images.map(img => img.id));
          const brandNew = newImages.filter(img => !existingIds.has(img.id));
          if (brandNew.length > 0) {
            console.log(`[GalleryStore] Adding ${brandNew.length} new images from manifest update`);
            get().addImages(brandNew);
          }
        });
      });
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

  removeImages: (imageIds) => {
    const { images, filteredImages, selectedImage } = get();
    const idsToRemove = new Set(imageIds);
    const newImages = images.filter(img => !idsToRemove.has(img.id));
    const newFiltered = filteredImages.filter(img => !idsToRemove.has(img.id));
    // Clear selection if the selected image was removed
    const newSelected = selectedImage && idsToRemove.has(selectedImage.id) ? null : selectedImage;
    set({ images: newImages, filteredImages: newFiltered, selectedImage: newSelected });
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

  setSortMode: (mode) => {
    set({ sortMode: mode });
    // Re-apply sort to current filtered images
    const { filteredImages, searchQuery } = get();
    // Only apply sort if no search query (search results maintain relevance order)
    if (!searchQuery.trim()) {
      const sorted = applySortMode(filteredImages, mode);
      set({ filteredImages: sorted });
    }
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
    const { images, searchQuery, searchFilters, ready } = get();
    
    let filtered = [...images];
    
    // Special case: Top Rated - only show rated images, sorted by rating
    if (searchQuery === '__top_rated__') {
      const ratingStore = useRatingStore.getState();
      
      // Filter to only rated images, then sort by rating
      filtered = filtered.filter(img => {
        const rating = ratingStore.getRating(img.id);
        return rating.count > 0;
      });
      filtered = applyRatingSort(filtered);
      
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
    
    // NO SEARCH QUERY: Apply current sort mode if gallery is ready
    // This ensures clearing search returns to the user's selected sort
    if (!searchQuery.trim() && !searchFilters && ready) {
      filtered = applySortMode(filtered, get().sortMode);
    }
    
    set({ filteredImages: filtered, edges: [] });
    
    // If in network mode, recompute edges for the new filtered set
    // This prevents "no edges found" when changing search while viewing graph
    if (get().layout.type === 'network') {
      get().recomputeEdges();
    }
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
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  
  openModal: (image) => set({ modalOpen: true, selectedImage: image }),
  
  closeModal: () => set({ modalOpen: false }),
  
  /**
   * Apply current sort mode and mark gallery as ready.
   * Call this ONCE after ratings are loaded.
   * After this, performSearch() will maintain the user's selected sort.
   */
  applyDefaultSort: () => {
    const { images, searchQuery, sortMode } = get();

    // If there's an active search, just mark ready (search handles its own sort)
    if (searchQuery.trim()) {
      set({ ready: true });
      return;
    }

    // Apply current sort mode to all images
    const sorted = applySortMode(images, sortMode);
    set({ filteredImages: sorted, ready: true });
    console.log(`[GalleryStore] Applied ${sortMode} sort - gallery ready`);
  },
}));
