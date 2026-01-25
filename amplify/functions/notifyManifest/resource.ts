import { defineFunction } from '@aws-amplify/backend';

/**
 * Simple Lambda to notify frontend when manifest is updated.
 * Called by GPU processor after generating new manifest.
 *
 * Uses VPC endpoint to reach AppSync (GPU can't reach it directly
 * due to VPC endpoint private DNS configuration).
 */
export const notifyManifest = defineFunction({
  name: 'notifyManifest',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    // Set by backend.ts
    APPSYNC_ENDPOINT: '',
  },
});
