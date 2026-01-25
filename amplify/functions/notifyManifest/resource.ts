import { defineFunction } from '@aws-amplify/backend';

/**
 * Simple Lambda to notify frontend when manifest is updated.
 * Called by GPU processor after generating new manifest.
 *
 * NOT in VPC - reaches public AppSync directly (GPU can't reach it
 * directly due to VPC endpoint routing).
 *
 * Assigned to 'data' stack to avoid circular dependency with AppSync.
 */
export const notifyManifest = defineFunction({
  name: 'notifyManifest',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  resourceGroupName: 'data',  // Avoid circular dependency with AppSync
  environment: {
    // Set by backend.ts
    APPSYNC_ENDPOINT: '',
  },
});
