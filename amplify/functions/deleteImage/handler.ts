import type { AppSyncResolverHandler } from 'aws-lambda';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const s3 = new S3Client({});

const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
const EFS_MOUNT_PATH = process.env.EFS_MOUNT_PATH || '/mnt/efs';
const CDN_BASE = 'https://cdn.picgraf.com';
const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

interface DeleteImageInput {
  imageId: string;
}

interface DeleteImageResult {
  success: boolean;
  imageId: string;
  deletedFiles: string[];
  message: string;
  manifestUpdated: boolean;
}

interface ImageMetadata {
  id: string;
  filename?: string;
  urls?: {
    small?: string;
    medium?: string;
    full?: string;
  };
  description?: string;
  mood?: string;
  main_subject?: string;
  tags?: Record<string, string[]>;
  main_colors?: Record<string, string>;
  exif?: Record<string, unknown>;
  clipNeighbors?: Array<{ id: string; clipWeight: number; compositeWeight: number }>;
  compositeNeighbors?: Array<{ id: string; clipWeight: number; compositeWeight: number }>;
  avgRating?: number;
  ratingCount?: number;
}

/** Helper to log with elapsed time */
function logWithTime(startTime: number, message: string): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[${elapsed}s] ${message}`);
}

export const handler: AppSyncResolverHandler<DeleteImageInput, DeleteImageResult> = async (event) => {
  const startTime = Date.now();
  const { imageId } = event.arguments;

  logWithTime(startTime, `=== deleteImage started for ${imageId} ===`);
  logWithTime(startTime, `EFS_MOUNT_PATH: ${EFS_MOUNT_PATH}`);
  logWithTime(startTime, `BUCKET_NAME: ${BUCKET_NAME}`);
  logWithTime(startTime, `APPSYNC_ENDPOINT: ${APPSYNC_ENDPOINT ? 'configured' : 'not configured'}`);

  if (!BUCKET_NAME) {
    throw new Error('STORAGE_BUCKET_NAME not configured');
  }

  if (!imageId) {
    throw new Error('imageId is required');
  }

  const deletedFiles: string[] = [];
  const errors: string[] = [];
  let manifestUpdated = false;

  // Image prefixes to search and delete from S3
  const imagePrefixes = [
    `images/small/${imageId}`,
    `images/medium/${imageId}`,
    `images/full/${imageId}`,
  ];

  try {
    // 1. Delete image files from S3
    logWithTime(startTime, `Step 1: Deleting S3 files for ${imageId}...`);
    for (const prefix of imagePrefixes) {
      try {
        const listStart = Date.now();
        const listResult = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          MaxKeys: 10,
        }));
        logWithTime(startTime, `  Listed ${prefix} (${Date.now() - listStart}ms)`);

        if (listResult.Contents) {
          for (const obj of listResult.Contents) {
            if (obj.Key) {
              const deleteStart = Date.now();
              await s3.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: obj.Key,
              }));
              deletedFiles.push(obj.Key);
              logWithTime(startTime, `  Deleted S3: ${obj.Key} (${Date.now() - deleteStart}ms)`);
            }
          }
        }
      } catch (error) {
        const msg = `Failed to delete S3 ${prefix}: ${error instanceof Error ? error.message : 'Unknown'}`;
        console.warn(msg);
        errors.push(msg);
      }
    }
    logWithTime(startTime, `Step 1 complete: ${deletedFiles.length} S3 files deleted`);

    // 2. Delete metadata and embeddings from EFS
    logWithTime(startTime, `Step 2: Deleting EFS files for ${imageId}...`);
    const efsFiles = [
      path.join(EFS_MOUNT_PATH, 'metadata', `${imageId}.json`),
      path.join(EFS_MOUNT_PATH, 'embeddings', `${imageId}.npy`),
    ];

    for (const filePath of efsFiles) {
      try {
        const existsStart = Date.now();
        const exists = fs.existsSync(filePath);
        logWithTime(startTime, `  Check ${path.basename(filePath)}: ${exists ? 'exists' : 'not found'} (${Date.now() - existsStart}ms)`);
        if (exists) {
          const deleteStart = Date.now();
          fs.unlinkSync(filePath);
          deletedFiles.push(`efs:${path.basename(filePath)}`);
          logWithTime(startTime, `  Deleted EFS: ${filePath} (${Date.now() - deleteStart}ms)`);
        }
      } catch (error) {
        const msg = `Failed to delete EFS ${filePath}: ${error instanceof Error ? error.message : 'Unknown'}`;
        console.warn(msg);
        errors.push(msg);
      }
    }
    logWithTime(startTime, `Step 2 complete`);

    // 3. Regenerate manifest from remaining EFS metadata
    logWithTime(startTime, 'Step 3: Regenerating manifest from EFS...');
    try {
      const metadataDir = path.join(EFS_MOUNT_PATH, 'metadata');

      logWithTime(startTime, `  Checking metadata dir: ${metadataDir}`);
      if (fs.existsSync(metadataDir)) {
        const images: ImageMetadata[] = [];

        const readDirStart = Date.now();
        const files = fs.readdirSync(metadataDir).filter(f => f.endsWith('.json'));
        logWithTime(startTime, `  Found ${files.length} metadata files (${Date.now() - readDirStart}ms)`);

        const parseStart = Date.now();
        let processedCount = 0;
        for (const file of files) {
          try {
            const metaPath = path.join(metadataDir, file);
            const metaContent = fs.readFileSync(metaPath, 'utf-8');
            const metadata = JSON.parse(metaContent);
            const imgId = file.replace('.json', '');

            // Neighbors data is embedded in metadata JSON
            images.push({
              id: imgId,
              filename: metadata.filename || `${imgId}.jpg`,
              urls: metadata.urls || {
                small: `${CDN_BASE}/images/small/${imgId}.jpg`,
                medium: `${CDN_BASE}/images/medium/${imgId}.jpg`,
                full: `${CDN_BASE}/images/full/${imgId}.jpg`,
              },
              description: metadata.description || '',
              mood: metadata.mood || 'neutral',
              main_subject: metadata.main_subject || '',
              tags: metadata.tags || {},
              main_colors: metadata.main_colors || {},
              exif: metadata.exif || {},
              clipNeighbors: metadata.clipNeighbors || [],
              compositeNeighbors: metadata.compositeNeighbors || [],
              avgRating: metadata.avgRating || 0,
              ratingCount: metadata.ratingCount || 0,
            });

            processedCount++;
            // Log progress every 500 files
            if (processedCount % 500 === 0) {
              logWithTime(startTime, `  Processed ${processedCount}/${files.length} metadata files...`);
            }
          } catch (error) {
            console.warn(`Failed to read metadata ${file}: ${error}`);
          }
        }
        logWithTime(startTime, `  Parsed ${images.length} images (${Date.now() - parseStart}ms)`);

        const manifest = {
          version: '3.0',
          generatedAt: new Date().toISOString(),
          count: images.length,
          images,
        };

        // Upload to S3
        logWithTime(startTime, '  Uploading manifest to S3...');
        const uploadStart = Date.now();
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: 'manifest/images.json',
          Body: JSON.stringify(manifest),
          ContentType: 'application/json',
          CacheControl: 'public, max-age=60',
        }));
        logWithTime(startTime, `  Manifest uploaded (${Date.now() - uploadStart}ms)`);

        logWithTime(startTime, `Step 3 complete: manifest has ${images.length} images`);
        manifestUpdated = true;

        // 4. Trigger AppSync notification
        if (APPSYNC_ENDPOINT) {
          logWithTime(startTime, 'Step 4: Triggering AppSync notification...');
          const notifyStart = Date.now();
          await notifyManifestUpdated(images.length);
          logWithTime(startTime, `Step 4 complete (${Date.now() - notifyStart}ms)`);
        } else {
          logWithTime(startTime, 'Step 4: Skipped - AppSync not configured');
        }
      } else {
        logWithTime(startTime, `  ERROR: Metadata dir does not exist: ${metadataDir}`);
        errors.push(`Metadata directory not found: ${metadataDir}`);
      }
    } catch (error) {
      const msg = `Failed to regenerate manifest: ${error instanceof Error ? error.message : 'Unknown'}`;
      console.error(msg);
      errors.push(msg);
    }

    const success = deletedFiles.length > 0;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logWithTime(startTime, `=== deleteImage completed in ${totalTime}s ===`);
    logWithTime(startTime, `Result: ${deletedFiles.length} files deleted, manifest ${manifestUpdated ? 'updated' : 'not updated'}`);

    return {
      success,
      imageId,
      deletedFiles,
      manifestUpdated,
      message: success
        ? `Deleted ${deletedFiles.length} items in ${totalTime}s, manifest ${manifestUpdated ? 'updated' : 'not updated'}`
        : `No files found for ${imageId}. Errors: ${errors.join(', ')}`,
    };
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logWithTime(startTime, `=== deleteImage FAILED after ${totalTime}s ===`);
    console.error('Failed to delete image:', error);
    throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Sign a request with AWS Signature v4 using Lambda's credentials
 * Uses Node.js built-in crypto module
 */
function signRequest(
  method: string,
  url: URL,
  body: string,
  region: string,
  service: string
): Record<string, string> {
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.slice(0, 8);

  // Get credentials from environment (Lambda runtime provides these)
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  // Create canonical request
  const host = url.hostname;
  const path = url.pathname || '/';
  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-amz-date': datetime,
  };
  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');

  const canonicalRequest = [
    method,
    path,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, datetime, credentialScope, hashedCanonicalRequest].join('\n');

  // Calculate signature
  const hmac = (key: Buffer | string, data: string) =>
    crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  // Build authorization header
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    authorization,
  };
}

/**
 * Notify frontend via AppSync that manifest was updated
 * Uses IAM authentication (AWS Signature v4)
 */
async function notifyManifestUpdated(imageCount: number): Promise<void> {
  if (!APPSYNC_ENDPOINT) {
    console.log('AppSync endpoint not configured, skipping notification');
    return;
  }

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
      ttl: Math.floor(Date.now() / 1000) + 86400, // 1 day TTL
    },
  };

  try {
    const url = new URL(APPSYNC_ENDPOINT);
    const body = JSON.stringify({ query: mutation, variables });

    // Sign request with AWS Signature v4
    const headers = signRequest('POST', url, body, AWS_REGION, 'appsync');

    const response = await fetch(APPSYNC_ENDPOINT, {
      method: 'POST',
      headers,
      body,
    });

    if (response.ok) {
      const result = await response.json();
      if (result.errors) {
        console.warn('AppSync mutation errors:', result.errors);
      } else {
        console.log('AppSync notification sent');
      }
    } else {
      const text = await response.text();
      console.warn(`AppSync request failed: ${response.status} - ${text}`);
    }
  } catch (error) {
    console.warn(`Failed to notify AppSync: ${error}`);
  }
}
