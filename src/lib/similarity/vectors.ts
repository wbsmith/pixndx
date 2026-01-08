import type {
  ImageMetadata,
  ColorAnalysis,
  ColorFamily,
} from '@/types/gallery';

// Local type for legacy similarity computation (not used in production)
type LegacySimilarityMode = 'full' | 'colors' | 'mood' | 'tags' | 'description' | 'composite';

interface LegacySimilarityConfig {
  mode: LegacySimilarityMode;
  threshold: number;
  weights?: {
    visual: number;
    semantic: number;
    color: number;
    mood: number;
  };
}

interface LegacySimilarityEdge {
  source: string;
  target: string;
  weight: number;
  mode: LegacySimilarityMode;
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
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

// Jaccard similarity for tags
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Color distance using perceptual formula
export function colorDistance(hex1: string, hex2: string): number {
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

// Color palette similarity - uses main_colors object
export function paletteSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const palette1 = Object.values(img1.main_colors);
  const palette2 = Object.values(img2.main_colors);
  
  let totalDistance = 0;
  let comparisons = 0;
  
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

// Mood similarity - mood is a comma-separated string
export function moodSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const moods1 = img1.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const moods2 = img2.mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  
  return jaccardSimilarity(moods1, moods2);
}

// Get all tags as flat array from nested structure
function getAllTagsFlat(img: ImageMetadata): string[] {
  return Object.values(img.tags).flat().map(t => t.toLowerCase());
}

// Tag similarity - handles nested tag categories
export function tagSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  const allTags1 = getAllTagsFlat(img1);
  const allTags2 = getAllTagsFlat(img2);
  
  const categories1 = Object.keys(img1.tags);
  const categories2 = Object.keys(img2.tags);
  const sharedCategories = categories1.filter(c => categories2.includes(c));
  
  let categoryScore = 0;
  for (const category of sharedCategories) {
    const tags1 = img1.tags[category]?.map(t => t.toLowerCase()) || [];
    const tags2 = img2.tags[category]?.map(t => t.toLowerCase()) || [];
    categoryScore += jaccardSimilarity(tags1, tags2);
  }
  
  const categoryAvg = sharedCategories.length > 0 
    ? categoryScore / sharedCategories.length 
    : 0;
  
  const overallSim = jaccardSimilarity(allTags1, allTags2);
  
  return categoryAvg * 0.6 + overallSim * 0.4;
}

// Description similarity
function descriptionSimilarity(img1: ImageMetadata, img2: ImageMetadata): number {
  if (img1.embedding?.description && img2.embedding?.description) {
    return cosineSimilarity(img1.embedding.description, img2.embedding.description);
  }
  
  const words1 = img1.description.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const words2 = img2.description.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  
  return jaccardSimilarity(words1, words2);
}

// Main similarity function (legacy - not used in production)
export function computeSimilarity(
  img1: ImageMetadata,
  img2: ImageMetadata,
  config: LegacySimilarityConfig
): number {
  switch (config.mode) {
    case 'full':
      if (img1.embedding?.clip && img2.embedding?.clip) {
        return cosineSimilarity(img1.embedding.clip, img2.embedding.clip);
      }
      return computeCompositeSimilarity(img1, img2, {
        visual: 0.4,
        semantic: 0.3,
        color: 0.2,
        mood: 0.1,
      });
      
    case 'colors':
      return paletteSimilarity(img1, img2);
      
    case 'mood':
      return moodSimilarity(img1, img2);
      
    case 'tags':
      return tagSimilarity(img1, img2);
      
    case 'description':
      return descriptionSimilarity(img1, img2);
      
    case 'composite':
      return computeCompositeSimilarity(
        img1,
        img2,
        config.weights || { visual: 0.3, semantic: 0.3, color: 0.2, mood: 0.2 }
      );
      
    default:
      return 0;
  }
}

function computeCompositeSimilarity(
  img1: ImageMetadata,
  img2: ImageMetadata,
  weights: { visual: number; semantic: number; color: number; mood: number }
): number {
  let total = 0;
  let weightSum = 0;
  
  if (img1.embedding?.clip && img2.embedding?.clip) {
    total += cosineSimilarity(img1.embedding.clip, img2.embedding.clip) * weights.visual;
    weightSum += weights.visual;
  }
  
  const tagSim = tagSimilarity(img1, img2);
  const descSim = descriptionSimilarity(img1, img2);
  total += (tagSim * 0.6 + descSim * 0.4) * weights.semantic;
  weightSum += weights.semantic;
  
  const colorSim = paletteSimilarity(img1, img2);
  total += colorSim * weights.color;
  weightSum += weights.color;
  
  const moodSim = moodSimilarity(img1, img2);
  total += moodSim * weights.mood;
  weightSum += weights.mood;
  
  return weightSum === 0 ? 0 : total / weightSum;
}

// Get edges above threshold (legacy - not used in production)
export function getEdgesAboveThreshold(
  images: ImageMetadata[],
  config: LegacySimilarityConfig
): LegacySimilarityEdge[] {
  const edges: LegacySimilarityEdge[] = [];
  const seen = new Set<string>();
  
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const key = `${images[i].id}-${images[j].id}`;
      if (!seen.has(key)) {
        const similarity = computeSimilarity(images[i], images[j], config);
        if (similarity >= config.threshold) {
          edges.push({
            source: images[i].id,
            target: images[j].id,
            weight: similarity,
            mode: config.mode,
          });
        }
        seen.add(key);
      }
    }
  }
  
  return edges;
}

// Helper: hex to RGB
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

// Color analysis
export function analyzeColor(hex: string): ColorAnalysis {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return {
      hue: 0,
      saturation: 0,
      lightness: 0,
      warmth: 0.5,
      dominantFamily: 'neutral',
    };
  }
  
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  
  let h = 0;
  let s = 0;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r / 255:
        h = ((g - b) / 255 / d + (g < b ? 6 : 0)) / 6;
        break;
      case g / 255:
        h = ((b - r) / 255 / d + 2) / 6;
        break;
      case b / 255:
        h = ((r - g) / 255 / d + 4) / 6;
        break;
    }
  }
  
  let warmth = 0.5;
  const hDeg = h * 360;
  if (hDeg <= 60 || hDeg >= 300) {
    warmth = 0.7 + 0.3 * s;
  } else if (hDeg >= 120 && hDeg <= 270) {
    warmth = 0.3 - 0.3 * s;
  }
  
  return {
    hue: h,
    saturation: s,
    lightness: l,
    warmth,
    dominantFamily: getColorFamily(h),
  };
}

function getColorFamily(hue: number): ColorFamily {
  const h = hue * 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  if (h < 345) return 'magenta';
  return 'neutral';
}

// Group images by color family
export function groupByColorFamily(images: ImageMetadata[]): Map<ColorFamily, ImageMetadata[]> {
  const groups = new Map<ColorFamily, ImageMetadata[]>();
  
  for (const img of images) {
    const dominantColor = getDominantColor(img);
    const analysis = analyzeColor(dominantColor);
    const family = analysis.dominantFamily;
    
    if (!groups.has(family)) {
      groups.set(family, []);
    }
    groups.get(family)!.push(img);
  }
  
  return groups;
}

// Get k most similar images (legacy - not used in production)
export function getKMostSimilar(
  targetImage: ImageMetadata,
  allImages: ImageMetadata[],
  k: number,
  config: LegacySimilarityConfig
): Array<{ image: ImageMetadata; similarity: number }> {
  const similarities = allImages
    .filter((img) => img.id !== targetImage.id)
    .map((img) => ({
      image: img,
      similarity: computeSimilarity(targetImage, img, config),
    }))
    .sort((a, b) => b.similarity - a.similarity);
  
  return similarities.slice(0, k);
}

// Helper to get dominant color from image (first color in main_colors)
export function getDominantColor(img: ImageMetadata): string {
  return Object.values(img.main_colors)[0] || '#808080';
}

// Helper to get color palette as array
export function getColorPalette(img: ImageMetadata): string[] {
  return Object.values(img.main_colors);
}
