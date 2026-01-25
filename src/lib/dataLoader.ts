/**
 * Progressive Data Loader
 *
 * Loads image data with fast initial load + real-time updates:
 * 1. CDN manifest (production) - fast, cached JSON from S3/CloudFront
 * 2. Local JSON file (dev mode) - static fixture
 * 3. DynamoDB subscriptions - real-time updates for new images
 *
 * DynamoDB is NOT used for initial load (too slow for 2000+ records).
 * It's the source of truth, and the manifest is regenerated from it.
 */

import type { ImageMetadata, ClipNeighbor } from '@/types/gallery';
import type { Schema } from '../../amplify/data/resource';
import { IS_LOCAL_DEV } from '@/config';
import { waitForAmplify, refreshImageCookies } from './amplify';

// CDN manifest URL (served via CloudFront, same domain as images)
const CDN_MANIFEST_URL = 'https://cdn.picgraf.com/manifest/images.json';

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
 * Fetch manifest from a URL.
 * @param bustCache - If true, append timestamp to bypass CDN cache
 */
async function fetchManifest(url: string, source: string, bustCache = false): Promise<ImageMetadata[] | null> {
  try {
    const fetchUrl = bustCache ? `${url}?t=${Date.now()}` : url;
    const response = await fetch(fetchUrl, { credentials: 'include' });
    console.log(`[dataLoader] ${source} fetch: ${response.status}${bustCache ? ' (cache-busted)' : ''}`);

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
 *
 * Priority (production):
 * 1. CDN manifest (fast, cached) - primary source for initial load
 * 2. Local JSON fallback
 *
 * Note: DynamoDB is NOT used for initial load (too slow for 2000+ records).
 * New images appear via real-time subscriptions after initial load.
 */
async function loadAllImages(): Promise<ImageMetadata[]> {
  if (cachedImages) return cachedImages;

  if (!loadPromise) {
    loadPromise = (async () => {
      // In production, try CDN manifest first (fast, cached)
      if (!IS_LOCAL_DEV) {
        // Ensure Amplify is configured and signed cookies are set before fetching from CDN
        console.log('[dataLoader] Waiting for Amplify and CDN cookies...');
        const amplifyReady = await waitForAmplify();
        if (amplifyReady) {
          await refreshImageCookies();
        }

        const cdnImages = await fetchManifest(CDN_MANIFEST_URL, 'CDN manifest');
        if (cdnImages && cdnImages.length > 0) {
          cachedImages = cdnImages;
          console.log(`✅ Loaded ${cachedImages.length} images from CDN manifest`);
          return cachedImages;
        }
      }

      // Fall back to static local JSON (dev mode or if CDN fails)
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
 * Refetch manifest with cache-busting (for subscription-triggered reloads).
 * Bypasses CloudFront cache to get the freshest data.
 */
export async function refetchManifestFresh(): Promise<ImageMetadata[]> {
  console.log('[dataLoader] Refetching manifest with cache-bust...');

  const cdnImages = await fetchManifest(CDN_MANIFEST_URL, 'CDN manifest', true);
  if (cdnImages && cdnImages.length > 0) {
    cachedImages = cdnImages;
    loadPromise = Promise.resolve(cachedImages);
    console.log(`✅ Loaded ${cachedImages.length} images from CDN manifest (fresh)`);
    return cachedImages;
  }

  // Fall back to existing cache or empty
  return cachedImages || [];
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
 * Subscribe to manifest updates.
 * When the GPU processor finishes and updates the manifest,
 * this callback is triggered to refetch the manifest.
 */
export async function subscribeToManifestUpdates(
  onManifestUpdated: () => void
): Promise<() => void> {
  if (IS_LOCAL_DEV) {
    return () => {};
  }

  try {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<Schema>();

    // Custom subscription query to avoid requesting createdAt/updatedAt
    // (API key auth doesn't auto-generate timestamps, causing null errors)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const observable = client.graphql({
      query: `subscription OnCreateManifestUpdate {
        onCreateManifestUpdate {
          id
          version
          imageCount
          processedCount
          instanceId
        }
      }`
    }) as any;

    const subscription = observable.subscribe({
      next: (result: { data?: { onCreateManifestUpdate?: { version?: string; imageCount?: number } } }) => {
        const record = result.data?.onCreateManifestUpdate;
        if (record) {
          console.log('[dataLoader] Manifest updated:', record.version, 'images:', record.imageCount);
          // Invalidate cache so next load gets fresh data
          invalidateCache();
          onManifestUpdated();
        }
      },
      error: (err: Error) => {
        console.error('[dataLoader] ManifestUpdate subscription error:', err);
      },
    });

    return () => subscription.unsubscribe();
  } catch (e) {
    console.warn('[dataLoader] Failed to subscribe to manifest updates:', e);
    return () => {};
  }
}

/**
 * Subscribe to new images (real-time updates).
 * Returns an unsubscribe function.
 *
 * @deprecated Use subscribeToManifestUpdates instead - individual image
 * subscriptions are no longer used since we batch updates via manifest.
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
