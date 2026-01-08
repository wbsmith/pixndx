#!/usr/bin/env npx tsx
/**
 * Sync image metadata from local JSON files to DynamoDB
 * 
 * This script reads your processed metadata JSON files and upserts them
 * into the DynamoDB table created by Amplify.
 * 
 * Prerequisites:
 *   - AWS credentials configured (aws configure)
 *   - Amplify deployment completed
 *   - amplify_outputs.json generated
 * 
 * Usage:
 *   npx tsx scripts/sync-metadata-to-dynamodb.ts --source /path/to/metadata
 * 
 * Options:
 *   --source     Path to metadata directory (required)
 *   --dry-run    Show what would be uploaded without uploading
 *   --limit      Limit number of items to sync (for testing)
 */

import * as fs from 'fs';
import * as path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const sourceDir = getArg('source');
const dryRun = hasFlag('dry-run');
const limit = getArg('limit') ? parseInt(getArg('limit')!) : undefined;

if (!sourceDir) {
  console.error('Usage: npx tsx scripts/sync-metadata-to-dynamodb.ts --source /path/to/metadata');
  console.error('');
  console.error('Options:');
  console.error('  --source     Path to metadata directory (required)');
  console.error('  --dry-run    Show what would be uploaded without uploading');
  console.error('  --limit N    Limit to N items (for testing)');
  process.exit(1);
}

// Load Amplify outputs to get table name
let tableName: string;
try {
  const outputs = JSON.parse(fs.readFileSync('amplify_outputs.json', 'utf-8'));
  // The table name is typically in the data section
  // For Amplify Gen 2, we need to construct it or get it from the API
  tableName = outputs.data?.tables?.Image || `Image-${outputs.data?.api_id || 'unknown'}`;
  console.log(`📦 Table name from amplify_outputs: ${tableName}`);
} catch (e) {
  console.error('❌ Could not read amplify_outputs.json');
  console.error('   Make sure you have run: npx ampx generate outputs');
  console.error('');
  console.error('   Or specify table name manually with --table');
  
  const manualTable = getArg('table');
  if (manualTable) {
    tableName = manualTable;
  } else {
    process.exit(1);
  }
}

// Override with manual table name if provided
const manualTable = getArg('table');
if (manualTable) {
  tableName = manualTable;
}

console.log('');
console.log('🔄 PixGraf Metadata Sync to DynamoDB');
console.log('=====================================');
console.log(`Source:    ${sourceDir}`);
console.log(`Table:     ${tableName}`);
console.log(`Dry run:   ${dryRun}`);
console.log(`Limit:     ${limit || 'none'}`);
console.log('=====================================');
console.log('');

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Read metadata files
const metadataFiles = fs.readdirSync(sourceDir)
  .filter(f => f.endsWith('.json') && !f.startsWith('edges'))
  .slice(0, limit);

console.log(`📄 Found ${metadataFiles.length} metadata files`);
console.log('');

interface ImageMetadata {
  id: string;
  filename: string;
  main_subject?: string;
  tags?: string[];
  mood?: string;
  dominant_colors?: { name: string; hex: string }[];
  camera?: { make?: string; model?: string; lens?: string };
  exposure?: { aperture?: string; shutter_speed?: string; iso?: number; focal_length?: string };
  dimensions?: { width: number; height: number };
  file_size?: number;
  created_at?: string;
  urls?: { small: string; medium: string; full: string };
  clipNeighbors?: { targetId: string; clipWeight: number; compositeWeight: number }[];
  layoutPosition?: { x: number; y: number };
  cluster?: number;
  community?: number;
}

// Transform local metadata to DynamoDB schema
function transformMetadata(meta: ImageMetadata, bucketUrl: string): Record<string, any> {
  return {
    id: meta.id,
    filename: meta.filename,
    mainSubject: meta.main_subject || '',
    tags: meta.tags || [],
    mood: meta.mood || '',
    dominantColors: meta.dominant_colors || [],
    camera: meta.camera || {},
    exposure: meta.exposure || {},
    dimensions: meta.dimensions || { width: 0, height: 0 },
    fileSize: meta.file_size || 0,
    createdAt: meta.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    
    // URLs - construct from bucket
    urls: {
      small: `${bucketUrl}/images/small/${meta.filename}`,
      medium: `${bucketUrl}/images/medium/${meta.filename}`,
      full: `${bucketUrl}/images/full/${meta.filename}`,
    },
    
    // Graph data
    clipNeighbors: meta.clipNeighbors || [],
    layoutPosition: meta.layoutPosition || null,
    cluster: meta.cluster ?? null,
    community: meta.community ?? null,
    
    // Amplify fields
    __typename: 'Image',
  };
}

async function syncMetadata() {
  const bucketUrl = getArg('bucket-url') || 'https://YOUR_BUCKET.s3.amazonaws.com';
  
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  
  // Process in batches of 25 (DynamoDB limit)
  const batchSize = 25;
  
  for (let i = 0; i < metadataFiles.length; i += batchSize) {
    const batch = metadataFiles.slice(i, i + batchSize);
    const items: Record<string, any>[] = [];
    
    for (const file of batch) {
      try {
        const filePath = path.join(sourceDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const metadata: ImageMetadata = JSON.parse(content);
        
        if (!metadata.id) {
          metadata.id = path.basename(file, '.json');
        }
        
        const item = transformMetadata(metadata, bucketUrl);
        items.push(item);
        
      } catch (e: any) {
        errors.push(`${file}: ${e.message}`);
        errorCount++;
      }
    }
    
    if (dryRun) {
      console.log(`[DRY RUN] Would sync ${items.length} items`);
      items.forEach(item => console.log(`  - ${item.id}: ${item.mainSubject}`));
      successCount += items.length;
    } else if (items.length > 0) {
      try {
        // Use BatchWrite for efficiency
        const putRequests = items.map(item => ({
          PutRequest: { Item: item }
        }));
        
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            [tableName]: putRequests
          }
        }));
        
        successCount += items.length;
        process.stdout.write(`\r✅ Synced ${successCount}/${metadataFiles.length} items`);
        
      } catch (e: any) {
        // Fall back to individual puts
        for (const item of items) {
          try {
            await docClient.send(new PutCommand({
              TableName: tableName,
              Item: item
            }));
            successCount++;
          } catch (putError: any) {
            errors.push(`${item.id}: ${putError.message}`);
            errorCount++;
          }
        }
      }
    }
  }
  
  console.log('\n');
  console.log('=====================================');
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Errors:  ${errorCount}`);
  
  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }
  
  console.log('=====================================');
}

syncMetadata().catch(console.error);

