import type { Schema } from '../../data/resource';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME!;

// Types
interface ImageMetadata {
  id: string;
  filename: string;
  description: string;
  tags: Record<string, string[]>;
  mood: string;
  main_subject: string;
  main_colors: Record<string, string>;
  exif?: Record<string, any>;
  embedding?: {
    clip: number[];
    description: number[];
  };
}

interface SimilarityEdge {
  sourceId: string;
  targetId: string;
  weight: number;
  mode: string;
}

interface SimilarityWeights {
  visual: number;
  semantic: number;
  color: number;
  mood: number;
}

type SimilarityMode = 'full' | 'colors' | 'mood' | 'tags' | 'description' | 'composite';

/**
 * Main handler for computeSimilarityEdges query
 */
export const handler: Schema['computeSimilarityEdges']['functionHandler'] = async (event) => {
  const { 
    imageIds, 
    mode = 'composite', 
    threshold = 0.3,
    weights,
  } = event.arguments;
  
  try {
    // Load metadata for requested images
    const images = await loadMetadataForIds(imageIds);
    
    // Parse weights if provided
    const parsedWeights: SimilarityWeights = weights 
      ? JSON.parse(JSON.stringify(weights))
      : { visual: 0.3, semantic: 0.3, color: 0.2, mood: 0.2 };
    
    // Compute similarity edges
    const edges = computeEdges(images, mode as SimilarityMode, threshold, parsedWeights);
    
    return edges;
  } catch (error) {
    console.error('Similarity computation error:', error);
    throw new Error(`Similarity computation failed: ${error}`);
  }
};

/**
 * Load metadata for specific image IDs
 */
async function loadMetadataForIds(imageIds: string[]): Promise<ImageMetadata[]> {
  const images: ImageMetadata[] = [];
  
  for (const id of imageIds) {
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `metadata/${id}.json`,
      });
      
      const response = await s3Client.send(getCommand);
      const body = await streamToString(response.Body as Readable);
      const metadata = JSON.parse(body);
      
      images.push({
        id,
        ...metadata,
      });
    } catch (error) {
      console.warn(`Failed to load metadata for ${id}:`, error);
    }
  }
  
  return images;
}

/**
 * Compute similarity edges between all image pairs
 */
function computeEdges(
  images: ImageMetadata[],
  mode: SimilarityMode,
  threshold: number,
  weights: SimilarityWeights
): SimilarityEdge[] {
  const edges: SimilarityEdge[] = [];
  
  // Compare each pair once
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const similarity = computeSimilarity(images[i], images[j], mode, weights);
      
      if (similarity >= threshold) {
        edges.push({
          sourceId: images[i].id,
          targetId: images[j].id,
          weight: similarity,
          mode,
        });
      }
    }
  }
  
  return edges;
}

/**
 * Compute similarity between two images
 */
function computeSimilarity(
  img1: ImageMetadata,
  img2: ImageMetadata,
  mode: SimilarityMode,
  weights: SimilarityWeights
): number {
  switch (mode) {
    case 'full':
      // Use CLIP embeddings if available
      if (img1.embedding?.clip && img2.embedding?.clip) {
        return cosineSimilarity(img1.embedding.clip, img2.embedding.clip);
      }
      // Fallback to composite
      return computeCompositeSimilarity(img1, img2, weights);
      
    case 'colors':
      return colorPaletteSimilarity(img1, img2);
      
    case 'mood':
      return moodSimilarity(img1, img2);
      
    case 'tags':
      return tagSimilarity(img1, img2);
      
    case 'description':
      return descriptionSimilarity(img1, img2);
      
    case 'composite':
      return computeCompositeSimilarity(img1, img2, weights);
      
    default:
      return 0;
  }
}

/**
 * Compute weighted composite similarity
 */
function computeCompositeSimilarity(
  img1: ImageMetadata,
  img2: ImageMetadata,
  weights: SimilarityWeights
): number {
  let total = 0;
  let weightSum = 0;
  
  // Visual (CLIP embeddings)
  if (img1.embedding?.clip && img2.embedding?.clip) {
    total += cosineSimilarity(img1.embedding.clip, img2.embedding.clip) * weights.visual;
    weightSum += weights.visual;
  }
  
  // Semantic (tags + description)
  const tagSim = tagSimilarity(img1, img2);
  const descSim = descriptionSimilarity(img1, img2);
  total += (tagSim * 0.6 + descSim * 0.4) * weights.semantic;
  weightSum += weights.semantic;
  
  // Color
  const colorSim = colorPaletteSimilarity(img1, img2);
  total += colorSim * weights.color;
  weightSum += weights.color;
  
  // Mood
  const moodSim = moodSimilarity(img1, img2);
  total += moodSim * weights.mood;
  weightSum += weights.mood;
  
  return weightSum === 0 ? 0 : total / weightSum;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Jaccard similarity for sets
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Color palette similarity
 */
function colorPaletteSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const palette1 = Object.values(img1.main_colors);
  const palette2 = Object.values(img2.main_colors);
  
  let totalDistance = 0;
  let comparisons = 0;
  
  // Compare each color to its closest match
  for (const c1 of palette1) {
    let minDist = 1;
    for (const c2 of palette2) {
      const dist = colorDistance(c1, c2);
      minDist = Math.min(minDist, dist);
    }
    totalDistance += minDist;
    comparisons++;
  }
  
  for (const c2 of palette2) {
    let minDist = 1;
    for (const c1 of palette1) {
      const dist = colorDistance(c2, c1);
      minDist = Math.min(minDist, dist);
    }
    totalDistance += minDist;
    comparisons++;
  }
  
  const avgDistance = comparisons === 0 ? 0 : totalDistance / comparisons;
  return 1 - avgDistance;
}

/**
 * Color distance (perceptual)
 */
function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  
  if (!rgb1 || !rgb2) return 1;
  
  const rMean = (rgb1.r + rgb2.r) / 2;
  const dR = rgb1.r - rgb2.r;
  const dG = rgb1.g - rgb2.g;
  const dB = rgb1.b - rgb2.b;
  
  const distance = Math.sqrt(
    (2 + rMean / 256) * dR * dR +
    4 * dG * dG +
    (2 + (255 - rMean) / 256) * dB * dB
  );
  
  return Math.min(distance / 765, 1);
}

/**
 * Hex to RGB conversion
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Mood similarity (Jaccard on mood words)
 */
function moodSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const moods1 = img1.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const moods2 = img2.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  
  return jaccardSimilarity(moods1, moods2);
}

/**
 * Tag similarity (weighted Jaccard across categories)
 */
function tagSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const allTags1 = Object.values(img1.tags).flat().map((t) => t.toLowerCase());
  const allTags2 = Object.values(img2.tags).flat().map((t) => t.toLowerCase());
  
  const categories1 = Object.keys(img1.tags);
  const categories2 = Object.keys(img2.tags);
  const sharedCategories = categories1.filter((c) => categories2.includes(c));
  
  let categoryScore = 0;
  for (const category of sharedCategories) {
    const tags1 = img1.tags[category]?.map((t) => t.toLowerCase()) || [];
    const tags2 = img2.tags[category]?.map((t) => t.toLowerCase()) || [];
    categoryScore += jaccardSimilarity(tags1, tags2);
  }
  
  const categoryAvg = sharedCategories.length > 0
    ? categoryScore / sharedCategories.length
    : 0;
  
  const overallSim = jaccardSimilarity(allTags1, allTags2);
  
  return categoryAvg * 0.6 + overallSim * 0.4;
}

/**
 * Description similarity (word overlap or embeddings)
 */
function descriptionSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  // Use embeddings if available
  if (img1.embedding?.description && img2.embedding?.description) {
    return cosineSimilarity(img1.embedding.description, img2.embedding.description);
  }
  
  // Fallback to word overlap
  const words1 = img1.description.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const words2 = img2.description.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  
  return jaccardSimilarity(words1, words2);
}

/**
 * Convert stream to string
 */
async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
