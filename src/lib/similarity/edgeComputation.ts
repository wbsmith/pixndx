/**
 * Runtime Edge Computation
 * 
 * Computes similarity edges at runtime based on user-selected mode and parameters.
 * 
 * Modes:
 * - clip: Uses precomputed CLIP neighbors (fast, just filter)
 * - metadata: Computes similarity from tags, mood, colors (computed on-demand)
 * - composite: Blends both modes with configurable weights
 */

import type { ImageMetadata, SimilarityEdge, SimilarityMode } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

export interface EdgeComputationParams {
  mode: SimilarityMode;
  threshold: number;      // 0-1, minimum similarity to include
  maxEdgesPerNode: number;
  weights?: {
    clip: number;         // Weight for CLIP similarity (default: 0.6)
    metadata: number;     // Weight for metadata similarity (default: 0.4)
  };
}

// =============================================================================
// MAIN COMPUTATION
// =============================================================================

/**
 * Compute edges for a set of images based on mode and parameters.
 * This is called at runtime when the user changes settings.
 */
export function computeEdges(
  images: ImageMetadata[],
  params: EdgeComputationParams
): SimilarityEdge[] {
  const { mode, threshold, maxEdgesPerNode } = params;
  
  // Build lookup map for quick access
  const imageMap = new Map(images.map(img => [img.id, img]));
  const imageIds = new Set(images.map(img => img.id));
  
  let edges: SimilarityEdge[];
  
  switch (mode) {
    case 'full':
    case 'composite':
      edges = computeCompositeEdges(images, imageMap, imageIds, threshold, maxEdgesPerNode, params.weights);
      break;
      
    case 'colors':
      edges = computeMetadataEdges(images, imageIds, threshold, maxEdgesPerNode, 'colors');
      break;
      
    case 'mood':
      edges = computeMetadataEdges(images, imageIds, threshold, maxEdgesPerNode, 'mood');
      break;
      
    case 'tags':
      edges = computeMetadataEdges(images, imageIds, threshold, maxEdgesPerNode, 'tags');
      break;
      
    case 'description':
      edges = computeMetadataEdges(images, imageIds, threshold, maxEdgesPerNode, 'description');
      break;
      
    default:
      // Default to CLIP-only
      edges = computeClipEdges(images, imageIds, threshold, maxEdgesPerNode);
  }
  
  // Deduplicate (since edges are undirected, A->B and B->A should be one edge)
  const seen = new Set<string>();
  const dedupedEdges: SimilarityEdge[] = [];
  
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      dedupedEdges.push(edge);
    }
  }
  
  // Sort by weight descending
  dedupedEdges.sort((a, b) => b.weight - a.weight);
  
  return dedupedEdges;
}

// =============================================================================
// CLIP EDGES (from precomputed neighbors)
// =============================================================================

function computeClipEdges(
  images: ImageMetadata[],
  validIds: Set<string>,
  threshold: number,
  maxEdgesPerNode: number
): SimilarityEdge[] {
  const edges: SimilarityEdge[] = [];
  const edgeCounts = new Map<string, number>();
  
  for (const image of images) {
    if (!image.clipNeighbors) continue;
    
    const srcCount = edgeCounts.get(image.id) ?? 0;
    if (srcCount >= maxEdgesPerNode) continue;
    
    for (const neighbor of image.clipNeighbors) {
      // Skip if target not in current filtered set
      if (!validIds.has(neighbor.id)) continue;
      
      // Skip if below threshold
      if (neighbor.weight < threshold) continue;
      
      // Check edge limits
      const tgtCount = edgeCounts.get(neighbor.id) ?? 0;
      if (srcCount >= maxEdgesPerNode && tgtCount >= maxEdgesPerNode) continue;
      
      edges.push({
        source: image.id,
        target: neighbor.id,
        weight: neighbor.weight,
        mode: 'full' as SimilarityMode,
      });
      
      edgeCounts.set(image.id, (edgeCounts.get(image.id) ?? 0) + 1);
      edgeCounts.set(neighbor.id, (edgeCounts.get(neighbor.id) ?? 0) + 1);
    }
  }
  
  return edges;
}

// =============================================================================
// METADATA EDGES (computed on-demand)
// =============================================================================

function computeMetadataEdges(
  images: ImageMetadata[],
  validIds: Set<string>,
  threshold: number,
  maxEdgesPerNode: number,
  attribute: 'tags' | 'mood' | 'colors' | 'description'
): SimilarityEdge[] {
  const edges: SimilarityEdge[] = [];
  const edgeCounts = new Map<string, number>();
  
  // For small datasets, compute all pairs
  // For larger datasets, this could be optimized with LSH or other ANN
  for (let i = 0; i < images.length; i++) {
    const srcCount = edgeCounts.get(images[i].id) ?? 0;
    if (srcCount >= maxEdgesPerNode) continue;
    
    for (let j = i + 1; j < images.length; j++) {
      const tgtCount = edgeCounts.get(images[j].id) ?? 0;
      if (srcCount >= maxEdgesPerNode && tgtCount >= maxEdgesPerNode) continue;
      
      const sim = computeAttributeSimilarity(images[i], images[j], attribute);
      
      if (sim >= threshold) {
        edges.push({
          source: images[i].id,
          target: images[j].id,
          weight: sim,
          mode: attribute as SimilarityMode,
        });
        
        edgeCounts.set(images[i].id, (edgeCounts.get(images[i].id) ?? 0) + 1);
        edgeCounts.set(images[j].id, (edgeCounts.get(images[j].id) ?? 0) + 1);
      }
    }
  }
  
  return edges;
}

function computeAttributeSimilarity(
  a: ImageMetadata,
  b: ImageMetadata,
  attribute: 'tags' | 'mood' | 'colors' | 'description'
): number {
  switch (attribute) {
    case 'tags':
      return jaccardSimilarity(
        Object.values(a.tags).flat(),
        Object.values(b.tags).flat()
      );
      
    case 'mood':
      return jaccardSimilarity(
        a.mood.toLowerCase().split(/[,\s]+/),
        b.mood.toLowerCase().split(/[,\s]+/)
      );
      
    case 'colors':
      return colorPaletteSimilarity(
        Object.values(a.main_colors),
        Object.values(b.main_colors)
      );
      
    case 'description':
      return jaccardSimilarity(
        a.description.toLowerCase().split(/\W+/).filter(w => w.length > 3),
        b.description.toLowerCase().split(/\W+/).filter(w => w.length > 3)
      );
      
    default:
      return 0;
  }
}

// =============================================================================
// COMPOSITE EDGES (blend CLIP + metadata)
// =============================================================================

function computeCompositeEdges(
  images: ImageMetadata[],
  imageMap: Map<string, ImageMetadata>,
  validIds: Set<string>,
  threshold: number,
  maxEdgesPerNode: number,
  weights?: { clip: number; metadata: number }
): SimilarityEdge[] {
  const clipWeight = weights?.clip ?? 0.6;
  const metaWeight = weights?.metadata ?? 0.4;
  
  const edges: SimilarityEdge[] = [];
  const edgeCounts = new Map<string, number>();
  const seen = new Set<string>();
  
  // Start with CLIP neighbors as candidates
  for (const image of images) {
    if (!image.clipNeighbors) continue;
    
    for (const neighbor of image.clipNeighbors) {
      if (!validIds.has(neighbor.id)) continue;
      
      const key = [image.id, neighbor.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      const targetImage = imageMap.get(neighbor.id);
      if (!targetImage) continue;
      
      // Compute metadata similarity
      const tagSim = jaccardSimilarity(
        Object.values(image.tags).flat(),
        Object.values(targetImage.tags).flat()
      );
      const moodSim = jaccardSimilarity(
        image.mood.toLowerCase().split(/[,\s]+/),
        targetImage.mood.toLowerCase().split(/[,\s]+/)
      );
      const colorSim = colorPaletteSimilarity(
        Object.values(image.main_colors),
        Object.values(targetImage.main_colors)
      );
      
      // Weighted average for metadata
      const metaSim = (tagSim * 0.4 + moodSim * 0.3 + colorSim * 0.3);
      
      // Blend CLIP and metadata
      const compositeSim = neighbor.weight * clipWeight + metaSim * metaWeight;
      
      if (compositeSim >= threshold) {
        const srcCount = edgeCounts.get(image.id) ?? 0;
        const tgtCount = edgeCounts.get(neighbor.id) ?? 0;
        
        if (srcCount < maxEdgesPerNode || tgtCount < maxEdgesPerNode) {
          edges.push({
            source: image.id,
            target: neighbor.id,
            weight: compositeSim,
            mode: 'composite' as SimilarityMode,
          });
          
          edgeCounts.set(image.id, srcCount + 1);
          edgeCounts.set(neighbor.id, tgtCount + 1);
        }
      }
    }
  }
  
  return edges;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  
  if (setA.size === 0 && setB.size === 0) return 0;
  
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  
  return union === 0 ? 0 : intersection / union;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function colorPaletteSimilarity(colors1: string[], colors2: string[]): number {
  if (colors1.length === 0 || colors2.length === 0) return 0;
  
  let totalMinDist = 0;
  let count = 0;
  
  for (const hex1 of colors1) {
    const rgb1 = hexToRgb(hex1);
    if (!rgb1) continue;
    
    let minDist = 1;
    for (const hex2 of colors2) {
      const rgb2 = hexToRgb(hex2);
      if (!rgb2) continue;
      
      // Euclidean distance in RGB space, normalized
      const dist = Math.sqrt(
        Math.pow((rgb1.r - rgb2.r) / 255, 2) +
        Math.pow((rgb1.g - rgb2.g) / 255, 2) +
        Math.pow((rgb1.b - rgb2.b) / 255, 2)
      ) / Math.sqrt(3);
      
      minDist = Math.min(minDist, dist);
    }
    
    totalMinDist += minDist;
    count++;
  }
  
  return count > 0 ? 1 - (totalMinDist / count) : 0;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { jaccardSimilarity, colorPaletteSimilarity };

