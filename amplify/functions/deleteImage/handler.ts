import type { AppSyncResolverHandler } from 'aws-lambda';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;

interface DeleteImageInput {
  imageId: string; // Image ID (filename without extension)
}

interface DeleteImageResult {
  success: boolean;
  imageId: string;
  deletedFiles: string[];
  message: string;
}

export const handler: AppSyncResolverHandler<DeleteImageInput, DeleteImageResult> = async (event) => {
  const { imageId } = event.arguments;

  if (!BUCKET_NAME) {
    throw new Error('STORAGE_BUCKET_NAME not configured');
  }

  if (!imageId) {
    throw new Error('imageId is required');
  }

  const deletedFiles: string[] = [];
  const errors: string[] = [];

  // Prefixes to search for image files
  const imagePrefixes = [
    `images/small/${imageId}`,
    `images/medium/${imageId}`,
    `images/full/${imageId}`,
  ];

  // Direct keys for metadata and embeddings
  const directKeys = [
    `metadata/${imageId}.json`,
    `embeddings/${imageId}.json`,
  ];

  try {
    // Delete image files by listing with prefix (handles different extensions)
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
            }
          }
        }
      } catch (error) {
        errors.push(`Failed to delete ${prefix}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Delete direct keys (metadata, embeddings)
    for (const key of directKeys) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        }));
        deletedFiles.push(key);
      } catch (error) {
        // Don't fail if file doesn't exist (e.g., embeddings may not exist)
        console.log(`Note: ${key} may not exist or failed to delete`);
      }
    }

    if (errors.length > 0) {
      console.warn('Some deletions failed:', errors);
    }

    return {
      success: true,
      imageId,
      deletedFiles,
      message: deletedFiles.length > 0
        ? `Deleted ${deletedFiles.length} files`
        : 'No files found to delete',
    };
  } catch (error) {
    console.error('Failed to delete image:', error);
    throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
