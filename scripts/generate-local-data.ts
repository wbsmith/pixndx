#!/usr/bin/env npx ts-node

/**
 * Generate Local Data Script
 * 
 * Reads your processed_gallery metadata and generates a TypeScript file
 * that can be imported directly for local development.
 * 
 * Edges are NOT precomputed here - instead, we include clipNeighbors per image
 * which allows runtime edge computation with adjustable threshold/limits.
 * 
 * Usage:
 *   npx tsx scripts/generate-local-data.ts --source ./gallery_processed
 *   npx tsx scripts/generate-local-data.ts -s ./gallery_processed -u http://localhost:8080
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';

// =============================================================================
// TYPES
// =============================================================================

interface ClipNeighbor {
  id: string;
  weight: number;
}

interface RawMetadata {
  id?: string;
  filename?: string;
  description: string;
  mood: string;
  main_subject: string;
  tags: Record<string, string[]>;
  main_colors: Record<string, string>;
  exif?: Record<string, unknown>;
  clipNeighbors?: ClipNeighbor[];
  _neighborsComputed?: {
    threshold: number;
    maxNeighbors: number;
    count: number;
  };
}

interface OutputImage {
  id: string;
  filename: string;
  urls: { small: string; medium: string; full: string };
  description: string;
  mood: string;
  main_subject: string;
  tags: Record<string, string[]>;
  main_colors: Record<string, string>;
  exif: Record<string, unknown>;
  clipNeighbors?: ClipNeighbor[];
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      'image-base-url': { type: 'string', short: 'u' },
      limit: { type: 'string', short: 'l' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
Generate Local Data - Creates src/data/localImages.ts from your processed gallery

Usage:
  npx tsx scripts/generate-local-data.ts -s <source> [options]

Options:
  -s, --source <path>           Source gallery_processed directory (required)
  -o, --output <path>           Output file (default: src/data/localImages.ts)
  -u, --image-base-url <url>    Base URL for images (default: http://localhost:8080)
  -l, --limit <n>               Limit number of images (for testing)
  -h, --help                    Show this help

Examples:
  # Basic usage
  npx tsx scripts/generate-local-data.ts -s /path/to/gallery_processed

  # With custom image server URL
  npx tsx scripts/generate-local-data.ts -s ./gallery_processed -u http://localhost:8080

Workflow:
  1. Run preprocessing/compute_neighbors.py first to compute CLIP neighbors
  2. Run this script to generate frontend data
  3. Start image server: npx serve ./gallery_processed -p 8080 --cors
  4. Start app: npm run dev
`);
    process.exit(0);
  }

  const src = values.source;
  if (!src) {
    console.error('❌ --source is required. Use --help for usage.');
    process.exit(1);
  }

  const baseUrl = values['image-base-url'] || 'http://localhost:8080';
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const output = values.output || 'src/data/localImages.ts';

  const metaDir = path.join(src, 'metadata');
  const smallDir = path.join(src, 'small');

  if (!fs.existsSync(metaDir)) {
    console.error(`❌ Metadata directory not found: ${metaDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(smallDir)) {
    console.error(`❌ Small images directory not found: ${smallDir}`);
    process.exit(1);
  }

  console.log(`\n📸 Generate Local Data`);
  console.log(`   Source:     ${src}`);
  console.log(`   Image URL:  ${baseUrl}`);
  console.log(`   Output:     ${output}`);

  // Find all JSON metadata files
  const jsonFiles = fs.readdirSync(metaDir)
    .filter(f => f.endsWith('.json'))
    .slice(0, limit);

  console.log(`\n📄 Found ${jsonFiles.length} metadata files`);

  const images: OutputImage[] = [];
  let withNeighbors = 0;
  let withoutNeighbors = 0;
  let totalNeighbors = 0;

  for (const jsonFile of jsonFiles) {
    try {
      const jsonPath = path.join(metaDir, jsonFile);
      const meta: RawMetadata = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const base = path.basename(jsonFile, '.json');

      // Find the actual image extension
      const ext = ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG', '.WEBP']
        .find(e => fs.existsSync(path.join(smallDir, base + e)));

      if (!ext) {
        console.warn(`   ⚠️  No image found for ${base}`);
        continue;
      }

      // Build output image
      const outputImage: OutputImage = {
        id: meta.id || base,
        filename: meta.filename || base + ext,
        urls: {
          small: `${baseUrl}/small/${base}${ext}`,
          medium: `${baseUrl}/medium/${base}${ext}`,
          full: `${baseUrl}/full/${base}${ext}`,
        },
        description: meta.description || '',
        mood: meta.mood || '',
        main_subject: meta.main_subject || '',
        tags: meta.tags || {},
        main_colors: meta.main_colors || {},
        exif: meta.exif || {},
      };

      // Include clipNeighbors if present
      if (meta.clipNeighbors && meta.clipNeighbors.length > 0) {
        outputImage.clipNeighbors = meta.clipNeighbors;
        withNeighbors++;
        totalNeighbors += meta.clipNeighbors.length;
      } else {
        withoutNeighbors++;
      }

      images.push(outputImage);
    } catch (err) {
      console.error(`   ❌ Error reading ${jsonFile}:`, err);
    }
  }

  console.log(`\n✅ Loaded ${images.length} images`);
  console.log(`   With CLIP neighbors:    ${withNeighbors}`);
  console.log(`   Without CLIP neighbors: ${withoutNeighbors}`);
  if (withNeighbors > 0) {
    console.log(`   Avg neighbors/image:    ${(totalNeighbors / withNeighbors).toFixed(1)}`);
  }

  if (withoutNeighbors > 0 && withNeighbors === 0) {
    console.log(`\n⚠️  No CLIP neighbors found!`);
    console.log(`   Run: python preprocessing/compute_neighbors.py -g ${src}`);
    console.log(`   Then re-run this script.`);
  }

  // Generate TypeScript output
  const tsContent = `// =============================================================================
// LOCAL IMAGES DATA
// Generated: ${new Date().toISOString()}
// Source: ${src}
// Images: ${images.length}
// With CLIP neighbors: ${withNeighbors}
// =============================================================================

import type { ImageMetadata } from '@/types/gallery';

/**
 * Local image data for development.
 * 
 * Each image includes:
 * - Core metadata (tags, mood, colors, description)
 * - clipNeighbors: Precomputed similar images (for CLIP-based edges)
 * 
 * Edge computation happens at runtime based on user-selected:
 * - Similarity mode (clip, metadata, composite)
 * - Threshold
 * - Max edges per node
 */
export const localImages: ImageMetadata[] = ${JSON.stringify(images, null, 2)};

export default localImages;
`;

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, tsContent);

  const sizeMB = (Buffer.byteLength(tsContent, 'utf8') / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ Written: ${output} (${sizeMB} MB)`);

  console.log(`\n💡 Next steps:`);
  console.log(`   1. Start image server:  npx serve ${src} -p 8080 --cors`);
  console.log(`   2. Start app:           npm run dev`);
}

main().catch(e => {
  console.error(`❌ Error: ${e.message}`);
  process.exit(1);
});
