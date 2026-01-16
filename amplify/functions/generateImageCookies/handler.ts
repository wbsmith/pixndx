import type { Schema } from '../../data/resource';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';

const secretsClient = new SecretsManagerClient({});

// Environment variables set in backend.ts
const PRIVATE_KEY_SECRET_ARN = process.env.CLOUDFRONT_PRIVATE_KEY_SECRET_ARN!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN!;
const KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID!;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN!;

// Cache the private key to avoid repeated Secrets Manager calls
let cachedPrivateKey: string | null = null;

async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const command = new GetSecretValueCommand({
    SecretId: PRIVATE_KEY_SECRET_ARN,
  });

  const response = await secretsClient.send(command);
  cachedPrivateKey = response.SecretString!;
  return cachedPrivateKey;
}

/**
 * Generate CloudFront signed cookies for authenticated image access.
 *
 * Returns three cookies that must be set on the parent domain (.picgraf.com):
 * - CloudFront-Policy
 * - CloudFront-Signature
 * - CloudFront-Key-Pair-Id
 */
export const handler: Schema['generateImageCookies']['functionHandler'] = async (event) => {
  try {
    // Get the private key from Secrets Manager
    const privateKey = await getPrivateKey();

    // Cookie expiration: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Generate signed cookies for all images under the CDN domain
    // Using a CUSTOM policy (not canned) to support wildcard paths
    // Canned policies (dateLessThan) don't support wildcards - the * is literal
    const customPolicy = JSON.stringify({
      Statement: [{
        Resource: `https://${CLOUDFRONT_DOMAIN}/*`,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': Math.floor(expiresAt.getTime() / 1000),
          },
        },
      }],
    });

    const signedCookies = getSignedCookies({
      url: `https://${CLOUDFRONT_DOMAIN}/*`,
      keyPairId: KEY_PAIR_ID,
      privateKey: privateKey,
      policy: customPolicy,  // Custom policy enables wildcard support
    });

    console.log('Generated cookie keys:', Object.keys(signedCookies));

    // Return all cookies the SDK generates (could be Policy or Expires based)
    return {
      cookies: signedCookies,
      cookieOptions: {
        domain: COOKIE_DOMAIN,
        path: '/',
        secure: true,
        sameSite: 'None', // Required for cross-site cookies
        expires: expiresAt.toISOString(),
      },
    };
  } catch (error) {
    console.error('Failed to generate signed cookies:', error);
    throw new Error('Failed to generate image access cookies');
  }
};
