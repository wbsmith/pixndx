#!/usr/bin/env npx ts-node

/**
 * Generate Local Data Script
 * 
 * Reads your processed_gallery metadata and generates a TypeScript file
 * that can be imported directly for local development.
 * 
 * Also precomputes similarity edges between images so the network graph
 * doesn't need to compute them at runtime.
 * 
 * Usage:
 *   npx ts-node scripts/generate-local-data.ts --source ./processed_gallery
 * 
 * This creates src/data/localImages.ts with your actual image data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';

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

interface ProcessedImage extends ImageMetadata {
  urls: { small: string; medium: string; full: string };
  clipEmbedding?: number[];
}

interface SimilarityEdge {
  source: string;
  target: string;
  weight: number;
}

// ============== NPY Parser ==============
function parseNpy(buffer: Buffer): number[] {
  const magic = buffer.slice(0, 6).toString();
  if (magic !== '\x93NUMPY') throw new Error('Invalid NPY file');
  
  const majorVersion = buffer[6];
  let headerLen: number, headerOffset: number;
  
  if (majorVersion === 1) {
    headerLen = buffer.readUInt16LE(8);
    headerOffset = 10;
  } else if (majorVersion === 2) {
    headerLen = buffer.readUInt32LE(8);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported NPY version: ${majorVersion}`);
  }
  
  const headerStr = buffer.slice(headerOffset, headerOffset + headerLen).toString();
  const dataOffset = headerOffset + headerLen;
  
  const dtypeMatch = headerStr.match(/'descr':\s*'([<>|]?)(\w)(\d+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\((\d+),?\s*\)/);
  
  if (!dtypeMatch || !shapeMatch) throw new Error(`Failed to parse NPY header`);
  
  const [, endian, dtype, bytesStr] = dtypeMatch;
  const bytes = parseInt(bytesStr, 10);
  const shape = parseInt(shapeMatch[1], 10);
  const dataBuffer = buffer.slice(dataOffset);
  const result: number[] = new Array(shape);
  const isLE = endian !== '>';
  
  if (dtype === 'f' && bytes === 4) {
    for (let i = 0; i < shape; i++) result[i] = isLE ? dataBuffer.readFloatLE(i * 4) : dataBuffer.readFloatBE(i * 4);
  } else if (dtype === 'f' && bytes === 8) {
    for (let i = 0; i < shape; i++) result[i] = isLE ? dataBuffer.readDoubleLE(i * 8) : dataBuffer.readDoubleBE(i * 8);
  } else {
    throw new Error(`Unsupported dtype: ${dtype}${bytes}`);
  }
  return result;
}

// ============== Similarity Functions ==============
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null;
}

function paletteSimilarity(c1: string[], c2: string[]): number {
  if (!c1.length || !c2.length) return 0;
  let total = 0;
  for (const h1 of c1) {
    const rgb1 = hexToRgb(h1);
    if (!rgb1) continue;
    let minD = 1;
    for (const h2 of c2) {
      const rgb2 = hexToRgb(h2);
      if (!rgb2) continue;
      const d = Math.sqrt(((rgb1.r-rgb2.r)/255)**2 + ((rgb1.g-rgb2.g)/255)**2 + ((rgb1.b-rgb2.b)/255)**2) / Math.sqrt(3);
      minD = Math.min(minD, d);
    }
    total += minD;
  }
  return 1 - total / c1.length;
}

function metadataSimilarity(a: ProcessedImage, b: ProcessedImage): number {
  const tagSim = jaccardSimilarity(Object.values(a.tags).flat(), Object.values(b.tags).flat());
  const moodSim = jaccardSimilarity(a.mood.split(/[,\s]+/), b.mood.split(/[,\s]+/));
  const colorSim = paletteSimilarity(Object.values(a.main_colors), Object.values(b.main_colors));
  const descSim = jaccardSimilarity(a.description.split(/\W+/).filter(w => w.length > 3), b.description.split(/\W+/).filter(w => w.length > 3));
  return tagSim * 0.4 + moodSim * 0.2 + colorSim * 0.25 + descSim * 0.15;
}

function clipSimilarity(a: ProcessedImage, b: ProcessedImage): number {
  return (a.clipEmbedding && b.clipEmbedding) ? cosineSimilarity(a.clipEmbedding, b.clipEmbedding) : 0;
}

function computeEdges(images: ProcessedImage[], threshold: number, maxPerNode: number, algo: 'clip' | 'metadata'): SimilarityEdge[] {
  console.log(`\n🔗 Computing edges (${algo}, threshold=${threshold})...`);
  const simFn = algo === 'clip' ? clipSimilarity : metadataSimilarity;
  const edges: SimilarityEdge[] = [];
  const counts = new Map<string, number>();
  const total = (images.length * (images.length - 1)) / 2;
  let done = 0, lastPct = 0;

  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      done++;
      const pct = Math.floor((done / total) * 100);
      if (pct >= lastPct + 10) { process.stdout.write(` ${pct}%`); lastPct = pct; }

      const cI = counts.get(images[i].id) || 0;
      const cJ = counts.get(images[j].id) || 0;
      if (cI >= maxPerNode && cJ >= maxPerNode) continue;

      const sim = simFn(images[i], images[j]);
      if (sim >= threshold) {
        edges.push({ source: images[i].id, target: images[j].id, weight: Math.round(sim * 1000) / 1000 });
        counts.set(images[i].id, cI + 1);
        counts.set(images[j].id, cJ + 1);
      }
    }
  }
  console.log(' Done!');
  return edges.sort((a, b) => b.weight - a.weight);
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      'image-base-url': { type: 'string', short: 'u' },
      limit: { type: 'string', short: 'l' },
      'edge-threshold': { type: 'string', short: 't' },
      'max-edges-per-node': { type: 'string', short: 'e' },
      algorithm: { type: 'string', short: 'a' },
      'skip-edges': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(`
Usage: npx tsx scripts/generate-local-data.ts -s <source> [options]

Options:
  -s, --source <path>           Source directory (required)
  -u, --image-base-url <url>    Base URL for images
  -t, --edge-threshold <n>      Similarity threshold (default: 0.7 clip, 0.25 metadata)
  -e, --max-edges-per-node <n>  Max edges per node (default: 15)
  -a, --algorithm <clip|metadata>  Algorithm (default: clip)
  -l, --limit <n>               Limit images
      --skip-edges              Skip edge computation
`);
    process.exit(0);
  }

  const src = values.source;
  if (!src) { console.error('❌ --source required'); process.exit(1); }

  const algo = (values.algorithm || 'clip') as 'clip' | 'metadata';
  const threshold = values['edge-threshold'] ? parseFloat(values['edge-threshold']) : (algo === 'clip' ? 0.7 : 0.25);
  const maxEdges = values['max-edges-per-node'] ? parseInt(values['max-edges-per-node'], 10) : 15;
  const baseUrl = values['image-base-url'] || '/images';
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const output = values.output || 'src/data/localImages.ts';

  const metaDir = path.join(src, 'metadata');
  const embDir = path.join(src, 'embeddings');

  if (!fs.existsSync(metaDir)) { console.error(`❌ Not found: ${metaDir}`); process.exit(1); }
  if (algo === 'clip' && !fs.existsSync(embDir)) { console.error(`❌ Not found: ${embDir}\n   Use -a metadata`); process.exit(1); }

  const files = fs.readdirSync(metaDir).filter(f => f.endsWith('.json')).slice(0, limit);
  console.log(`\n📄 Found ${files.length} images`);

  const images: ProcessedImage[] = [];
  let embLoaded = 0, embMissing = 0;

  for (const f of files) {
    try {
      const meta: ImageMetadata = JSON.parse(fs.readFileSync(path.join(metaDir, f), 'utf-8'));
      const base = path.basename(f, '.json');
      const ext = ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG'].find(e => fs.existsSync(path.join(src, 'small', base + e)));
      if (!ext) continue;

      let clip: number[] | undefined;
      if (algo === 'clip') {
        const npy = path.join(embDir, base + '.npy');
        if (fs.existsSync(npy)) { try { clip = parseNpy(fs.readFileSync(npy)); embLoaded++; } catch { embMissing++; } } else { embMissing++; }
      }

      images.push({
        id: meta.id || base,
        filename: meta.filename || base + ext,
        urls: { small: `${baseUrl}/small/${base}${ext}`, medium: `${baseUrl}/medium/${base}${ext}`, full: `${baseUrl}/full/${base}${ext}` },
        description: meta.description,
        mood: meta.mood,
        main_subject: meta.main_subject,
        tags: meta.tags,
        main_colors: meta.main_colors,
        exif: meta.exif || {},
        clipEmbedding: clip,
      });
    } catch (err) { console.error(`❌ ${f}:`, err); }
  }

  console.log(`✅ ${images.length} images` + (algo === 'clip' ? ` (${embLoaded} embeddings, ${embMissing} missing)` : ''));

  let edges: SimilarityEdge[] = [];
if (!values['skip-edges'] && images.length > 1) {
    edges = computeEdges(images, threshold, maxEdges, algo);
    console.log(`✅ ${edges.length} edges`);
    if (edges.length) {
      // FIX: Use reduce instead of spread operator to avoid stack overflow
      let minW = Infinity, maxW = -Infinity;
      for (const e of edges) {
        if (e.weight < minW) minW = e.weight;
        if (e.weight > maxW) maxW = e.weight;
      }
      console.log(`   Range: ${minW.toFixed(3)} - ${maxW.toFixed(3)}`);
    }
  }
  const outImages = images.map(({ clipEmbedding, ...rest }) => rest);
  const ts = `// Generated: ${new Date().toISOString()}
// ${images.length} images, ${edges.length} edges (${algo}, threshold=${threshold})

import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';

export const localImages: ImageMetadata[] = ${JSON.stringify(outImages, null, 2)};

export const precomputedEdges: SimilarityEdge[] = ${JSON.stringify(edges, null, 2)};

export default localImages;
`;

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, ts);
  console.log(`\n✅ Written: ${output}\n`);
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });

