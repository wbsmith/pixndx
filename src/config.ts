/**
 * PixNdx Gallery Configuration
 * 
 * These values can be overridden via environment variables.
 * In AWS Amplify, set these in the Console under "Environment variables"
 */

export const config = {
  // App display name - shown in header, auth screens, etc.
  // Override with VITE_APP_NAME environment variable
  appName: import.meta.env.VITE_APP_NAME || 'picgraf',
  
  // App tagline - shown on auth screen
  appTagline: import.meta.env.VITE_APP_TAGLINE || 'Explore the collection',
  
  // Copyright/footer text
  copyright: import.meta.env.VITE_COPYRIGHT || '© 2025',
  
  // AWS Region
  awsRegion: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  
  // Feature flags
  features: {
    // Enable admin/curation mode
    adminMode: import.meta.env.VITE_ENABLE_ADMIN !== 'false',
    
    // Enable ratings
    ratings: import.meta.env.VITE_ENABLE_RATINGS !== 'false',
    
    // Require authentication (always true in production)
    requireAuth: !import.meta.env.DEV || import.meta.env.VITE_USE_AUTH === 'true',
  },
  
  // Local development settings
  localDev: {
    // Skip auth in local dev
    skipAuth: import.meta.env.DEV && import.meta.env.VITE_USE_AUTH !== 'true',
    
    // Local image server URL
    imageBaseUrl: import.meta.env.VITE_IMAGE_BASE_URL || 'http://localhost:8080',
  },
  
  // CDN settings (set after Amplify deployment outputs the CDN URL)
  cdn: {
    // CloudFront CDN URL for images
    // Set this in Amplify Console after deployment: VITE_CDN_URL
    imageUrl: import.meta.env.VITE_CDN_URL || '',
    
    // Whether to use CDN (falls back to signed URLs if not set)
    enabled: !!import.meta.env.VITE_CDN_URL,
  },
};

// Export individual values for convenience
export const APP_NAME = config.appName;
export const APP_TAGLINE = config.appTagline;
export const IS_LOCAL_DEV = config.localDev.skipAuth;

