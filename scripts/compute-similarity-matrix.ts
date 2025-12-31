#!/usr/bin/env npx ts-node

/**
 * Compute Similarity Matrix Script
 * 
 * Pre-computes pairwise similarity scores between all images using their
 * CLIP embeddings (.npy files). Outputs edges above threshold to JSON files
 * for fast graph rendering in the app.
 * 
 * For 2500 images, this computes ~3.1M pairs but only stores edges above threshold.
 * 
 * Usage:
 *   npx ts-node scripts/compute-similarity-matrix.ts --source ./processed_gallery/metadata
 *   npx ts-node scripts/compute-similarity-matrix.ts --source ./metadata --threshold 0.7
 *   npx ts-node scripts/compute-similarity-matrix.ts --source ./metadata --output ./edges.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface Config {
  sourcePath: string;
  outputPath: string;
  threshold: number;
  maxEdgesPerNode: number;
  chunkSize: number;
  includeMetadataSimilarity: boolean;
  verbose: boolean;
}

// ============================================================================
// NPY PARSER
// ============================================================================

/**
 * Parse a .npy file containing a float32 vector
 * NPY format: https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html
 */
function parseNpy(buffer: Buffer): Float32Array {
  // Magic number: \x93NUMPY
  const magic = buffer.slice(0, 6).toString();
  if (!magic.startsWith('\x93NUMPY')) {
    throw new Error('Invalid NPY file: missing magic number');
  }
  
  // Version
  const majorVersion = buffer[6];
  const minorVersion = buffer[7];
  
  // Header length
  let headerLength: number;
  let headerOffset: number;
  
  if (majorVersion === 1) {
    headerLength = buffer.readUInt16LE(8);
    headerOffset = 10;
  } else if (majorVersion === 2 || majorVersion === 3) {
    headerLength = buffer.readUInt32LE(8);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported NPY version: ${majorVersion}.${minorVersion}`);
  }
  
  // Parse header (Python dict as string)
  const headerStr = buffer.slice(headerOffset, headerOffset + headerLength).toString();
  
  // Extract dtype and shape from header
  const dtypeMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  
  if (!dtypeMatch) {
    throw new Error('Could not parse dtype from NPY header');
  }
  
  const dtype = dtypeMatch[1];
  const shape = shapeMatch ? shapeMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [];
  
  // Data starts after header
  const dataOffset = headerOffset + headerLength;
  const dataBuffer = buffer.slice(dataOffset);
  
  // Parse based on dtype
  if (dtype === '<f4' || dtype === 'float32') {
    const length = dataBuffer.length / 4;
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = dataBuffer.readFloatLE(i * 4);
    }
    return result;
  } else if (dtype === '<f8' || dtype === 'float64') {
    const length = dataBuffer.length / 8;
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = dataBuffer.readDoubleLE(i * 8);
    }
    return result;
  } else {
    throw new Error(`Unsupported dtype: ${dtype}`);
  }
}

/**
 * Load embedding from .npy file
 */
function loadEmbedding(npyPath: string): Float32Array | null {
  try {
    const buffer = fs.readFileSync(npyPath);
    return parseNpy(buffer);
  } catch (err) {
    console.error(`Failed to load ${npyPath}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ============================================================================
// SIMILARITY COMPUTATION
// ============================================================================

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

/**
 * Normalize similarity score to 0-1 range
 * CLIP similarities typically range from -1 to 1, with most positive pairs 0.2-0.8
 */
function normalizeSimilarity(score: number): number {
  // Shift and scale: [-1, 1] -> [0, 1]
  // Then apply a slight curve to spread out the middle range
  const normalized = (score + 1) / 2;
  return Math.pow(normalized, 0.8); // Slight curve to spread distribution
}

// ============================================================================
// METADATA SIMILARITY
// ============================================================================

interface ImageMetadata {
  id: string;
  filename: string;
  description: string;
  mood: string;
  main_subject: string;
  tags: Record<string, string[]>;
  main_colors: Record<string, string>;
}

/**
 * Load JSON metadata
 */
function loadMetadata(jsonPath: string): ImageMetadata | null {
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Compute metadata-based similarity (tags, mood, colors)
 */
function metadataSimilarity(meta1: ImageMetadata, meta2: ImageMetadata): number {
  let score = 0;
  let weights = 0;
  
  // Tag similarity (Jaccard)
  const tags1 = new Set(Object.values(meta1.tags).flat().map(t => t.toLowerCase()));
  const tags2 = new Set(Object.values(meta2.tags).flat().map(t => t.toLowerCase()));
  
  if (tags1.size > 0 && tags2.size > 0) {
    const intersection = new Set([...tags1].filter(t => tags2.has(t)));
    const union = new Set([...tags1, ...tags2]);
    score += (intersection.size / union.size) * 0.4;
    weights += 0.4;
  }
  
  // Mood similarity
  const mood1 = meta1.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const mood2 = meta2.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  
  if (mood1.length > 0 && mood2.length > 0) {
    const moodSet1 = new Set(mood1);
    const moodSet2 = new Set(mood2);
    const moodIntersection = new Set([...moodSet1].filter(m => moodSet2.has(m)));
    const moodUnion = new Set([...moodSet1, ...moodSet2]);
    score += (moodIntersection.size / moodUnion.size) * 0.3;
    weights += 0.3;
  }
  
  // Color similarity
  const colors1 = Object.values(meta1.main_colors);
  const colors2 = Object.values(meta2.main_colors);
  
  if (colors1.length > 0 && colors2.length > 0) {
    // Simple: check if dominant colors are similar
    const colorScore = colorSimilarity(colors1[0], colors2[0]);
    score += colorScore * 0.3;
    weights += 0.3;
  }
  
  return weights > 0 ? score / weights : 0;
}

/**
 * Simple color similarity based on hex values
 */
function colorSimilarity(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  
  if (!rgb1 || !rgb2) return 0;
  
  const dr = (rgb1.r - rgb2.r) / 255;
  const dg = (rgb1.g - rgb2.g) / 255;
  const db = (rgb1.b - rgb2.b) / 255;
  
  const distance = Math.sqrt(dr * dr + dg * dg + db * db);
  const maxDistance = Math.sqrt(3); // Max possible distance
  
  return 1 - (distance / maxDistance);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

// ============================================================================
// EDGE TYPES
// ============================================================================

interface SimilarityEdge {
  source: string;
  target: string;
  weight: number;
  clipScore: number;
  metadataScore?: number;
}

interface EdgeFile {
  version: string;
  generatedAt: string;
  threshold: number;
  totalImages: number;
  totalEdges: number;
  edges: SimilarityEdge[];
}

// ============================================================================
// MAIN COMPUTATION
// ============================================================================

async function computeSimilarityMatrix(config: Config): Promise<void> {
  const startTime = Date.now();
  
  console.log('\n🔬 Computing Similarity Matrix\n');
  console.log(`Source:    ${config.sourcePath}`);
  console.log(`Output:    ${config.outputPath}`);
  console.log(`Threshold: ${config.threshold}`);
  console.log(`Max edges/node: ${config.maxEdgesPerNode}`);
  console.log(`Include metadata: ${config.includeMetadataSimilarity}`);
  
  // Find all .npy files
  const npyFiles = fs.readdirSync(config.sourcePath)
    .filter(f => f.endsWith('.npy'))
    .map(f => path.join(config.sourcePath, f));
  
  console.log(`\nFound ${npyFiles.length} embedding files`);
  
  if (npyFiles.length === 0) {
    console.error('❌ No .npy files found');
    process.exit(1);
  }
  
  // Load all embeddings
  console.log('\nLoading embeddings...');
  const embeddings: Map<string, Float32Array> = new Map();
  const metadata: Map<string, ImageMetadata> = new Map();
  
  let loaded = 0;
  for (const npyPath of npyFiles) {
    const baseName = path.basename(npyPath, '.npy');
    const embedding = loadEmbedding(npyPath);
    
    if (embedding) {
      embeddings.set(baseName, embedding);
      
      // Load corresponding metadata if requested
      if (config.includeMetadataSimilarity) {
        const jsonPath = path.join(config.sourcePath, `${baseName}.json`);
        const meta = loadMetadata(jsonPath);
        if (meta) {
          metadata.set(baseName, meta);
        }
      }
      
      loaded++;
      if (loaded % 500 === 0) {
        console.log(`  Loaded ${loaded}/${npyFiles.length}`);
      }
    }
  }
  
  console.log(`✅ Loaded ${embeddings.size} embeddings`);
  if (config.includeMetadataSimilarity) {
    console.log(`✅ Loaded ${metadata.size} metadata files`);
  }
  
  // Compute pairwise similarities
  const imageIds = Array.from(embeddings.keys());
  const n = imageIds.length;
  const totalPairs = (n * (n - 1)) / 2;
  
  console.log(`\nComputing ${totalPairs.toLocaleString()} pairwise similarities...`);
  
  const edges: SimilarityEdge[] = [];
  const edgesPerNode: Map<string, number> = new Map();
  
  let computed = 0;
  let aboveThreshold = 0;
  const progressInterval = Math.max(1, Math.floor(totalPairs / 20));
  
  for (let i = 0; i < n; i++) {
    const id1 = imageIds[i];
    const emb1 = embeddings.get(id1)!;
    const meta1 = metadata.get(id1);
    
    for (let j = i + 1; j < n; j++) {
      const id2 = imageIds[j];
      const emb2 = embeddings.get(id2)!;
      const meta2 = metadata.get(id2);
      
      // Compute CLIP similarity
      const clipScore = normalizeSimilarity(cosineSimilarity(emb1, emb2));
      
      // Optionally combine with metadata similarity
      let finalScore = clipScore;
      let metadataScore: number | undefined;
      
      if (config.includeMetadataSimilarity && meta1 && meta2) {
        metadataScore = metadataSimilarity(meta1, meta2);
        // Weighted combination: 70% CLIP, 30% metadata
        finalScore = clipScore * 0.7 + metadataScore * 0.3;
      }
      
      computed++;
      
      // Check threshold
      if (finalScore >= config.threshold) {
        // Check max edges per node
        const count1 = edgesPerNode.get(id1) || 0;
        const count2 = edgesPerNode.get(id2) || 0;
        
        if (count1 < config.maxEdgesPerNode && count2 < config.maxEdgesPerNode) {
          edges.push({
            source: id1,
            target: id2,
            weight: finalScore,
            clipScore,
            metadataScore,
          });
          
          edgesPerNode.set(id1, count1 + 1);
          edgesPerNode.set(id2, count2 + 1);
          aboveThreshold++;
        }
      }
      
      // Progress
      if (computed % progressInterval === 0) {
        const percent = ((computed / totalPairs) * 100).toFixed(1);
        process.stdout.write(`\r  Progress: ${percent}% (${aboveThreshold.toLocaleString()} edges found)`);
      }
    }
  }
  
  console.log(`\n✅ Found ${edges.length.toLocaleString()} edges above threshold ${config.threshold}`);
  
  // Sort edges by weight descending
  edges.sort((a, b) => b.weight - a.weight);
  
  // Compute statistics
  const weights = edges.map(e => e.weight);
  const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  
  console.log(`\nEdge Statistics:`);
  console.log(`  Average weight: ${avgWeight.toFixed(4)}`);
  console.log(`  Min weight: ${minWeight.toFixed(4)}`);
  console.log(`  Max weight: ${maxWeight.toFixed(4)}`);
  
  // Write output
  const output: EdgeFile = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    threshold: config.threshold,
    totalImages: n,
    totalEdges: edges.length,
    edges,
  };
  
  // Check if output should be chunked
  const outputSizeEstimate = JSON.stringify(output).length;
  const maxFileSize = 5 * 1024 * 1024; // 5MB
  
  if (outputSizeEstimate > maxFileSize) {
    // Write chunked output
    const chunksNeeded = Math.ceil(outputSizeEstimate / maxFileSize);
    const edgesPerChunk = Math.ceil(edges.length / chunksNeeded);
    
    console.log(`\nWriting ${chunksNeeded} chunked files...`);
    
    const outputDir = path.dirname(config.outputPath);
    const outputBase = path.basename(config.outputPath, '.json');
    
    for (let i = 0; i < chunksNeeded; i++) {
      const chunkEdges = edges.slice(i * edgesPerChunk, (i + 1) * edgesPerChunk);
      const chunkOutput: EdgeFile = {
        ...output,
        edges: chunkEdges,
        totalEdges: chunkEdges.length,
      };
      
      const chunkPath = path.join(outputDir, `${outputBase}_${i + 1}.json`);
      fs.writeFileSync(chunkPath, JSON.stringify(chunkOutput, null, 2));
      console.log(`  Written: ${chunkPath} (${chunkEdges.length} edges)`);
    }
    
    // Write index file
    const indexPath = path.join(outputDir, `${outputBase}_index.json`);
    fs.writeFileSync(indexPath, JSON.stringify({
      version: '1.0',
      generatedAt: output.generatedAt,
      threshold: config.threshold,
      totalImages: n,
      totalEdges: edges.length,
      chunks: chunksNeeded,
      chunkPattern: `${outputBase}_{{n}}.json`,
    }, null, 2));
    console.log(`  Written: ${indexPath}`);
  } else {
    // Write single file
    fs.writeFileSync(config.outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✅ Written: ${config.outputPath}`);
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  Total time: ${elapsed}s`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      threshold: { type: 'string', short: 't' },
      'max-edges': { type: 'string', short: 'm' },
      'include-metadata': { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  
  if (values.help) {
    console.log(`
Compute Similarity Matrix Script

Pre-computes pairwise similarity scores between all images using their
CLIP embeddings. Outputs edges above threshold to JSON files.

Usage:
  npx ts-node scripts/compute-similarity-matrix.ts --source ./metadata [options]

Options:
  -s, --source <path>      Source directory with .npy files (required)
  -o, --output <path>      Output JSON file (default: ./similarity-edges.json)
  -t, --threshold <n>      Similarity threshold 0-1 (default: 0.5)
  -m, --max-edges <n>      Max edges per node (default: 50)
  --include-metadata       Include metadata similarity in score
  -v, --verbose            Verbose output
  -h, --help               Show this help
    `);
    process.exit(0);
  }
  
  if (!values.source) {
    console.error('❌ Source path is required. Use --source <path>');
    process.exit(1);
  }
  
  if (!fs.existsSync(values.source)) {
    console.error(`❌ Source path does not exist: ${values.source}`);
    process.exit(1);
  }
  
  const config: Config = {
    sourcePath: values.source,
    outputPath: values.output || './similarity-edges.json',
    threshold: parseFloat(values.threshold || '0.5'),
    maxEdgesPerNode: parseInt(values['max-edges'] || '50', 10),
    chunkSize: 10000,
    includeMetadataSimilarity: values['include-metadata'] || false,
    verbose: values.verbose || false,
  };
  
  // Ensure output directory exists
  const outputDir = path.dirname(config.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  await computeSimilarityMatrix(config);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
