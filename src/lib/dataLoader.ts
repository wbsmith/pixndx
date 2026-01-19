/**
 * Progressive Data Loader
 *
 * Loads image data from multiple sources:
 * 1. Local JSON file (dev mode or static build)
 * 2. S3/CDN manifest (production, updated by GPU processor)
 */

import type { ImageMetadata } from '@/types/gallery';
import { config, IS_LOCAL_DEV } from '@/config';

export interface LoadProgress {
  loaded: number;
  total: number;
  complete: boolean;
}

// Cache the loaded data
let cachedImages: ImageMetadata[] | null = null;
let loadPromise: Promise<ImageMetadata[]> | null = null;

/**
 * Fetch manifest from a URL with error handling.
 */
async function fetchManifest(url: string, source: string): Promise<ImageMetadata[] | null> {
  try {
    const response = await fetch(url, { credentials: 'include' }); // include cookies for CDN auth
    console.log(`[dataLoader] ${source} fetch: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      if (data.images && Array.isArray(data.images)) {
        return data.images;
      }
    }
  } catch (e) {
    console.warn(`[dataLoader] ${source} fetch failed:`, e);
  }
  return null;
}

/**
 * Load all images from available sources.
 */
async function loadAllImages(): Promise<ImageMetadata[]> {
  if (cachedImages) return cachedImages;

  if (!loadPromise) {
    loadPromise = (async () => {
      // Try CDN manifest first in production (most up-to-date)
      if (!IS_LOCAL_DEV && config.cdn.enabled && config.cdn.imageUrl) {
        const cdnManifestUrl = `${config.cdn.imageUrl}/manifest/localImages.json`;
        const cdnImages = await fetchManifest(cdnManifestUrl, 'CDN manifest');
        if (cdnImages && cdnImages.length > 0) {
          cachedImages = cdnImages;
          console.log(`✅ Loaded ${cachedImages.length} images from CDN manifest`);
          return cachedImages;
        }
      }

      // Fall back to static local JSON
      const localImages = await fetchManifest('/localImages.json', 'local JSON');
      if (localImages && localImages.length > 0) {
        cachedImages = localImages;
        console.log(`✅ Loaded ${cachedImages.length} images from local JSON`);
        return cachedImages;
      }

      // No data found
      console.warn('[dataLoader] No data loaded from any source');
      cachedImages = [];
      return cachedImages;
    })();
  }

  return loadPromise;
}

/**
 * Force reload images from source (bypass cache).
 */
export function invalidateCache(): void {
  cachedImages = null;
  loadPromise = null;
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
