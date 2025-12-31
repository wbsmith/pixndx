import { defineFunction } from '@aws-amplify/backend';

/**
 * Ingest Image Lambda Function
 * 
 * Processes uploaded images:
 * - Extracts EXIF metadata
 * - Generates multiple sizes (small, medium, full)
 * - Stores metadata in S3
 * - Optionally generates embeddings (if AI service is configured)
 * - Creates database record
 * 
 * Triggered by:
 * - S3 upload to uploads/ folder
 * - Direct API call for batch processing
 * 
 * Environment variables:
 * - STORAGE_BUCKET_NAME: S3 bucket for images
 */
export const ingestImage = defineFunction({
  name: 'ingestImage',
  entry: './handler.ts',
  timeoutSeconds: 120, // Image processing can take time
  memoryMB: 1024, // Need more memory for image processing
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20,
});
