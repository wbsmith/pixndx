import { defineFunction } from '@aws-amplify/backend';

/**
 * Delete Image Lambda Function
 *
 * Deletes image files from S3 and EFS, regenerates manifest:
 * 1. Delete S3: images/small/{imageId}.*, medium/*, full/*
 * 2. Delete EFS: metadata/{imageId}.json, embeddings/{imageId}.npy
 * 3. Regenerate manifest from remaining EFS metadata
 * 4. Trigger AppSync notification for real-time UI update
 *
 * Environment variables (set in backend.ts):
 * - STORAGE_BUCKET_NAME: S3 bucket for images
 * - EFS_MOUNT_PATH: Lambda EFS mount point
 * - APPSYNC_ENDPOINT: AppSync GraphQL endpoint
 * - APPSYNC_API_KEY: AppSync API key for mutations
 */
export const deleteImage = defineFunction({
  name: 'deleteImage',
  entry: './handler.ts',
  timeoutSeconds: 300, // 5 min max - manifest regen can be slow
  memoryMB: 1024, // Increased for file processing
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
