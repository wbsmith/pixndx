/**
 * Amplify Configuration
 *
 * This module handles Amplify configuration and provides utilities
 * for checking if Amplify is properly configured.
 */

import { useState, useEffect } from 'react';
import { IS_LOCAL_DEV, config } from '@/config';

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

// Session refresh interval (45 minutes - before the typical 1 hour expiry)
let sessionRefreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start proactive session refresh to prevent token expiration
 * Call this after successful authentication
 */
export function startSessionRefresh(): void {
  // Don't start in local dev
  if (IS_LOCAL_DEV) return;
  
  // Clear any existing interval
  if (sessionRefreshInterval) {
    clearInterval(sessionRefreshInterval);
  }
  
  // Refresh session every 45 minutes (tokens typically expire in 1 hour)
  const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
  
  sessionRefreshInterval = setInterval(async () => {
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      await fetchAuthSession({ forceRefresh: true });
      console.log('[Amplify] Proactive session refresh completed');

      // Refresh CloudFront signed cookies
      await refreshImageCookies();

      // Clear the signed URL cache on session refresh to ensure fresh URLs
      signedUrlCache.clear();
    } catch (error) {
      console.warn('[Amplify] Proactive session refresh failed:', error);
    }
  }, REFRESH_INTERVAL);
  
  console.log('[Amplify] Session refresh scheduled every 45 minutes');
}

/**
 * Stop proactive session refresh (call on logout)
 */
export function stopSessionRefresh(): void {
  if (sessionRefreshInterval) {
    clearInterval(sessionRefreshInterval);
    sessionRefreshInterval = null;
  }
}

/**
 * Fetch and set CloudFront signed cookies for image access.
 * These cookies allow authenticated access to CDN-served images.
 * Call this after login and on session refresh.
 */
export async function refreshImageCookies(): Promise<boolean> {
  if (IS_LOCAL_DEV || !amplifyConfigured) {
    return false;
  }

  try {
    const { generateClient } = await import('aws-amplify/data');
    const client = generateClient<import('../../amplify/data/resource').Schema>();

    const result = await client.mutations.generateImageCookies();

    if (result.errors || !result.data) {
      console.error('[Amplify] Failed to generate image cookies:', result.errors);
      return false;
    }

    const { cookies, cookieOptions } = result.data;

    // Parse cookies if it's a JSON string (GraphQL json type may return string)
    let cookieEntries: Record<string, string>;
    if (typeof cookies === 'string') {
      cookieEntries = JSON.parse(cookies);
    } else if (cookies && typeof cookies === 'object') {
      cookieEntries = cookies as Record<string, string>;
    } else {
      console.error('[Amplify] Unexpected cookies format:', typeof cookies, cookies);
      return false;
    }

    console.log('[Amplify] Cookie entries:', cookieEntries);
    console.log('[Amplify] Cookie options:', cookieOptions);

    // Clear any existing CloudFront cookies first
    clearImageCookies();

    // Set each CloudFront cookie on the parent domain
    for (const [name, value] of Object.entries(cookieEntries)) {
      // CloudFront cookie values may contain special chars, so we set them carefully
      const expires = new Date(cookieOptions.expires).toUTCString();
      const cookieString = `${name}=${value}; Domain=${cookieOptions.domain}; Path=${cookieOptions.path}; Expires=${expires}; SameSite=${cookieOptions.sameSite}${cookieOptions.secure ? '; Secure' : ''}`;

      console.log('[Amplify] Setting cookie:', name, 'length:', value.length);
      document.cookie = cookieString;
    }

    console.log('[Amplify] Image access cookies set successfully');
    return true;
  } catch (error) {
    console.error('[Amplify] Failed to refresh image cookies:', error);
    return false;
  }
}

/**
 * Clear CloudFront signed cookies (call on logout)
 */
export function clearImageCookies(): void {
  // Clear both canned policy (Expires) and custom policy (Policy) cookies
  const cookieNames = ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id', 'CloudFront-Expires'];
  const domain = '.picgraf.com';

  for (const name of cookieNames) {
    document.cookie = `${name}=; Domain=${domain}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  console.log('[Amplify] Image access cookies cleared');
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

// Track if we're currently refreshing the session to avoid multiple refreshes
let sessionRefreshPromise: Promise<boolean> | null = null;

/**
 * Refresh the auth session if it's expired
 * Returns true if session is valid after refresh attempt
 */
async function ensureValidSession(): Promise<boolean> {
  // If already refreshing, wait for that to complete
  if (sessionRefreshPromise) {
    return sessionRefreshPromise;
  }
  
  sessionRefreshPromise = (async () => {
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      // Force refresh the session to get new tokens
      const session = await fetchAuthSession({ forceRefresh: true });
      const isValid = !!session.tokens?.accessToken;
      console.log('[Amplify] Session refreshed:', isValid ? 'valid' : 'invalid');
      return isValid;
    } catch (error) {
      console.error('[Amplify] Failed to refresh session:', error);
      return false;
    } finally {
      // Clear the promise after a short delay to allow retry
      setTimeout(() => { sessionRefreshPromise = null; }, 1000);
    }
  })();
  
  return sessionRefreshPromise;
}

/**
 * Check if an error is an auth token error
 */
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('invalid login token') || 
           message.includes('token') ||
           message.includes('notauthorized') ||
           message.includes('credentials');
  }
  return false;
}

/**
 * Get a URL for an S3 image
 * Uses CDN if configured, otherwise falls back to signed URLs
 */
export async function getSignedImageUrl(
  s3Url: string, 
  size: 'small' | 'medium' | 'full' = 'small'
): Promise<string> {
  // In local dev, use the URL directly
  if (IS_LOCAL_DEV || !amplifyConfigured) {
    return s3Url;
  }
  
  // Extract the filename from the S3 URL
  const key = extractS3Key(s3Url);
  if (!key) {
    console.warn('Could not extract S3 key from URL:', s3Url);
    return s3Url; // Fallback to direct URL
  }
  
  // If CDN is configured, use it directly (signed cookies handle authentication)
  if (config.cdn.enabled && config.cdn.imageUrl) {
    return `${config.cdn.imageUrl}/images/${size}/${encodeURIComponent(key)}`;
  }
  
  // Check cache for signed URL
  const cacheKey = `${size}:${s3Url}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.url;
  }
  
  // Try to get signed URL, with retry on auth errors
  const attemptGetUrl = async (isRetry = false): Promise<string> => {
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
      // If it's an auth error and we haven't retried, refresh session and retry
      if (!isRetry && isAuthError(error)) {
        console.log('[Amplify] Auth error, refreshing session...');
        const sessionValid = await ensureValidSession();
        if (sessionValid) {
          // Clear the cache entry and retry
          signedUrlCache.delete(cacheKey);
          return attemptGetUrl(true);
        }
      }
      
      console.error('Failed to get signed URL:', error);
      return s3Url; // Fallback to direct URL
    }
  };
  
  return attemptGetUrl();
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

/**
 * React hook for getting an image URL with proper authentication
 * Handles CDN URLs with cookies or signed URLs depending on configuration
 */
export function useImageUrl(
  s3Url: string | undefined,
  size: 'small' | 'medium' | 'full' = 'small'
): string | null {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!s3Url) {
      setImageUrl(null);
      return;
    }

    let mounted = true;

    // In local dev, use URL directly
    if (IS_LOCAL_DEV) {
      setImageUrl(s3Url);
      return;
    }

    // Get the transformed URL (CDN or signed)
    getSignedImageUrl(s3Url, size).then((url) => {
      if (mounted) {
        setImageUrl(url);
      }
    });

    return () => {
      mounted = false;
    };
  }, [s3Url, size]);

  return imageUrl;
}

