import { defineFunction } from '@aws-amplify/backend';

/**
 * Delete Image Lambda Function
 *
 * Deletes all files associated with an image:
 * - images/small/{imageId}.*
 * - images/medium/{imageId}.*
 * - images/full/{imageId}.*
 * - metadata/{imageId}.json
 * - embeddings/{imageId}.json (if exists)
 *
 * Environment variables (set in backend.ts):
 * - STORAGE_BUCKET_NAME: S3 bucket for images
 */
export const deleteImage = defineFunction({
  name: 'deleteImage',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
});
