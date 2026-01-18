import { defineFunction } from '@aws-amplify/backend';

/**
 * Process Image Lambda Function (Orchestrator)
 *
 * Lightweight orchestrator that:
 * 1. Copies uploaded image to processing-queue/ prefix
 * 2. Sends SQS message for GPU instance to process
 * 3. Starts GPU spot instance if not running
 *
 * Environment variables (set in backend.ts):
 * - STORAGE_BUCKET_NAME: S3 bucket for images
 * - SQS_QUEUE_URL: Queue for processing messages
 * - ASG_NAME: Auto Scaling Group name for GPU instances
 */
export const processImage = defineFunction({
  name: 'processImage',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
  runtime: 20, // Node.js 20.x
});
