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

