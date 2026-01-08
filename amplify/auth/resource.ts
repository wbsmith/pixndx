import { defineAuth } from '@aws-amplify/backend';

/**
 * Authentication configuration for PicGraf Gallery
 * 
 * IMPORTANT: This gallery requires authentication to access.
 * All users must sign in to view images.
 * 
 * Supports:
 * - Email/password sign-up and sign-in
 * - Optional social providers (Google, Facebook, Apple)
 * - Multi-factor authentication
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      // Email verification settings
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: `Welcome to picgraf`,
      verificationEmailBody: (createCode) =>
        `Welcome to picgraf!\n\nYour verification code is: ${createCode()}\n\nThis code expires in 24 hours.`,
    },
  },
  
  // No extra user attributes - just email
  // Email is automatically used as the username
  
  // Account recovery options
  accountRecovery: 'EMAIL_ONLY',
  
  // Multi-factor authentication (optional)
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
});

/**
 * Security Notes:
 * 
 * 1. NO GUEST ACCESS - All routes require authentication
 *    The app will show a login screen before any content is visible.
 * 
 * 2. SIGNED URLS - Images are served via pre-signed S3 URLs
 *    that expire after a short time, preventing direct scraping.
 * 
 * 3. RATE LIMITING - Configure in CloudFront/API Gateway
 *    to prevent abuse.
 * 
 * 4. To add social sign-in (recommended for easier onboarding):
 *    ```typescript
 *    loginWith: {
 *      email: true,
 *      externalProviders: {
 *        google: {
 *          clientId: 'your-google-client-id',
 *          clientSecret: 'your-google-client-secret',
 *        },
 *        signInWithApple: {
 *          clientId: 'your-apple-client-id',
 *          teamId: 'your-team-id',
 *          keyId: 'your-key-id',
 *          privateKey: 'your-private-key',
 *        },
 *        callbackUrls: ['https://yourdomain.com/'],
 *        logoutUrls: ['https://yourdomain.com/'],
 *      },
 *    },
 *    ```
 */
