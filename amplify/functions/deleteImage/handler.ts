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
  imageIds: string[];
}

interface DeleteImageResult {
  success: boolean;
  deletedImageIds: string[];
  failedImageIds: string[];
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
  const { imageIds } = event.arguments;

  logWithTime(startTime, `=== deleteImage started for ${imageIds.length} images ===`);
  logWithTime(startTime, `Image IDs: ${imageIds.join(', ')}`);
  logWithTime(startTime, `EFS_MOUNT_PATH: ${EFS_MOUNT_PATH}`);
  logWithTime(startTime, `BUCKET_NAME: ${BUCKET_NAME}`);

  if (!BUCKET_NAME) {
    throw new Error('STORAGE_BUCKET_NAME not configured');
  }

  if (!imageIds || imageIds.length === 0) {
    throw new Error('imageIds array is required and must not be empty');
  }

  const deletedFiles: string[] = [];
  const deletedImageIds: string[] = [];
  const failedImageIds: string[] = [];
  const errors: string[] = [];
  let manifestUpdated = false;

  try {
    // 1. Delete image files from S3 for all images
    logWithTime(startTime, `Step 1: Deleting S3 files for ${imageIds.length} images...`);

    for (const imageId of imageIds) {
      const imagePrefixes = [
        `images/small/${imageId}`,
        `images/medium/${imageId}`,
        `images/full/${imageId}`,
      ];

      let imageDeleted = false;

      for (const prefix of imagePrefixes) {
        try {
          const listResult = await s3.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: 10,
          }));

          if (listResult.Contents) {
            for (const obj of listResult.Contents) {
              if (obj.Key) {
                await s3.send(new DeleteObjectCommand({
                  Bucket: BUCKET_NAME,
                  Key: obj.Key,
                }));
                deletedFiles.push(obj.Key);
                imageDeleted = true;
              }
            }
          }
        } catch (error) {
          const msg = `Failed to delete S3 ${prefix}: ${error instanceof Error ? error.message : 'Unknown'}`;
          console.warn(msg);
          errors.push(msg);
        }
      }

      if (imageDeleted) {
        deletedImageIds.push(imageId);
      }
    }

    logWithTime(startTime, `Step 1 complete: ${deletedFiles.length} S3 files deleted for ${deletedImageIds.length} images`);

    // 2. Delete metadata and embeddings from EFS for all images
    logWithTime(startTime, `Step 2: Deleting EFS files for ${imageIds.length} images...`);

    for (const imageId of imageIds) {
      const efsFiles = [
        path.join(EFS_MOUNT_PATH, 'metadata', `${imageId}.json`),
        path.join(EFS_MOUNT_PATH, 'embeddings', `${imageId}.npy`),
      ];

      for (const filePath of efsFiles) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedFiles.push(`efs:${path.basename(filePath)}`);

            // Mark as deleted if not already (from S3 deletion)
            if (!deletedImageIds.includes(imageId)) {
              deletedImageIds.push(imageId);
            }
          }
        } catch (error) {
          const msg = `Failed to delete EFS ${filePath}: ${error instanceof Error ? error.message : 'Unknown'}`;
          console.warn(msg);
          errors.push(msg);
        }
      }
    }

    logWithTime(startTime, `Step 2 complete: EFS cleanup done`);

    // Track failed images
    for (const imageId of imageIds) {
      if (!deletedImageIds.includes(imageId)) {
        failedImageIds.push(imageId);
      }
    }

    // 3. Regenerate manifest from remaining EFS metadata (ONCE for all deletions)
    logWithTime(startTime, 'Step 3: Regenerating manifest from EFS (once for all deletions)...');
    try {
      const metadataDir = path.join(EFS_MOUNT_PATH, 'metadata');

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

    const success = deletedImageIds.length > 0;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logWithTime(startTime, `=== deleteImage completed in ${totalTime}s ===`);
    logWithTime(startTime, `Result: ${deletedImageIds.length}/${imageIds.length} images deleted, ${deletedFiles.length} files removed`);

    return {
      success,
      deletedImageIds,
      failedImageIds,
      deletedFiles,
      manifestUpdated,
      message: success
        ? `Deleted ${deletedImageIds.length}/${imageIds.length} images (${deletedFiles.length} files) in ${totalTime}s`
        : `No files found. Errors: ${errors.join(', ')}`,
    };
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logWithTime(startTime, `=== deleteImage FAILED after ${totalTime}s ===`);
    console.error('Failed to delete images:', error);
    throw new Error(`Failed to delete images: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Sign a request with AWS Signature v4 using Lambda's credentials
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

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  const host = url.hostname;
  const urlPath = url.pathname || '/';
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
    urlPath,
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, datetime, credentialScope, hashedCanonicalRequest].join('\n');

  const hmac = (key: Buffer | string, data: string) =>
    crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    authorization,
  };
}

/**
 * Notify frontend via AppSync that manifest was updated
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
      ttl: Math.floor(Date.now() / 1000) + 86400,
    },
  };

  try {
    const url = new URL(APPSYNC_ENDPOINT);
    const body = JSON.stringify({ query: mutation, variables });
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
