/**
 * Progressive Data Loader
 * 
 * In local dev: Fetches from JSON or localImages.ts
 * In production: Data comes from Amplify Data API (DynamoDB)
 */

import type { ImageMetadata } from '@/types/gallery';

export interface LoadProgress {
  loaded: number;
  total: number;
  complete: boolean;
}

// Detect if we're in production (Amplify) or local dev
const isProduction = typeof window !== 'undefined' && 
  !window.location.hostname.includes('localhost') &&
  !window.location.hostname.includes('127.0.0.1');

// Cache the loaded data
let cachedImages: ImageMetadata[] | null = null;
let loadPromise: Promise<ImageMetadata[]> | null = null;

/**
 * Load all images - tries JSON first (fast), falls back to module import.
 * In production, returns empty array (data should come from API).
 */
async function loadAllImages(): Promise<ImageMetadata[]> {
  if (cachedImages) return cachedImages;
  
  if (!loadPromise) {
    loadPromise = (async () => {
      // In production, data comes from Amplify Data API
      // Return empty for now - the app will fetch from API
      if (isProduction) {
        console.log('[dataLoader] Production mode - data from Amplify API');
        cachedImages = [];
        return cachedImages;
      }
      
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
      
      // Fallback to stub (empty array) - avoids bundling huge localImages.ts
      try {
        const mod = await import('@/data/localImages.stub');
        cachedImages = mod.localImages;
        console.log(`✅ Loaded ${cachedImages!.length} images from stub`);
        return cachedImages!;
      } catch {
        console.warn('[dataLoader] Stub import failed, returning empty array');
        cachedImages = [];
        return cachedImages;
      }
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
