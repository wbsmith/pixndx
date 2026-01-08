/**
 * Progressive Data Loader
 * 
 * Loads image data from JSON file (works in both dev and production).
 * The JSON file contains S3 URLs for production.
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
 * Load all images from JSON file.
 */
async function loadAllImages(): Promise<ImageMetadata[]> {
  if (cachedImages) return cachedImages;
  
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        // Fetch JSON (works in both dev and production)
        const response = await fetch('/localImages.json');
        console.log(`[dataLoader] JSON fetch status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.images && Array.isArray(data.images)) {
            cachedImages = data.images;
            console.log(`✅ Loaded ${cachedImages!.length} images from JSON`);
            return cachedImages!;
          } else {
            console.warn('[dataLoader] JSON missing "images" array');
          }
        } else {
          console.warn(`[dataLoader] JSON fetch returned ${response.status}`);
        }
      } catch (e) {
        console.warn('[dataLoader] JSON fetch failed:', e);
      }
      
      // Fallback to empty
      console.warn('[dataLoader] No data loaded, returning empty array');
      cachedImages = [];
      return cachedImages;
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
