import { defineFunction } from '@aws-amplify/backend';

/**
 * Compute Similarity Lambda Function
 * 
 * Computes similarity between images for graph visualization:
 * - Cosine similarity on CLIP embeddings
 * - Color palette similarity
 * - Mood/tag overlap
 * - Description embedding similarity
 * - Composite weighted similarity
 * 
 * Environment variables:
 * - STORAGE_BUCKET_NAME: S3 bucket for metadata and embeddings
 */
export const computeSimilarity = defineFunction({
  name: 'computeSimilarity',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20,
});
