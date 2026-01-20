/**
 * Progressive Data Loader
 *
 * Loads image data from multiple sources:
 * 1. DynamoDB via AppSync (production, real-time)
 * 2. Local JSON file (dev mode or fallback)
 */

import type { ImageMetadata, ClipNeighbor } from '@/types/gallery';
import type { Schema } from '../../amplify/data/resource';
import { IS_LOCAL_DEV } from '@/config';

export interface LoadProgress {
  loaded: number;
  total: number;
  complete: boolean;
}

// Cache the loaded data
let cachedImages: ImageMetadata[] | null = null;
let loadPromise: Promise<ImageMetadata[]> | null = null;

/**
 * Transform DynamoDB/AppSync record to frontend ImageMetadata format.
 */
function transformDbRecord(record: Record<string, unknown>): ImageMetadata {
  return {
    id: record.id as string,
    filename: record.filename as string,
    urls: {
      small: record.urlSmall as string,
      medium: record.urlMedium as string,
      full: record.urlFull as string,
    },
    description: record.description as string,
    mood: record.mood as string,
    main_subject: record.mainSubject as string,
    tags: (record.tags as Record<string, string[]>) || {},
    main_colors: (record.mainColors as Record<string, string>) || {},
    exif: (record.exif as Record<string, unknown>) || {},
    clipNeighbors: (record.clipNeighbors as ClipNeighbor[]) || [],
    avgRating: (record.avgRating as number) || 0,
    ratingCount: (record.ratingCount as number) || 0,
  };
}

/**
 * Fetch images from DynamoDB via AppSync.
 */
async function fetchFromAppSync(): Promise<ImageMetadata[] | null> {
  try {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<Schema>();

    // Fetch all images (paginated)
    const images: ImageMetadata[] = [];
    let nextToken: string | null | undefined = undefined;

    while (true) {
      const response = await client.models.Image.list({
        limit: 1000,
        ...(nextToken ? { nextToken } : {}),
      });

      if (response.data) {
        for (const record of response.data) {
          if (record) {
            images.push(transformDbRecord(record as unknown as Record<string, unknown>));
          }
        }
      }

      nextToken = response.nextToken;
      if (!nextToken) break;
    }

    console.log(`✅ Loaded ${images.length} images from DynamoDB`);
    return images;
  } catch (e) {
    console.warn('[dataLoader] AppSync fetch failed:', e);
    return null;
  }
}

/**
 * Fetch manifest from a URL (fallback for local dev or if AppSync fails).
 */
async function fetchManifest(url: string, source: string): Promise<ImageMetadata[] | null> {
  try {
    const response = await fetch(url, { credentials: 'include' });
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
      // In production, try DynamoDB first
      if (!IS_LOCAL_DEV) {
        const dbImages = await fetchFromAppSync();
        if (dbImages && dbImages.length > 0) {
          cachedImages = dbImages;
          return cachedImages;
        }
      }

      // Fall back to static local JSON (dev mode or if AppSync fails)
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

/**
 * Subscribe to new images (real-time updates).
 * Returns an unsubscribe function.
 */
export async function subscribeToNewImages(
  onNewImage: (image: ImageMetadata) => void
): Promise<() => void> {
  if (IS_LOCAL_DEV) {
    // No subscriptions in dev mode
    return () => {};
  }

  try {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<Schema>();

    const subscription = client.models.Image.onCreate().subscribe({
      next: (record) => {
        if (record) {
          const image = transformDbRecord(record as unknown as Record<string, unknown>);
          console.log('[dataLoader] New image received:', image.id);
          onNewImage(image);
        }
      },
      error: (err) => {
        console.error('[dataLoader] Subscription error:', err);
      },
    });

    return () => subscription.unsubscribe();
  } catch (e) {
    console.warn('[dataLoader] Failed to set up subscription:', e);
    return () => {};
  }
}
