/**
 * Edge Computation - Filter Precomputed Neighbors
 * 
 * All similarity computation is done in Python preprocessing.
 * This module just filters the precomputed neighbors based on user settings.
 * 
 * Super fast - just array filtering, no math.
 */

import type { ImageMetadata, SimilarityEdge, SimilarityMode } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

export interface EdgeComputationParams {
  mode: SimilarityMode;       // 'clip' or 'composite'
  thresholdMin: number;       // 0-1, minimum weight to include
  thresholdMax: number;       // 0-1, maximum weight to include
  maxEdgesPerNode: number;    // Cap edges per node
}

export interface EdgeStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  totalPotential: number;  // Total edges before filtering
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Compute statistics for all edge weights in the current image set.
 * This helps users understand the weight distribution before filtering.
 */
export function computeEdgeStats(
  images: ImageMetadata[],
  mode: SimilarityMode
): EdgeStats | null {
  try {
    if (!images || images.length === 0) return null;
    
    const validIds = new Set(images.map(img => img.id));
    const weights: number[] = [];
    const seen = new Set<string>();
    
    for (const image of images) {
      if (!image.clipNeighbors) continue;
      
      for (const neighbor of image.clipNeighbors) {
        if (!neighbor?.id || !validIds.has(neighbor.id)) continue;
        
        // Deduplicate
        const key = [image.id, neighbor.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        
        const weight = mode === 'clip' ? neighbor.clipWeight : neighbor.compositeWeight;
        const actualWeight = weight ?? (neighbor as any).weight ?? 0;
        if (actualWeight > 0) {
          weights.push(actualWeight);
        }
      }
    }
    
    if (weights.length === 0) return null;
    
    weights.sort((a, b) => a - b);
    
    const min = weights[0];
    const max = weights[weights.length - 1];
    const sum = weights.reduce((a, b) => a + b, 0);
    const mean = sum / weights.length;
    const median = weights.length % 2 === 0
      ? (weights[weights.length / 2 - 1] + weights[weights.length / 2]) / 2
      : weights[Math.floor(weights.length / 2)];
    
    const squaredDiffs = weights.map(w => Math.pow(w - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / weights.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      min,
      max,
      mean,
      median,
      stdDev,
      totalPotential: weights.length,
    };
  } catch (e) {
    console.error('Error computing edge stats:', e);
    return null;
  }
}

// =============================================================================
// MAIN COMPUTATION - Just filtering!
// =============================================================================

/**
 * Filter precomputed edges based on mode, threshold range, and limits.
 * All heavy lifting was done in Python - this is O(n*k) where k is neighbors per image.
 */
export function computeEdges(
  images: ImageMetadata[],
  params: EdgeComputationParams
): SimilarityEdge[] {
  try {
    if (!images || images.length === 0) return [];
    
    const { mode, thresholdMin, thresholdMax, maxEdgesPerNode } = params;
    
    console.time('computeEdges');
    
    // Build set of valid IDs (for filtered image sets)
    const validIds = new Set(images.map(img => img.id));
  
  // Debug: check how many images have neighbors
  const withNeighbors = images.filter(img => img.clipNeighbors && img.clipNeighbors.length > 0);
  console.log(`[computeEdges] ${images.length} images, ${withNeighbors.length} with neighbors`);
  console.log(`[computeEdges] Range: ${thresholdMin.toFixed(2)} - ${thresholdMax.toFixed(2)}, max/node: ${maxEdgesPerNode}`);
  
  // Collect all valid edges first, sorted by weight descending
  const candidateEdges: { source: string; target: string; weight: number }[] = [];
  const seen = new Set<string>();
  
  for (const image of images) {
    if (!image.clipNeighbors || image.clipNeighbors.length === 0) continue;
    
    for (const neighbor of image.clipNeighbors) {
      // Skip if target not in current filtered set
      if (!validIds.has(neighbor.id)) continue;
      
      // Pick the weight based on mode (handle NaN and undefined)
      const weight = mode === 'clip' ? neighbor.clipWeight : neighbor.compositeWeight;
      const rawWeight = weight ?? (neighbor as any).weight ?? 0;
      const actualWeight = Number.isFinite(rawWeight) ? rawWeight : 0;

      // Skip if outside threshold range or invalid
      if (actualWeight <= 0 || actualWeight < thresholdMin || actualWeight > thresholdMax) continue;
      
      // Deduplicate edges (A->B same as B->A)
      const key = [image.id, neighbor.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      candidateEdges.push({
        source: image.id,
        target: neighbor.id,
        weight: actualWeight,
      });
    }
  }
  
  // Sort by weight descending - prioritize strongest connections
  candidateEdges.sort((a, b) => b.weight - a.weight);
  
  // Apply maxEdgesPerNode limit - greedily select best edges
  const edges: SimilarityEdge[] = [];
  const edgeCounts = new Map<string, number>();
  
  for (const edge of candidateEdges) {
    const srcCount = edgeCounts.get(edge.source) ?? 0;
    const tgtCount = edgeCounts.get(edge.target) ?? 0;
    
    // Skip if EITHER node has reached the limit
    if (srcCount >= maxEdgesPerNode || tgtCount >= maxEdgesPerNode) continue;
    
    edges.push({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      mode,
    });
    
    edgeCounts.set(edge.source, srcCount + 1);
    edgeCounts.set(edge.target, tgtCount + 1);
  }
  
  console.timeEnd('computeEdges');
  console.log(`Filtered ${edges.length} edges from ${candidateEdges.length} candidates`);
  
  return edges;
  } catch (e) {
    console.error('Error computing edges:', e);
    return [];
  }
}
