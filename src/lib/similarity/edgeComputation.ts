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
  threshold: number;          // 0-1, minimum weight to include
  maxEdgesPerNode: number;    // Cap edges per node
}

// =============================================================================
// MAIN COMPUTATION - Just filtering!
// =============================================================================

/**
 * Filter precomputed edges based on mode, threshold, and limits.
 * All heavy lifting was done in Python - this is O(n*k) where k is neighbors per image.
 */
export function computeEdges(
  images: ImageMetadata[],
  params: EdgeComputationParams
): SimilarityEdge[] {
  const { mode, threshold, maxEdgesPerNode } = params;
  
  console.time('computeEdges');
  
  // Build set of valid IDs (for filtered image sets)
  const validIds = new Set(images.map(img => img.id));
  
  const edges: SimilarityEdge[] = [];
  const edgeCounts = new Map<string, number>();
  const seen = new Set<string>();
  
  for (const image of images) {
    if (!image.clipNeighbors || image.clipNeighbors.length === 0) continue;
    
    const srcCount = edgeCounts.get(image.id) ?? 0;
    if (srcCount >= maxEdgesPerNode) continue;
    
    for (const neighbor of image.clipNeighbors) {
      // Skip if target not in current filtered set
      if (!validIds.has(neighbor.id)) continue;
      
      // Pick the weight based on mode
      const weight = mode === 'clip' ? neighbor.clipWeight : neighbor.compositeWeight;
      
      // Handle legacy format (single 'weight' field)
      const actualWeight = weight ?? (neighbor as any).weight ?? 0;
      
      // Skip if below threshold
      if (actualWeight < threshold) continue;
      
      // Deduplicate edges (A->B same as B->A)
      const key = [image.id, neighbor.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      // Check edge limits
      const tgtCount = edgeCounts.get(neighbor.id) ?? 0;
      if (srcCount >= maxEdgesPerNode && tgtCount >= maxEdgesPerNode) continue;
      
      edges.push({
        source: image.id,
        target: neighbor.id,
        weight: actualWeight,
        mode,
      });
      
      edgeCounts.set(image.id, (edgeCounts.get(image.id) ?? 0) + 1);
      edgeCounts.set(neighbor.id, tgtCount + 1);
    }
  }
  
  // Sort by weight descending
  edges.sort((a, b) => b.weight - a.weight);
  
  console.timeEnd('computeEdges');
  console.log(`Filtered ${edges.length} edges (mode: ${mode}, threshold: ${threshold}, max: ${maxEdgesPerNode})`);
  
  return edges;
}
