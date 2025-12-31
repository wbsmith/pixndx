import { defineFunction } from '@aws-amplify/backend';

/**
 * Search Images Lambda Function
 * 
 * Provides semantic search capabilities:
 * - Natural language query parsing
 * - Vector similarity search using embeddings
 * - Tag and metadata filtering
 * - Color-based search
 * - Mood-based search
 * 
 * Environment variables:
 * - STORAGE_BUCKET_NAME: S3 bucket for images and embeddings
 * - OPENSEARCH_ENDPOINT: (Optional) OpenSearch endpoint for production
 */
export const searchImages = defineFunction({
  name: 'searchImages',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: {
    // Add any additional environment variables here
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
});
