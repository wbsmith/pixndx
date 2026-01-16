import { defineFunction } from '@aws-amplify/backend';

/**
 * Generate Image Cookies Lambda Function
 *
 * Generates CloudFront signed cookies for authenticated users to access images.
 *
 * Environment variables (set in backend.ts):
 * - CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: ARN of the Secrets Manager secret
 * - CLOUDFRONT_DOMAIN: CloudFront distribution domain
 * - CLOUDFRONT_KEY_PAIR_ID: CloudFront public key ID
 */
export const generateImageCookies = defineFunction({
  name: 'generateImageCookies',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
});
