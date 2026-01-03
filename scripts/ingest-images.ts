#!/usr/bin/env npx ts-node

/**
 * Ingest Images Script
 * 
 * Uploads images and metadata from local processed_gallery/ structure to S3
 * and populates DynamoDB with image records.
 * 
 * Expected local structure:
 *   processed_gallery/
 *     small/      - Thumbnail images
 *     medium/     - 1024px images  
 *     full/       - Full resolution images
 *     metadata/   - JSON metadata and .npy vector files
 * 
 * Usage:
 *   npx ts-node scripts/ingest-images.ts --source ./processed_gallery
 *   npx ts-node scripts/ingest-images.ts --source ./processed_gallery --dry-run
 *   npx ts-node scripts/ingest-images.ts --source ./processed_gallery --skip-images
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  S3Client, 
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { 
  DynamoDBClient 
} from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { parseArgs } from 'util';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface Config {
  sourcePath: string;
  bucketName: string;
  tableName: string;
  region: string;
  dryRun: boolean;
  skipImages: boolean;
  skipMetadata: boolean;
  skipDatabase: boolean;
  concurrency: number;
  verbose: boolean;
}

const DEFAULT_CONFIG: Partial<Config> = {
  region: process.env.AWS_REGION || 'us-east-1',
  bucketName: process.env.S3_BUCKET_NAME || '',
  tableName: process.env.DYNAMODB_TABLE_NAME || '',
  dryRun: false,
  skipImages: false,
  skipMetadata: false,
  skipDatabase: false,
  concurrency: 10,
  verbose: false,
};

// ============================================================================
// TYPES
// ============================================================================

interface ImageMetadata {
  id: string;
  filename: string;
  description: string;
  mood: string;
  main_subject: string;
  tags: Record<string, string[]>;
  main_colors: Record<string, string>;
  exif?: Record<string, unknown>;
}

interface UploadResult {
  success: boolean;
  key: string;
  error?: string;
}

interface IngestStats {
  imagesUploaded: number;
  imagesSkipped: number;
  imagesFailed: number;
  metadataUploaded: number;
  metadataSkipped: number;
  metadataFailed: number;
  dbRecordsCreated: number;
  dbRecordsFailed: number;
  totalTime: number;
}

// ============================================================================
// CLIENTS
// ============================================================================

let s3Client: S3Client;
let dynamoClient: DynamoDBDocumentClient;

function initClients(region: string) {
  s3Client = new S3Client({ region });
  const ddbClient = new DynamoDBClient({ region });
  dynamoClient = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function log(message: string, verbose = false) {
  if (!verbose || config.verbose) {
    console.log(message);
  }
}

function error(message: string) {
  console.error(`❌ ${message}`);
}

function success(message: string) {
  console.log(`✅ ${message}`);
}

function warn(message: string) {
  console.log(`⚠️  ${message}`);
}

/**
 * Get all files in a directory with specific extensions
 */
function getFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  return fs.readdirSync(dir)
    .filter(file => extensions.some(ext => file.toLowerCase().endsWith(ext)))
    .map(file => path.join(dir, file));
}

/**
 * Extract base filename without extension
 */
function getBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Read and parse JSON metadata file
 */
function readMetadata(jsonPath: string): ImageMetadata | null {
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    error(`Failed to read metadata: ${jsonPath}`);
    return null;
  }
}

/**
 * Check if object exists in S3
 */
async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload file to S3
 */
async function uploadToS3(
  filePath: string, 
  bucket: string, 
  key: string,
  contentType?: string
): Promise<UploadResult> {
  try {
    const fileContent = fs.readFileSync(filePath);
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType || getContentType(filePath),
    }));
    
    return { success: true, key };
  } catch (err) {
    return { 
      success: false, 
      key, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
}

/**
 * Get content type from file extension
 */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.npy': 'application/octet-stream',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Process items in parallel with concurrency limit
 */
async function processInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });
    executing.push(promise);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(0, executing.findIndex(p => p === promise) + 1);
    }
  }
  
  await Promise.all(executing);
  return results;
}

// ============================================================================
// UPLOAD FUNCTIONS
// ============================================================================

/**
 * Upload all images in a size folder
 */
async function uploadImages(
  sourceDir: string,
  bucket: string,
  size: 'small' | 'medium' | 'full',
  stats: IngestStats
): Promise<void> {
  const imagesDir = path.join(sourceDir, size);
  const files = getFiles(imagesDir, ['.jpg', '.jpeg', '.png', '.gif', '.webp']);
  
  if (files.length === 0) {
    warn(`No images found in ${imagesDir}`);
    return;
  }
  
  log(`\nUploading ${files.length} ${size} images...`);
  
  let processed = 0;
  
  await processInParallel(files, async (filePath) => {
    const filename = path.basename(filePath);
    const key = `images/${size}/${filename}`;
    
    if (config.dryRun) {
      log(`  [DRY RUN] Would upload: ${key}`, true);
      stats.imagesSkipped++;
      return;
    }
    
    // Check if already exists
    if (await objectExists(bucket, key)) {
      log(`  Skipping (exists): ${key}`, true);
      stats.imagesSkipped++;
      return;
    }
    
    const result = await uploadToS3(filePath, bucket, key);
    
    if (result.success) {
      stats.imagesUploaded++;
    } else {
      error(`Failed to upload ${filename}: ${result.error}`);
      stats.imagesFailed++;
    }
    
    processed++;
    if (processed % 100 === 0) {
      log(`  Progress: ${processed}/${files.length}`);
    }
  }, config.concurrency);
  
  success(`${size}: ${stats.imagesUploaded} uploaded, ${stats.imagesSkipped} skipped, ${stats.imagesFailed} failed`);
}

/**
 * Upload metadata files (JSON and NPY)
 */
async function uploadMetadata(
  sourceDir: string,
  bucket: string,
  stats: IngestStats
): Promise<void> {
  const metadataDir = path.join(sourceDir, 'metadata');
  const jsonFiles = getFiles(metadataDir, ['.json']);
  const npyFiles = getFiles(metadataDir, ['.npy']);
  
  log(`\nUploading ${jsonFiles.length} JSON + ${npyFiles.length} NPY files...`);
  
  // Upload JSON files
  await processInParallel(jsonFiles, async (filePath) => {
    const filename = path.basename(filePath);
    const key = `metadata/${filename}`;
    
    if (config.dryRun) {
      log(`  [DRY RUN] Would upload: ${key}`, true);
      stats.metadataSkipped++;
      return;
    }
    
    const result = await uploadToS3(filePath, bucket, key, 'application/json');
    
    if (result.success) {
      stats.metadataUploaded++;
    } else {
      error(`Failed to upload ${filename}: ${result.error}`);
      stats.metadataFailed++;
    }
  }, config.concurrency);
  
  // Upload NPY files
  await processInParallel(npyFiles, async (filePath) => {
    const filename = path.basename(filePath);
    const key = `embeddings/${filename}`;
    
    if (config.dryRun) {
      log(`  [DRY RUN] Would upload: ${key}`, true);
      stats.metadataSkipped++;
      return;
    }
    
    const result = await uploadToS3(filePath, bucket, key);
    
    if (result.success) {
      stats.metadataUploaded++;
    } else {
      error(`Failed to upload ${filename}: ${result.error}`);
      stats.metadataFailed++;
    }
  }, config.concurrency);
  
  success(`Metadata: ${stats.metadataUploaded} uploaded, ${stats.metadataSkipped} skipped, ${stats.metadataFailed} failed`);
}

/**
 * Populate DynamoDB with image records
 */
async function populateDatabase(
  sourceDir: string,
  tableName: string,
  bucketName: string,
  stats: IngestStats
): Promise<void> {
  const metadataDir = path.join(sourceDir, 'metadata');
  const jsonFiles = getFiles(metadataDir, ['.json']);
  
  log(`\nPopulating DynamoDB with ${jsonFiles.length} records...`);
  
  // Process in batches of 25 (DynamoDB limit)
  const batchSize = 25;
  
  for (let i = 0; i < jsonFiles.length; i += batchSize) {
    const batch = jsonFiles.slice(i, i + batchSize);
    const putRequests: Array<{ PutRequest: { Item: Record<string, unknown> } }> = [];
    
    for (const jsonPath of batch) {
      const metadata = readMetadata(jsonPath);
      if (!metadata) {
        stats.dbRecordsFailed++;
        continue;
      }
      
      const baseName = getBaseName(jsonPath);
      const imageExt = findImageExtension(sourceDir, baseName);
      
      if (!imageExt) {
        warn(`No image found for metadata: ${baseName}`);
        stats.dbRecordsFailed++;
        continue;
      }
      
      const imageFilename = `${baseName}${imageExt}`;
      
      // Build S3 URLs
      const baseUrl = `https://${bucketName}.s3.${config.region}.amazonaws.com`;
      
      const record = {
        id: metadata.id || baseName,
        filename: metadata.filename || imageFilename,
        urlSmall: `${baseUrl}/images/small/${imageFilename}`,
        urlMedium: `${baseUrl}/images/medium/${imageFilename}`,
        urlFull: `${baseUrl}/images/full/${imageFilename}`,
        description: metadata.description,
        mood: metadata.mood,
        mainSubject: metadata.main_subject,
        tags: JSON.stringify(metadata.tags),
        mainColors: JSON.stringify(metadata.main_colors),
        exif: metadata.exif ? JSON.stringify(metadata.exif) : undefined,
        dominantColorHex: getDominantColorHex(metadata.main_colors),
        dateTaken: metadata.exif?.DateTimeOriginal as string | undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Owner field for authorization (use 'system' for batch imports)
        owner: 'system',
      };
      
      if (config.dryRun) {
        log(`  [DRY RUN] Would create: ${record.id}`, true);
        stats.dbRecordsCreated++;
        continue;
      }
      
      putRequests.push({
        PutRequest: { Item: record }
      });
    }
    
    if (putRequests.length > 0 && !config.dryRun) {
      try {
        await dynamoClient.send(new BatchWriteCommand({
          RequestItems: {
            [tableName]: putRequests
          }
        }));
        stats.dbRecordsCreated += putRequests.length;
      } catch (err) {
        error(`Batch write failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        stats.dbRecordsFailed += putRequests.length;
      }
    }
    
    if ((i + batchSize) % 500 === 0) {
      log(`  Progress: ${Math.min(i + batchSize, jsonFiles.length)}/${jsonFiles.length}`);
    }
  }
  
  success(`Database: ${stats.dbRecordsCreated} created, ${stats.dbRecordsFailed} failed`);
}

/**
 * Find the image extension for a given base name
 */
function findImageExtension(sourceDir: string, baseName: string): string | null {
  const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const smallDir = path.join(sourceDir, 'small');
  
  for (const ext of extensions) {
    if (fs.existsSync(path.join(smallDir, `${baseName}${ext}`))) {
      return ext;
    }
    // Try uppercase extension
    if (fs.existsSync(path.join(smallDir, `${baseName}${ext.toUpperCase()}`))) {
      return ext.toUpperCase();
    }
  }
  
  return null;
}

/**
 * Get dominant color hex from main_colors object
 */
function getDominantColorHex(mainColors: Record<string, string>): string | undefined {
  const entries = Object.entries(mainColors);
  if (entries.length === 0) return undefined;
  return entries[0][1]; // Return first color's hex value
}

// ============================================================================
// MAIN
// ============================================================================

let config: Config;

async function main() {
  const startTime = Date.now();
  
  // Parse command line arguments
  const { values } = parseArgs({
    options: {
      source: { type: 'string', short: 's' },
      bucket: { type: 'string', short: 'b' },
      table: { type: 'string', short: 't' },
      region: { type: 'string', short: 'r' },
      'dry-run': { type: 'boolean' },
      'skip-images': { type: 'boolean' },
      'skip-metadata': { type: 'boolean' },
      'skip-database': { type: 'boolean' },
      concurrency: { type: 'string', short: 'c' },
      verbose: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  
  if (values.help) {
    console.log(`
Ingest Images Script

Uploads images and metadata from local processed_gallery/ structure to S3
and populates DynamoDB with image records.

Usage:
  npx ts-node scripts/ingest-images.ts --source ./processed_gallery [options]

Options:
  -s, --source <path>     Source directory (required)
  -b, --bucket <name>     S3 bucket name (or S3_BUCKET_NAME env var)
  -t, --table <name>      DynamoDB table name (or DYNAMODB_TABLE_NAME env var)
  -r, --region <region>   AWS region (default: us-east-1)
  --dry-run               Show what would be done without making changes
  --skip-images           Skip uploading images
  --skip-metadata         Skip uploading metadata files
  --skip-database         Skip populating DynamoDB
  -c, --concurrency <n>   Parallel uploads (default: 10)
  -v, --verbose           Verbose output
  -h, --help              Show this help
    `);
    process.exit(0);
  }
  
  // Build config
  config = {
    sourcePath: values.source || '',
    bucketName: values.bucket || DEFAULT_CONFIG.bucketName || '',
    tableName: values.table || DEFAULT_CONFIG.tableName || '',
    region: values.region || DEFAULT_CONFIG.region || 'us-east-1',
    dryRun: values['dry-run'] || false,
    skipImages: values['skip-images'] || false,
    skipMetadata: values['skip-metadata'] || false,
    skipDatabase: values['skip-database'] || false,
    concurrency: parseInt(values.concurrency || '10', 10),
    verbose: values.verbose || false,
  };
  
  // Validate
  if (!config.sourcePath) {
    error('Source path is required. Use --source <path>');
    process.exit(1);
  }
  
  if (!fs.existsSync(config.sourcePath)) {
    error(`Source path does not exist: ${config.sourcePath}`);
    process.exit(1);
  }
  
  if (!config.bucketName && !config.dryRun) {
    error('S3 bucket name is required. Use --bucket <name> or set S3_BUCKET_NAME env var');
    process.exit(1);
  }
  
  if (!config.tableName && !config.skipDatabase && !config.dryRun) {
    error('DynamoDB table name is required. Use --table <name> or set DYNAMODB_TABLE_NAME env var');
    process.exit(1);
  }
  
  // Initialize
  console.log('\n🚀 PixNdx Gallery Image Ingestion\n');
  console.log(`Source:      ${config.sourcePath}`);
  console.log(`Bucket:      ${config.bucketName || '(dry run)'}`);
  console.log(`Table:       ${config.tableName || '(skipped)'}`);
  console.log(`Region:      ${config.region}`);
  console.log(`Dry Run:     ${config.dryRun}`);
  console.log(`Concurrency: ${config.concurrency}`);
  
  if (!config.dryRun) {
    initClients(config.region);
  }
  
  const stats: IngestStats = {
    imagesUploaded: 0,
    imagesSkipped: 0,
    imagesFailed: 0,
    metadataUploaded: 0,
    metadataSkipped: 0,
    metadataFailed: 0,
    dbRecordsCreated: 0,
    dbRecordsFailed: 0,
    totalTime: 0,
  };
  
  // Upload images
  if (!config.skipImages) {
    for (const size of ['small', 'medium', 'full'] as const) {
      await uploadImages(config.sourcePath, config.bucketName, size, stats);
    }
  }
  
  // Upload metadata
  if (!config.skipMetadata) {
    await uploadMetadata(config.sourcePath, config.bucketName, stats);
  }
  
  // Populate database
  if (!config.skipDatabase) {
    await populateDatabase(config.sourcePath, config.tableName, config.bucketName, stats);
  }
  
  // Summary
  stats.totalTime = (Date.now() - startTime) / 1000;
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary');
  console.log('='.repeat(50));
  console.log(`Images:   ${stats.imagesUploaded} uploaded, ${stats.imagesSkipped} skipped, ${stats.imagesFailed} failed`);
  console.log(`Metadata: ${stats.metadataUploaded} uploaded, ${stats.metadataSkipped} skipped, ${stats.metadataFailed} failed`);
  console.log(`Database: ${stats.dbRecordsCreated} created, ${stats.dbRecordsFailed} failed`);
  console.log(`Time:     ${stats.totalTime.toFixed(1)}s`);
  console.log('='.repeat(50) + '\n');
  
  if (stats.imagesFailed > 0 || stats.metadataFailed > 0 || stats.dbRecordsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
