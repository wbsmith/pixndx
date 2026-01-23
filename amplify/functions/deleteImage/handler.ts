import type { AppSyncResolverHandler } from 'aws-lambda';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;

interface DeleteImageInput {
  imageId: string;
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

  // Image prefixes to search and delete
  const imagePrefixes = [
    `images/small/${imageId}`,
    `images/medium/${imageId}`,
    `images/full/${imageId}`,
  ];

  try {
    // 1. Delete image files from S3 (handles different extensions)
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
              console.log(`Deleted: ${obj.Key}`);
            }
          }
        }
      } catch (error) {
        const msg = `Failed to delete ${prefix}: ${error instanceof Error ? error.message : 'Unknown'}`;
        console.warn(msg);
        errors.push(msg);
      }
    }

    const success = deletedFiles.length > 0;
    return {
      success,
      imageId,
      deletedFiles,
      message: success
        ? `Deleted ${deletedFiles.length} items`
        : `No files found for ${imageId}. Errors: ${errors.join(', ')}`,
    };
  } catch (error) {
    console.error('Failed to delete image:', error);
    throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
