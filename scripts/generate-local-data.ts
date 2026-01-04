#!/usr/bin/env npx ts-node

/**
 * Generate Local Data Script
 * 
 * Reads your processed_gallery metadata and generates a TypeScript file
 * that can be imported directly for local development.
 * 
 * Includes:
 * - CLIP neighbors for edge computation
 * - UMAP layout positions (if layout.json exists)
 * - Cluster/community assignments (if layout.json exists)
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
  clipWeight: number;
  compositeWeight: number;
  // Legacy field for backwards compatibility
  weight?: number;
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
    hasComposite?: boolean;
  };
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  cluster: number;
  community: number;
  cluster_probability: number;
}

interface LayoutData {
  version: string;
  algorithm: {
    layout: string;
    clustering: string;
  };
  stats: {
    total_images: number;
    n_clusters: number;
    n_communities: number;
  };
  clusters: Record<string, { name: string; count: number; common_tags?: string[] }>;
  communities: Record<string, { name: string; count: number; common_tags?: string[] }>;
  nodes: LayoutNode[];
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
  // Layout data (from UMAP)
  layoutPosition?: { x: number; y: number };
  cluster?: number;
  community?: number;
  clusterProbability?: number;
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
  1. Run preprocessing/compute_neighbors.py to compute CLIP neighbors
  2. Run preprocessing/cluster_layout.py --cluster to compute UMAP + clusters (optional)
  3. Run this script to generate frontend data
  4. Start image server: npx serve ./gallery_processed -p 8080 --cors
  5. Start app: npm run dev
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
  const layoutPath = path.join(metaDir, 'layout.json');

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

  // Load layout data if available
  let layoutData: LayoutData | null = null;
  let layoutMap: Map<string, LayoutNode> = new Map();
  let clusterInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = {};
  let communityInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = {};
  
  if (fs.existsSync(layoutPath)) {
    try {
      layoutData = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
      if (layoutData && layoutData.nodes) {
        for (const node of layoutData.nodes) {
          layoutMap.set(node.id, node);
        }
        clusterInfo = layoutData.clusters || {};
        communityInfo = layoutData.communities || {};
        console.log(`\n🧭 Layout data found:`);
        console.log(`   Algorithm:   ${layoutData.algorithm?.layout} + ${layoutData.algorithm?.clustering}`);
        console.log(`   Clusters:    ${layoutData.stats?.n_clusters}`);
        console.log(`   Communities: ${layoutData.stats?.n_communities}`);
      }
    } catch (err) {
      console.warn(`   ⚠️  Could not parse layout.json: ${err}`);
    }
  } else {
    console.log(`\n💡 No layout.json found. Run cluster_layout.py for UMAP positions & clusters.`);
  }

  // Find all JSON metadata files (exclude layout.json and edges*.json)
  const jsonFiles = fs.readdirSync(metaDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('layout') && !f.startsWith('edges') && !f.startsWith('clusters'))
    .slice(0, limit);

  console.log(`\n📄 Found ${jsonFiles.length} metadata files`);

  const images: OutputImage[] = [];
  let withNeighbors = 0;
  let withoutNeighbors = 0;
  let totalNeighbors = 0;
  let withLayout = 0;

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

      // Include clipNeighbors if present (normalize format)
      if (meta.clipNeighbors && meta.clipNeighbors.length > 0) {
        // Normalize to new format with both weights
        outputImage.clipNeighbors = meta.clipNeighbors.map(n => {
          // Handle both new format (clipWeight/compositeWeight) and legacy (weight)
          if ('clipWeight' in n && 'compositeWeight' in n) {
            return { id: n.id, clipWeight: n.clipWeight, compositeWeight: n.compositeWeight };
          }
          // Legacy format: use weight for both
          const w = (n as any).weight ?? 0;
          return { id: n.id, clipWeight: w, compositeWeight: w };
        });
        withNeighbors++;
        totalNeighbors += meta.clipNeighbors.length;
      } else {
        withoutNeighbors++;
      }

      // Include layout data if available
      const layoutNode = layoutMap.get(outputImage.id);
      if (layoutNode) {
        outputImage.layoutPosition = { x: layoutNode.x, y: layoutNode.y };
        outputImage.cluster = layoutNode.cluster;
        outputImage.community = layoutNode.community;
        outputImage.clusterProbability = layoutNode.cluster_probability;
        withLayout++;
      }

      images.push(outputImage);
    } catch (err) {
      console.error(`   ❌ Error reading ${jsonFile}:`, err);
    }
  }

  console.log(`\n✅ Loaded ${images.length} images`);
  console.log(`   With CLIP neighbors:    ${withNeighbors}`);
  console.log(`   Without CLIP neighbors: ${withoutNeighbors}`);
  console.log(`   With layout data:       ${withLayout}`);
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
// With layout data: ${withLayout}
// =============================================================================

import type { ImageMetadata } from '@/types/gallery';

/**
 * Local image data for development.
 * 
 * Each image includes:
 * - Core metadata (tags, mood, colors, description)
 * - clipNeighbors: Precomputed similar images (for CLIP-based edges)
 * - layoutPosition: UMAP 2D coordinates (if computed)
 * - cluster: HDBSCAN cluster assignment (if computed)
 * - community: Louvain community assignment (if computed)
 */
export const localImages: ImageMetadata[] = ${JSON.stringify(images, null, 2)};

/**
 * Cluster metadata from HDBSCAN (if computed)
 */
export const clusterInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = ${JSON.stringify(clusterInfo, null, 2)};

/**
 * Community metadata from Louvain (if computed)
 */
export const communityInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = ${JSON.stringify(communityInfo, null, 2)};

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
