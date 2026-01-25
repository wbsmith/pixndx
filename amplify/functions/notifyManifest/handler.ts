import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

interface NotifyManifestInput {
  imageCount: number;
  processedCount?: number;
  instanceId?: string;
}

interface NotifyManifestResult {
  success: boolean;
  message: string;
}

/**
 * Lambda handler that sends manifest update notifications to AppSync.
 * Called by GPU instance when it can't reach AppSync directly (VPC endpoint issue).
 * Uses IAM auth (SigV4) to authenticate with AppSync.
 */
export const handler = async (event: NotifyManifestInput): Promise<NotifyManifestResult> => {
  console.log('Received notification request:', event);

  if (!APPSYNC_ENDPOINT) {
    return {
      success: false,
      message: 'AppSync endpoint not configured',
    };
  }

  const { imageCount, processedCount = 0, instanceId = 'gpu-processor' } = event;

  // TTL: 1 day from now (for DynamoDB auto-cleanup)
  const ttl = Math.floor(Date.now() / 1000) + 86400;

  const mutation = `
    mutation CreateManifestUpdate($input: CreateManifestUpdateInput!) {
      createManifestUpdate(input: $input) {
        id
        version
        imageCount
      }
    }
  `;

  const variables = {
    input: {
      version: new Date().toISOString(),
      imageCount,
      processedCount,
      instanceId,
      ttl,
    },
  };

  try {
    const url = new URL(APPSYNC_ENDPOINT);
    const body = JSON.stringify({ query: mutation, variables });

    // Create SigV4 signer
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
      region: AWS_REGION,
      service: 'appsync',
      sha256: Sha256,
    });

    const request = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        host: url.hostname,
      },
      body,
    };

    const signedRequest = await signer.sign(request);

    const response = await fetch(APPSYNC_ENDPOINT, {
      method: 'POST',
      headers: signedRequest.headers as Record<string, string>,
      body,
    });

    if (response.ok) {
      const result = await response.json();
      if (result.errors) {
        console.warn('AppSync mutation errors:', result.errors);
        return {
          success: false,
          message: `AppSync errors: ${JSON.stringify(result.errors)}`,
        };
      }
      console.log('AppSync notification sent:', result.data);
      return {
        success: true,
        message: `Notification sent for ${imageCount} images`,
      };
    } else {
      const text = await response.text();
      console.warn(`AppSync request failed: ${response.status} - ${text}`);
      return {
        success: false,
        message: `AppSync request failed: ${response.status}`,
      };
    }
  } catch (error) {
    console.error('Failed to notify AppSync:', error);
    return {
      success: false,
      message: `Error: ${error}`,
    };
  }
};
