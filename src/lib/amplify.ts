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

// =============================================================================
// IMAGE URL HANDLING (Simplified)
// =============================================================================
// The manifest contains complete CDN URLs (https://cdn.picgraf.com/images/...).
// Signed cookies (set at login via refreshImageCookies) handle authentication.
// No URL transformation is needed - just use the URLs directly.
// =============================================================================

/**
 * Get a URL for an image.
 *
 * The manifest already contains complete CDN URLs (https://cdn.picgraf.com/images/...).
 * Signed cookies (set at login) handle authentication - no URL transformation needed.
 *
 * This function exists for backward compatibility but simply returns the URL as-is.
 * The 'size' parameter is ignored since the manifest URL already specifies the size.
 */
export async function getSignedImageUrl(
  imageUrl: string,
  _size: 'small' | 'medium' | 'full' = 'small'
): Promise<string> {
  // URLs from the manifest are already complete CDN URLs
  // Signed cookies handle authentication
  return imageUrl;
}

/**
 * Batch get URLs for multiple images.
 * Simply returns the URLs from the manifest (they're already complete CDN URLs).
 */
export async function getSignedImageUrls(
  images: Array<{ id: string; url: string }>,
  _size: 'small' | 'medium' | 'full' = 'small'
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  images.forEach(img => urlMap.set(img.id, img.url));
  return urlMap;
}

/**
 * React hook for getting an image URL.
 * Simply returns the URL as-is (manifest URLs are already complete CDN URLs).
 */
export function useImageUrl(
  imageUrl: string | undefined,
  _size: 'small' | 'medium' | 'full' = 'small'
): string | null {
  // URLs from manifest are already complete - just return as-is
  return imageUrl || null;
}

