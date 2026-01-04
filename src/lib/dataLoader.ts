/**
 * Progressive Data Loader
 * 
 * Instead of loading all 33MB of image data at once,
 * this loads a small initial batch for instant UI,
 * then streams the rest in the background.
 */

import type { ImageMetadata } from '@/types/gallery';

const INITIAL_BATCH_SIZE = 50;  // Show this many immediately
const CHUNK_SIZE = 200;         // Load this many at a time in background

export interface LoadProgress {
  loaded: number;
  total: number;
  complete: boolean;
}

type ProgressCallback = (progress: LoadProgress) => void;

/**
 * Load images progressively.
 * Returns initial batch immediately, then calls onProgress as more load.
 */
export async function loadImagesProgressively(
  onProgress?: ProgressCallback
): Promise<ImageMetadata[]> {
  // Dynamic import - this is code-split by Vite
  const { localImages } = await import('@/data/localImages');
  
  // If small dataset, just return everything
  if (localImages.length <= INITIAL_BATCH_SIZE * 2) {
    onProgress?.({ loaded: localImages.length, total: localImages.length, complete: true });
    return localImages;
  }
  
  // Return initial batch immediately
  const initialBatch = localImages.slice(0, INITIAL_BATCH_SIZE);
  
  // Report initial progress
  onProgress?.({ 
    loaded: INITIAL_BATCH_SIZE, 
    total: localImages.length, 
    complete: false 
  });
  
  // Return initial batch - caller can start rendering
  // The rest will be added via the store
  return initialBatch;
}

/**
 * Load remaining images in chunks.
 * Call this after initial render to populate the rest.
 */
export async function loadRemainingImages(
  onChunk: (images: ImageMetadata[], progress: LoadProgress) => void
): Promise<void> {
  const { localImages } = await import('@/data/localImages');
  
  if (localImages.length <= INITIAL_BATCH_SIZE) {
    return; // Nothing more to load
  }
  
  const remaining = localImages.slice(INITIAL_BATCH_SIZE);
  const total = localImages.length;
  let loaded = INITIAL_BATCH_SIZE;
  
  // Load in chunks with small delays to keep UI responsive
  for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
    const chunk = remaining.slice(i, i + CHUNK_SIZE);
    loaded += chunk.length;
    
    onChunk(chunk, {
      loaded,
      total,
      complete: loaded >= total,
    });
    
    // Small delay to let React render
    if (loaded < total) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

/**
 * Get just the image count without loading all data.
 * Useful for showing "Loading X of Y" before data is ready.
 */
export async function getImageCount(): Promise<number> {
  const { localImages } = await import('@/data/localImages');
  return localImages.length;
}

