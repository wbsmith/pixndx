import { defineFunction } from '@aws-amplify/backend';

/**
 * Delete Image Lambda Function
 *
 * Deletes image files from S3:
 * - images/small/{imageId}.*
 * - images/medium/{imageId}.*
 * - images/full/{imageId}.*
 *
 * Note: Manifest is rebuilt from EFS by GPU processor.
 * Orphan cleanup syncs manifest with actual S3 contents.
 *
 * Environment variables (set in backend.ts):
 * - STORAGE_BUCKET_NAME: S3 bucket for images
 */
export const deleteImage = defineFunction({
  name: 'deleteImage',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
});
