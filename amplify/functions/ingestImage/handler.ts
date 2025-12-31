import { 
  S3Client, 
  GetObjectCommand, 
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import * as path from 'path';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME!;

// Image size configurations
const IMAGE_SIZES = {
  small: { width: 200, height: 200, quality: 80 },
  medium: { width: 800, height: 800, quality: 85 },
  full: { quality: 90 },
};

// Types
interface IngestEvent {
  // S3 event trigger
  Records?: Array<{
    s3: {
      bucket: { name: string };
      object: { key: string };
    };
  }>;
  // Direct invocation
  sourceKey?: string;
  metadata?: ImageMetadata;
}

interface ImageMetadata {
  description: string;
  tags: Record<string, string[]>;
  mood: string;
  main_subject: string;
  main_colors: Record<string, string>;
  exif?: Record<string, any>;
}

interface IngestResult {
  success: boolean;
  imageId: string;
  urls: {
    small: string;
    medium: string;
    full: string;
  };
  error?: string;
}

/**
 * Main handler for image ingestion
 */
export const handler = async (event: IngestEvent): Promise<IngestResult | IngestResult[]> => {
  // Handle S3 trigger
  if (event.Records) {
    const results: IngestResult[] = [];
    
    for (const record of event.Records) {
      const sourceKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      const result = await processImage(sourceKey);
      results.push(result);
    }
    
    return results;
  }
  
  // Handle direct invocation
  if (event.sourceKey) {
    return processImage(event.sourceKey, event.metadata);
  }
  
  throw new Error('Invalid event: no Records or sourceKey provided');
};

/**
 * Process a single image
 */
async function processImage(
  sourceKey: string,
  providedMetadata?: ImageMetadata
): Promise<IngestResult> {
  const filename = path.basename(sourceKey);
  const imageId = path.basename(filename, path.extname(filename));
  
  try {
    console.log(`Processing image: ${sourceKey}`);
    
    // Get the source image
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: sourceKey,
    });
    
    const sourceResponse = await s3Client.send(getCommand);
    const imageBuffer = await streamToBuffer(sourceResponse.Body as Readable);
    const contentType = sourceResponse.ContentType || 'image/jpeg';
    
    // For now, we'll store the original as all sizes
    // In production, you'd use sharp or similar for actual resizing
    // npm install sharp && import sharp from 'sharp';
    
    const urls = {
      small: `images/small/${filename}`,
      medium: `images/medium/${filename}`,
      full: `images/full/${filename}`,
    };
    
    // Upload to each size folder
    // In production, resize the image for each size
    for (const [size, destPath] of Object.entries(urls)) {
      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: destPath,
        Body: imageBuffer, // In production: resize based on IMAGE_SIZES[size]
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000', // 1 year cache
      }));
      
      console.log(`Uploaded ${size}: ${destPath}`);
    }
    
    // Extract or use provided metadata
    let metadata: ImageMetadata;
    
    if (providedMetadata) {
      metadata = providedMetadata;
    } else {
      // Try to load existing metadata file
      const existingMetadata = await loadExistingMetadata(imageId);
      
      if (existingMetadata) {
        metadata = existingMetadata;
      } else {
        // Create placeholder metadata
        // In production, you might call an AI service here
        metadata = createPlaceholderMetadata(filename);
      }
    }
    
    // Add EXIF data if not present
    if (!metadata.exif) {
      metadata.exif = extractBasicExif(sourceResponse);
    }
    
    // Save metadata to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `metadata/${imageId}.json`,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));
    
    console.log(`Saved metadata: metadata/${imageId}.json`);
    
    return {
      success: true,
      imageId,
      urls: {
        small: `s3://${BUCKET_NAME}/${urls.small}`,
        medium: `s3://${BUCKET_NAME}/${urls.medium}`,
        full: `s3://${BUCKET_NAME}/${urls.full}`,
      },
    };
  } catch (error) {
    console.error(`Failed to process ${sourceKey}:`, error);
    
    return {
      success: false,
      imageId,
      urls: { small: '', medium: '', full: '' },
      error: String(error),
    };
  }
}

/**
 * Load existing metadata from S3
 */
async function loadExistingMetadata(imageId: string): Promise<ImageMetadata | null> {
  try {
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `metadata/${imageId}.json`,
    });
    
    const response = await s3Client.send(getCommand);
    const body = await streamToString(response.Body as Readable);
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Create placeholder metadata for images without AI-generated descriptions
 */
function createPlaceholderMetadata(filename: string): ImageMetadata {
  return {
    description: `Image: ${filename}`,
    tags: {
      uncategorized: ['unprocessed'],
    },
    mood: 'Unknown',
    main_subject: filename,
    main_colors: {
      unknown: '#808080',
    },
  };
}

/**
 * Extract basic EXIF from S3 object metadata
 */
function extractBasicExif(s3Response: any): Record<string, any> {
  return {
    FileName: s3Response.Metadata?.filename,
    ContentType: s3Response.ContentType,
    ContentLength: s3Response.ContentLength,
    LastModified: s3Response.LastModified?.toISOString(),
  };
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Convert stream to string
 */
async function streamToString(stream: Readable): Promise<string> {
  const buffer = await streamToBuffer(stream);
  return buffer.toString('utf-8');
}

/**
 * Production Image Resizing (requires sharp)
 * 
 * Uncomment and install sharp for actual resizing:
 * npm install sharp
 * 
 * import sharp from 'sharp';
 * 
 * async function resizeImage(
 *   buffer: Buffer,
 *   size: { width?: number; height?: number; quality: number }
 * ): Promise<Buffer> {
 *   let pipeline = sharp(buffer);
 *   
 *   if (size.width && size.height) {
 *     pipeline = pipeline.resize(size.width, size.height, {
 *       fit: 'inside',
 *       withoutEnlargement: true,
 *     });
 *   }
 *   
 *   return pipeline
 *     .jpeg({ quality: size.quality })
 *     .toBuffer();
 * }
 */
