import { useState, useCallback, useMemo, useEffect } from 'react';
import { useGalleryStore } from '@/stores/galleryStore';
import type {
  ImageMetadata,
  SimilarityMode,
  SimilarityConfig,
  SimilarityEdge,
} from '@/types/gallery';
import {
  computeSimilarity,
  getEdgesAboveThreshold,
} from '@/lib/similarity/vectors';

interface UseSimilarityOptions {
  autoCompute?: boolean;
  debounceMs?: number;
}

interface UseSimilarityReturn {
  // State
  mode: SimilarityMode;
  threshold: number;
  weights: SimilarityConfig['weights'];
  edges: SimilarityEdge[];
  isComputing: boolean;
  
  // Actions
  setMode: (mode: SimilarityMode) => void;
  setThreshold: (threshold: number) => void;
  setWeights: (weights: SimilarityConfig['weights']) => void;
  computeEdges: () => void;
  
  // Derived
  edgeCount: number;
  averageSimilarity: number;
  getSimilarImages: (imageId: string, limit?: number) => ImageMetadata[];
  getEdgesForImage: (imageId: string) => SimilarityEdge[];
}

/**
 * Hook for managing similarity computations
 */
export function useSimilarity(options: UseSimilarityOptions = {}): UseSimilarityReturn {
  const { autoCompute = true, debounceMs = 500 } = options;
  
  const {
    filteredImages,
    edges,
    similarity,
    setSimilarity,
    recomputeEdges,
  } = useGalleryStore();
  
  const [isComputing, setIsComputing] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  
  // Create image map for quick lookups
  const imageMap = useMemo(() => {
    const map = new Map<string, ImageMetadata>();
    filteredImages.forEach((img) => map.set(img.id, img));
    return map;
  }, [filteredImages]);
  
  // Set mode
  const setMode = useCallback((mode: SimilarityMode) => {
    setSimilarity({ ...similarity, mode });
    if (autoCompute) {
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        setIsComputing(true);
        recomputeEdges();
        setIsComputing(false);
      }, debounceMs);
      setDebounceTimer(timer);
    }
  }, [similarity, setSimilarity, autoCompute, debounceMs, debounceTimer, recomputeEdges]);
  
  // Set threshold
  const setThreshold = useCallback((threshold: number) => {
    setSimilarity({ ...similarity, threshold });
    if (autoCompute) {
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        setIsComputing(true);
        recomputeEdges();
        setIsComputing(false);
      }, debounceMs);
      setDebounceTimer(timer);
    }
  }, [similarity, setSimilarity, autoCompute, debounceMs, debounceTimer, recomputeEdges]);
  
  // Set weights
  const setWeights = useCallback((weights: SimilarityConfig['weights']) => {
    setSimilarity({ ...similarity, weights });
    if (autoCompute) {
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => {
        setIsComputing(true);
        recomputeEdges();
        setIsComputing(false);
      }, debounceMs);
      setDebounceTimer(timer);
    }
  }, [similarity, setSimilarity, autoCompute, debounceMs, debounceTimer, recomputeEdges]);
  
  // Manual compute
  const computeEdges = useCallback(() => {
    setIsComputing(true);
    recomputeEdges();
    setIsComputing(false);
  }, [recomputeEdges]);
  
  // Get similar images for a specific image
  const getSimilarImages = useCallback((imageId: string, limit = 5): ImageMetadata[] => {
    const relevantEdges = edges
      .filter((e) => e.source === imageId || e.target === imageId)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);
    
    const similarIds = relevantEdges.map((e) =>
      e.source === imageId ? e.target : e.source
    );
    
    return similarIds.map((id) => imageMap.get(id)).filter(Boolean) as ImageMetadata[];
  }, [edges, imageMap]);
  
  // Get edges for a specific image
  const getEdgesForImage = useCallback((imageId: string): SimilarityEdge[] => {
    return edges.filter((e) => e.source === imageId || e.target === imageId);
  }, [edges]);
  
  // Compute average similarity
  const averageSimilarity = useMemo(() => {
    if (edges.length === 0) return 0;
    return edges.reduce((sum, e) => sum + e.weight, 0) / edges.length;
  }, [edges]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [debounceTimer]);
  
  return {
    mode: similarity.mode,
    threshold: similarity.threshold,
    weights: similarity.weights,
    edges,
    isComputing,
    setMode,
    setThreshold,
    setWeights,
    computeEdges,
    edgeCount: edges.length,
    averageSimilarity,
    getSimilarImages,
    getEdgesForImage,
  };
}

/**
 * Hook for finding similar images to a specific image
 */
export function useSimilarImages(image: ImageMetadata | null, limit = 5) {
  const { filteredImages, similarity } = useGalleryStore();
  
  const similarImages = useMemo(() => {
    if (!image) return [];
    
    const scores: Array<{ image: ImageMetadata; score: number }> = [];
    
    filteredImages.forEach((other) => {
      if (other.id === image.id) return;
      
      const score = computeSimilarity(image, other, similarity.mode, similarity.weights);
      if (score > similarity.threshold) {
        scores.push({ image: other, score });
      }
    });
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.image);
  }, [image, filteredImages, similarity, limit]);
  
  return similarImages;
}

/**
 * Hook for similarity statistics
 */
export function useSimilarityStats() {
  const { edges, filteredImages } = useGalleryStore();
  
  const stats = useMemo(() => {
    if (edges.length === 0) {
      return {
        edgeCount: 0,
        maxPossibleEdges: 0,
        density: 0,
        avgWeight: 0,
        minWeight: 0,
        maxWeight: 0,
        weightDistribution: [] as Array<{ range: string; count: number }>,
        mostConnected: [] as Array<{ id: string; connections: number }>,
        leastConnected: [] as Array<{ id: string; connections: number }>,
      };
    }
    
    const n = filteredImages.length;
    const maxPossible = (n * (n - 1)) / 2;
    
    const weights = edges.map((e) => e.weight);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    
    // Weight distribution
    const ranges = [
      { range: '0-20%', min: 0, max: 0.2, count: 0 },
      { range: '20-40%', min: 0.2, max: 0.4, count: 0 },
      { range: '40-60%', min: 0.4, max: 0.6, count: 0 },
      { range: '60-80%', min: 0.6, max: 0.8, count: 0 },
      { range: '80-100%', min: 0.8, max: 1.0, count: 0 },
    ];
    
    weights.forEach((w) => {
      const range = ranges.find((r) => w >= r.min && w < r.max);
      if (range) range.count++;
    });
    
    // Connection counts per node
    const connectionCounts = new Map<string, number>();
    filteredImages.forEach((img) => connectionCounts.set(img.id, 0));
    
    edges.forEach((e) => {
      connectionCounts.set(e.source, (connectionCounts.get(e.source) || 0) + 1);
      connectionCounts.set(e.target, (connectionCounts.get(e.target) || 0) + 1);
    });
    
    const sorted = Array.from(connectionCounts.entries())
      .map(([id, connections]) => ({ id, connections }))
      .sort((a, b) => b.connections - a.connections);
    
    return {
      edgeCount: edges.length,
      maxPossibleEdges: maxPossible,
      density: maxPossible > 0 ? edges.length / maxPossible : 0,
      avgWeight,
      minWeight,
      maxWeight,
      weightDistribution: ranges.map((r) => ({ range: r.range, count: r.count })),
      mostConnected: sorted.slice(0, 5),
      leastConnected: sorted.slice(-5).reverse(),
    };
  }, [edges, filteredImages]);
  
  return stats;
}

/**
 * Hook for similarity presets
 */
export function useSimilarityPresets() {
  const { setSimilarity } = useGalleryStore();
  
  const presets: Record<string, SimilarityConfig> = {
    visual: {
      mode: 'full',
      threshold: 0.5,
      weights: { visual: 1, semantic: 0, color: 0, mood: 0 },
    },
    semantic: {
      mode: 'tags',
      threshold: 0.3,
      weights: { visual: 0, semantic: 1, color: 0, mood: 0 },
    },
    colorBased: {
      mode: 'colors',
      threshold: 0.4,
      weights: { visual: 0, semantic: 0, color: 1, mood: 0 },
    },
    moodBased: {
      mode: 'mood',
      threshold: 0.3,
      weights: { visual: 0, semantic: 0, color: 0, mood: 1 },
    },
    balanced: {
      mode: 'composite',
      threshold: 0.35,
      weights: { visual: 0.3, semantic: 0.3, color: 0.2, mood: 0.2 },
    },
  };
  
  const applyPreset = useCallback((presetName: string) => {
    const preset = presets[presetName];
    if (preset) {
      setSimilarity(preset);
    }
  }, [setSimilarity]);
  
  return { presets, applyPreset };
}
