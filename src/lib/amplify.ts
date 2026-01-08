/**
 * Amplify Configuration
 * 
 * This module handles Amplify configuration and provides utilities
 * for checking if Amplify is properly configured.
 */

import { IS_LOCAL_DEV } from '@/config';

let amplifyConfigured = false;
let configurationPromise: Promise<void> | null = null;

/**
 * Configure Amplify (call this early in the app lifecycle)
 */
export async function configureAmplify(): Promise<boolean> {
  // In local dev, skip Amplify configuration
  if (IS_LOCAL_DEV) {
    console.log('[Amplify] Skipping configuration in local dev mode');
    return false;
  }

  // If already configured, return immediately
  if (amplifyConfigured) {
    return true;
  }

  // If configuration is in progress, wait for it
  if (configurationPromise) {
    await configurationPromise;
    return amplifyConfigured;
  }

  // Start configuration
  configurationPromise = (async () => {
    try {
      const { Amplify } = await import('aws-amplify');
      const outputs = await import('../../amplify_outputs.json');
      Amplify.configure(outputs.default || outputs);
      amplifyConfigured = true;
      console.log('✅ Amplify configured successfully');
    } catch (e) {
      console.warn('[Amplify] Configuration failed:', e);
      amplifyConfigured = false;
    }
  })();

  await configurationPromise;
  return amplifyConfigured;
}

/**
 * Check if Amplify is configured
 */
export function isAmplifyConfigured(): boolean {
  return amplifyConfigured;
}

/**
 * Wait for Amplify to be configured
 */
export async function waitForAmplify(): Promise<boolean> {
  if (amplifyConfigured) return true;
  if (configurationPromise) {
    await configurationPromise;
    return amplifyConfigured;
  }
  return configureAmplify();
}

/**
 * Extract S3 key from a full S3 URL
 * 
 * Example:
 * Input:  https://bucket.s3.region.amazonaws.com/images/small/photo.jpg
 * Output: photo.jpg
 */
export function extractS3Key(url: string): string | null {
  try {
    // Handle full S3 URLs
    const s3Pattern = /\.s3\.[^/]+\.amazonaws\.com\/images\/(?:small|medium|full)\/(.+)$/;
    const match = url.match(s3Pattern);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    
    // If it's already a key (no protocol), return as-is
    if (!url.startsWith('http')) {
      return url;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the S3 path for an image
 */
export function getS3Path(filename: string, size: 'small' | 'medium' | 'full' = 'small'): string {
  return `images/${size}/${filename}`;
}

// Cache for signed URLs to avoid repeated API calls
const signedUrlCache = new Map<string, { url: string; expires: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get a signed URL for an S3 image
 * Handles caching and falls back to direct URL in dev mode
 */
export async function getSignedImageUrl(
  s3Url: string, 
  size: 'small' | 'medium' | 'full' = 'small'
): Promise<string> {
  // In local dev, use the URL directly
  if (IS_LOCAL_DEV || !amplifyConfigured) {
    return s3Url;
  }
  
  // Check cache
  const cacheKey = `${size}:${s3Url}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.url;
  }
  
  // Extract the filename from the S3 URL
  const key = extractS3Key(s3Url);
  if (!key) {
    console.warn('Could not extract S3 key from URL:', s3Url);
    return s3Url; // Fallback to direct URL
  }
  
  try {
    const { getUrl } = await import('aws-amplify/storage');
    const result = await getUrl({
      path: `images/${size}/${key}`,
      options: { expiresIn: 900 }, // 15 minutes
    });
    const signedUrl = result.url.toString();
    
    // Cache the result
    signedUrlCache.set(cacheKey, {
      url: signedUrl,
      expires: Date.now() + CACHE_TTL,
    });
    
    return signedUrl;
  } catch (error) {
    console.error('Failed to get signed URL:', error);
    return s3Url; // Fallback to direct URL
  }
}

/**
 * Batch fetch signed URLs for multiple images
 * More efficient than individual calls for gallery views
 */
export async function getSignedImageUrls(
  images: Array<{ id: string; url: string }>,
  size: 'small' | 'medium' | 'full' = 'small'
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  
  // In local dev, return direct URLs
  if (IS_LOCAL_DEV || !amplifyConfigured) {
    images.forEach(img => urlMap.set(img.id, img.url));
    return urlMap;
  }
  
  // Fetch all URLs in parallel
  await Promise.all(
    images.map(async (img) => {
      const signedUrl = await getSignedImageUrl(img.url, size);
      urlMap.set(img.id, signedUrl);
    })
  );
  
  return urlMap;
}

