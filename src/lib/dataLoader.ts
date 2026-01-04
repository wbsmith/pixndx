/**
 * Progressive Data Loader
 * 
 * Fetches image data as JSON (much faster than importing JS module).
 * JSON parsing is ~10x faster than JavaScript evaluation.
 */

import type { ImageMetadata } from '@/types/gallery';

export interface LoadProgress {
  loaded: number;
  total: number;
  complete: boolean;
}

// Cache the loaded data
let cachedImages: ImageMetadata[] | null = null;
let loadPromise: Promise<ImageMetadata[]> | null = null;

/**
 * Load all images - tries JSON first (fast), falls back to module import.
 */
async function loadAllImages(): Promise<ImageMetadata[]> {
  if (cachedImages) return cachedImages;
  
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        // Try to fetch JSON first (much faster - ~10x faster parsing)
        const response = await fetch('/localImages.json');
        console.log(`[dataLoader] JSON fetch status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.images && Array.isArray(data.images)) {
            cachedImages = data.images;
            console.log(`✅ Loaded ${cachedImages!.length} images from JSON`);
            return cachedImages!;
          } else {
            console.warn('[dataLoader] JSON missing "images" array, falling back to module');
          }
        } else {
          console.warn(`[dataLoader] JSON fetch returned ${response.status}, falling back to module`);
        }
      } catch (e) {
        console.warn('[dataLoader] JSON fetch failed:', e);
      }
      
      // Fallback to module import (slower but always works)
      const mod = await import('@/data/localImages');
      cachedImages = mod.localImages;
      console.log(`✅ Loaded ${cachedImages!.length} images from module`);
      return cachedImages!;
    })();
  }
  
  return loadPromise;
}

/**
 * Load images progressively.
 * Returns initial batch quickly, rest comes via loadRemainingImages.
 */
export async function loadImagesProgressively(
  onProgress?: (progress: LoadProgress) => void
): Promise<ImageMetadata[]> {
  const INITIAL_BATCH = 100;
  
  const allImages = await loadAllImages();
  
  // For small datasets, just return everything
  if (allImages.length <= INITIAL_BATCH * 2) {
    onProgress?.({ loaded: allImages.length, total: allImages.length, complete: true });
    return allImages;
  }
  
  // Return initial batch
  onProgress?.({ 
    loaded: INITIAL_BATCH, 
    total: allImages.length, 
    complete: false 
  });
  
  return allImages.slice(0, INITIAL_BATCH);
}

/**
 * Load remaining images.
 */
export async function loadRemainingImages(
  onChunk: (images: ImageMetadata[], progress: LoadProgress) => void
): Promise<void> {
  const INITIAL_BATCH = 100;
  
  const allImages = await loadAllImages();
  
  if (allImages.length <= INITIAL_BATCH) {
    return;
  }
  
  const remaining = allImages.slice(INITIAL_BATCH);
  const total = allImages.length;
  
  // Add all remaining at once
  onChunk(remaining, {
    loaded: total,
    total,
    complete: true,
  });
}
