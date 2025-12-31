import type { ImageMetadata } from '@/types/gallery';
import { getDominantColor, getColorPalette } from './vectors';

// Types
export interface Cluster {
  id: number;
  centroid: number[];
  members: ImageMetadata[];
  label?: string;
}

export interface ClusteringResult {
  clusters: Cluster[];
  assignments: Map<string, number>;
  iterations?: number;
  silhouetteScore?: number;
}

export type FeatureExtractor = (image: ImageMetadata) => number[];

// ============================================================================
// K-MEANS CLUSTERING
// ============================================================================

export interface KMeansOptions {
  k: number;
  maxIterations?: number;
  tolerance?: number;
  seed?: number;
  featureExtractor?: FeatureExtractor;
}

/**
 * K-Means clustering algorithm
 */
export function kMeans(
  images: ImageMetadata[],
  options: KMeansOptions
): ClusteringResult {
  const {
    k,
    maxIterations = 100,
    tolerance = 0.0001,
    seed,
    featureExtractor = defaultFeatureExtractor,
  } = options;

  if (images.length === 0 || k <= 0) {
    return { clusters: [], assignments: new Map() };
  }

  const actualK = Math.min(k, images.length);

  // Extract features for all images
  const features = images.map(featureExtractor);
  const dimensions = features[0].length;

  // Initialize centroids using k-means++
  let centroids = initializeCentroids(features, actualK, seed);

  let assignments = new Map<string, number>();
  let prevAssignments = new Map<string, number>();
  let iterations = 0;

  while (iterations < maxIterations) {
    // Assign each point to nearest centroid
    assignments = new Map();
    images.forEach((img, i) => {
      const nearestCluster = findNearestCentroid(features[i], centroids);
      assignments.set(img.id, nearestCluster);
    });

    // Check for convergence
    if (iterations > 0 && hasConverged(assignments, prevAssignments, tolerance)) {
      break;
    }

    prevAssignments = new Map(assignments);

    // Update centroids
    centroids = updateCentroids(features, assignments, actualK, dimensions, images);

    iterations++;
  }

  // Build cluster objects
  const clusters: Cluster[] = [];
  for (let i = 0; i < actualK; i++) {
    const members = images.filter((img) => assignments.get(img.id) === i);
    if (members.length > 0) {
      clusters.push({
        id: i,
        centroid: centroids[i],
        members,
        label: generateClusterLabel(members),
      });
    }
  }

  // Calculate silhouette score
  const silhouetteScore = calculateSilhouetteScore(features, assignments, images);

  return {
    clusters,
    assignments,
    iterations,
    silhouetteScore,
  };
}

/**
 * Initialize centroids using k-means++ algorithm
 */
function initializeCentroids(
  features: number[][],
  k: number,
  seed?: number
): number[][] {
  const random = seededRandom(seed);
  const centroids: number[][] = [];
  const n = features.length;

  // Choose first centroid randomly
  const firstIndex = Math.floor(random() * n);
  centroids.push([...features[firstIndex]]);

  // Choose remaining centroids with probability proportional to distance squared
  while (centroids.length < k) {
    const distances = features.map((f) => {
      const minDist = Math.min(...centroids.map((c) => euclideanDistance(f, c)));
      return minDist * minDist;
    });

    const totalDist = distances.reduce((a, b) => a + b, 0);
    let target = random() * totalDist;
    let selectedIndex = 0;

    for (let i = 0; i < n; i++) {
      target -= distances[i];
      if (target <= 0) {
        selectedIndex = i;
        break;
      }
    }

    centroids.push([...features[selectedIndex]]);
  }

  return centroids;
}

/**
 * Find nearest centroid for a point
 */
function findNearestCentroid(point: number[], centroids: number[][]): number {
  let minDist = Infinity;
  let nearest = 0;

  centroids.forEach((centroid, i) => {
    const dist = euclideanDistance(point, centroid);
    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }
  });

  return nearest;
}

/**
 * Update centroids based on current assignments
 */
function updateCentroids(
  features: number[][],
  assignments: Map<string, number>,
  k: number,
  dimensions: number,
  images: ImageMetadata[]
): number[][] {
  const newCentroids: number[][] = Array.from({ length: k }, () =>
    Array(dimensions).fill(0)
  );
  const counts = Array(k).fill(0);

  images.forEach((img, i) => {
    const cluster = assignments.get(img.id) || 0;
    counts[cluster]++;
    features[i].forEach((val, d) => {
      newCentroids[cluster][d] += val;
    });
  });

  // Average
  newCentroids.forEach((centroid, i) => {
    if (counts[i] > 0) {
      centroid.forEach((_, d) => {
        centroid[d] /= counts[i];
      });
    }
  });

  return newCentroids;
}

/**
 * Check if assignments have converged
 */
function hasConverged(
  current: Map<string, number>,
  previous: Map<string, number>,
  tolerance: number
): boolean {
  let changes = 0;
  current.forEach((cluster, id) => {
    if (previous.get(id) !== cluster) {
      changes++;
    }
  });
  return changes / current.size < tolerance;
}

// ============================================================================
// DBSCAN CLUSTERING
// ============================================================================

export interface DBSCANOptions {
  epsilon: number;
  minPoints: number;
  featureExtractor?: FeatureExtractor;
  distanceFunction?: (a: number[], b: number[]) => number;
}

/**
 * DBSCAN density-based clustering algorithm
 */
export function dbscan(
  images: ImageMetadata[],
  options: DBSCANOptions
): ClusteringResult {
  const {
    epsilon,
    minPoints,
    featureExtractor = defaultFeatureExtractor,
    distanceFunction = euclideanDistance,
  } = options;

  if (images.length === 0) {
    return { clusters: [], assignments: new Map() };
  }

  const features = images.map(featureExtractor);
  const n = images.length;

  // Labels: -1 = noise, 0+ = cluster id
  const labels = new Array(n).fill(-2); // -2 = unvisited
  let currentCluster = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue; // Already processed

    const neighbors = rangeQuery(features, i, epsilon, distanceFunction);

    if (neighbors.length < minPoints) {
      labels[i] = -1; // Mark as noise
    } else {
      // Expand cluster
      expandCluster(
        features,
        labels,
        i,
        neighbors,
        currentCluster,
        epsilon,
        minPoints,
        distanceFunction
      );
      currentCluster++;
    }
  }

  // Build result
  const assignments = new Map<string, number>();
  const clusterMap = new Map<number, ImageMetadata[]>();

  images.forEach((img, i) => {
    const label = labels[i];
    assignments.set(img.id, label);

    if (label >= 0) {
      if (!clusterMap.has(label)) {
        clusterMap.set(label, []);
      }
      clusterMap.get(label)!.push(img);
    }
  });

  const clusters: Cluster[] = [];
  clusterMap.forEach((members, id) => {
    const memberFeatures = members.map((m) =>
      features[images.findIndex((img) => img.id === m.id)]
    );
    const centroid = computeCentroid(memberFeatures);

    clusters.push({
      id,
      centroid,
      members,
      label: generateClusterLabel(members),
    });
  });

  // Add noise cluster if any
  const noiseMembers = images.filter((_, i) => labels[i] === -1);
  if (noiseMembers.length > 0) {
    clusters.push({
      id: -1,
      centroid: [],
      members: noiseMembers,
      label: 'Noise / Outliers',
    });
  }

  return { clusters, assignments };
}

/**
 * Find all points within epsilon distance
 */
function rangeQuery(
  features: number[][],
  pointIndex: number,
  epsilon: number,
  distanceFunction: (a: number[], b: number[]) => number
): number[] {
  const neighbors: number[] = [];
  const point = features[pointIndex];

  features.forEach((other, i) => {
    if (distanceFunction(point, other) <= epsilon) {
      neighbors.push(i);
    }
  });

  return neighbors;
}

/**
 * Expand cluster from a core point
 */
function expandCluster(
  features: number[][],
  labels: number[],
  pointIndex: number,
  neighbors: number[],
  clusterId: number,
  epsilon: number,
  minPoints: number,
  distanceFunction: (a: number[], b: number[]) => number
): void {
  labels[pointIndex] = clusterId;

  const queue = [...neighbors];
  const processed = new Set<number>([pointIndex]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (processed.has(current)) continue;
    processed.add(current);

    if (labels[current] === -1) {
      labels[current] = clusterId; // Change noise to border point
    }

    if (labels[current] !== -2) continue; // Already in a cluster

    labels[current] = clusterId;

    const currentNeighbors = rangeQuery(features, current, epsilon, distanceFunction);
    if (currentNeighbors.length >= minPoints) {
      currentNeighbors.forEach((n) => {
        if (!processed.has(n)) {
          queue.push(n);
        }
      });
    }
  }
}

// ============================================================================
// HIERARCHICAL CLUSTERING
// ============================================================================

export interface HierarchicalOptions {
  linkage: 'single' | 'complete' | 'average';
  numClusters?: number;
  threshold?: number;
  featureExtractor?: FeatureExtractor;
}

export interface DendrogramNode {
  id: number;
  left?: DendrogramNode;
  right?: DendrogramNode;
  distance: number;
  members: ImageMetadata[];
}

/**
 * Agglomerative hierarchical clustering
 */
export function hierarchicalClustering(
  images: ImageMetadata[],
  options: HierarchicalOptions
): ClusteringResult {
  const {
    linkage,
    numClusters = 5,
    featureExtractor = defaultFeatureExtractor,
  } = options;

  if (images.length === 0) {
    return { clusters: [], assignments: new Map() };
  }

  const features = images.map(featureExtractor);
  const n = images.length;

  // Initialize each point as its own cluster
  let currentClusters: Array<{
    id: number;
    members: number[];
    centroid: number[];
  }> = images.map((_, i) => ({
    id: i,
    members: [i],
    centroid: features[i],
  }));

  // Compute initial distance matrix
  const distanceMatrix: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0)
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = euclideanDistance(features[i], features[j]);
      distanceMatrix[i][j] = dist;
      distanceMatrix[j][i] = dist;
    }
  }

  // Merge clusters until we have desired number
  while (currentClusters.length > numClusters) {
    // Find closest pair
    let minDist = Infinity;
    let mergeI = 0;
    let mergeJ = 1;

    for (let i = 0; i < currentClusters.length; i++) {
      for (let j = i + 1; j < currentClusters.length; j++) {
        const dist = clusterDistance(
          currentClusters[i].members,
          currentClusters[j].members,
          distanceMatrix,
          linkage
        );
        if (dist < minDist) {
          minDist = dist;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    // Merge clusters
    const merged = {
      id: currentClusters[mergeI].id,
      members: [
        ...currentClusters[mergeI].members,
        ...currentClusters[mergeJ].members,
      ],
      centroid: computeCentroid(
        [...currentClusters[mergeI].members, ...currentClusters[mergeJ].members].map(
          (i) => features[i]
        )
      ),
    };

    currentClusters = currentClusters.filter((_, i) => i !== mergeI && i !== mergeJ);
    currentClusters.push(merged);
  }

  // Build result
  const assignments = new Map<string, number>();
  const clusters: Cluster[] = currentClusters.map((c, idx) => {
    const members = c.members.map((i) => images[i]);
    members.forEach((m) => assignments.set(m.id, idx));

    return {
      id: idx,
      centroid: c.centroid,
      members,
      label: generateClusterLabel(members),
    };
  });

  return { clusters, assignments };
}

/**
 * Compute distance between two clusters based on linkage type
 */
function clusterDistance(
  cluster1: number[],
  cluster2: number[],
  distanceMatrix: number[][],
  linkage: 'single' | 'complete' | 'average'
): number {
  const distances: number[] = [];

  for (const i of cluster1) {
    for (const j of cluster2) {
      distances.push(distanceMatrix[i][j]);
    }
  }

  switch (linkage) {
    case 'single':
      return Math.min(...distances);
    case 'complete':
      return Math.max(...distances);
    case 'average':
      return distances.reduce((a, b) => a + b, 0) / distances.length;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Default feature extractor - combines color, mood, and tag features
 */
export function defaultFeatureExtractor(image: ImageMetadata): number[] {
  const features: number[] = [];

  // Color features (RGB of dominant color, normalized)
  const dominantColor = getDominantColor(image);
  const rgb = hexToRgb(dominantColor);
  features.push(rgb.r / 255, rgb.g / 255, rgb.b / 255);

  // Color palette features (average of all colors)
  const palette = getColorPalette(image);
  if (palette.length > 0) {
    const avgColor = palette.reduce(
      (acc, hex) => {
        const c = hexToRgb(hex);
        return { r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b };
      },
      { r: 0, g: 0, b: 0 }
    );
    features.push(
      avgColor.r / palette.length / 255,
      avgColor.g / palette.length / 255,
      avgColor.b / palette.length / 255
    );
  } else {
    features.push(0.5, 0.5, 0.5);
  }

  // Mood features (simple encoding)
  const moodWords = image.mood.toLowerCase().split(/[,\s]+/);
  const moodScores = {
    warm: 0,
    cool: 0,
    calm: 0,
    energetic: 0,
  };

  const warmWords = ['warm', 'cozy', 'sunny', 'golden', 'vibrant'];
  const coolWords = ['cool', 'cold', 'serene', 'peaceful', 'calm'];
  const calmWords = ['calm', 'peaceful', 'serene', 'tranquil', 'quiet'];
  const energeticWords = ['energetic', 'dynamic', 'dramatic', 'bold', 'vibrant'];

  moodWords.forEach((word) => {
    if (warmWords.some((w) => word.includes(w))) moodScores.warm++;
    if (coolWords.some((w) => word.includes(w))) moodScores.cool++;
    if (calmWords.some((w) => word.includes(w))) moodScores.calm++;
    if (energeticWords.some((w) => word.includes(w))) moodScores.energetic++;
  });

  const moodTotal = Math.max(
    1,
    moodScores.warm + moodScores.cool + moodScores.calm + moodScores.energetic
  );
  features.push(
    moodScores.warm / moodTotal,
    moodScores.cool / moodTotal,
    moodScores.calm / moodTotal,
    moodScores.energetic / moodTotal
  );

  return features;
}

/**
 * Color-only feature extractor
 */
export function colorFeatureExtractor(image: ImageMetadata): number[] {
  const palette = getColorPalette(image);
  const features: number[] = [];

  // Use up to 5 colors
  for (let i = 0; i < 5; i++) {
    if (i < palette.length) {
      const rgb = hexToRgb(palette[i]);
      features.push(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    } else {
      features.push(0, 0, 0);
    }
  }

  return features;
}

/**
 * Tag-based feature extractor (bag of words style)
 */
export function tagFeatureExtractor(
  image: ImageMetadata,
  vocabulary: string[]
): number[] {
  const allTags = Object.values(image.tags)
    .flat()
    .map((t) => t.toLowerCase());

  return vocabulary.map((word) => (allTags.includes(word.toLowerCase()) ? 1 : 0));
}

/**
 * Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - (b[i] || 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compute centroid of a set of points
 */
export function computeCentroid(points: number[][]): number[] {
  if (points.length === 0) return [];

  const dimensions = points[0].length;
  const centroid = Array(dimensions).fill(0);

  points.forEach((point) => {
    point.forEach((val, i) => {
      centroid[i] += val;
    });
  });

  return centroid.map((v) => v / points.length);
}

/**
 * Calculate silhouette score for clustering quality
 */
function calculateSilhouetteScore(
  features: number[][],
  assignments: Map<string, number>,
  images: ImageMetadata[]
): number {
  const scores: number[] = [];

  images.forEach((img, i) => {
    const cluster = assignments.get(img.id);
    if (cluster === undefined) return;

    // a(i) = average distance to same cluster
    const sameCluster = images.filter(
      (other) => assignments.get(other.id) === cluster && other.id !== img.id
    );

    if (sameCluster.length === 0) {
      scores.push(0);
      return;
    }

    const a =
      sameCluster.reduce((sum, other) => {
        const otherIdx = images.findIndex((x) => x.id === other.id);
        return sum + euclideanDistance(features[i], features[otherIdx]);
      }, 0) / sameCluster.length;

    // b(i) = minimum average distance to other clusters
    const otherClusters = new Set(
      [...assignments.values()].filter((c) => c !== cluster)
    );

    let b = Infinity;
    otherClusters.forEach((otherCluster) => {
      const otherMembers = images.filter(
        (other) => assignments.get(other.id) === otherCluster
      );
      if (otherMembers.length === 0) return;

      const avgDist =
        otherMembers.reduce((sum, other) => {
          const otherIdx = images.findIndex((x) => x.id === other.id);
          return sum + euclideanDistance(features[i], features[otherIdx]);
        }, 0) / otherMembers.length;

      b = Math.min(b, avgDist);
    });

    if (b === Infinity) b = 0;

    const s = (b - a) / Math.max(a, b);
    scores.push(isNaN(s) ? 0 : s);
  });

  return scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
}

/**
 * Generate a descriptive label for a cluster based on common tags
 */
function generateClusterLabel(members: ImageMetadata[]): string {
  const tagCounts = new Map<string, number>();

  members.forEach((img) => {
    Object.values(img.tags)
      .flat()
      .forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
  });

  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return `Cluster (${members.length} images)`;

  const topTags = sorted.slice(0, 2).map(([tag]) => tag);
  return topTags.join(' & ');
}

/**
 * Seeded random number generator
 */
function seededRandom(seed?: number): () => number {
  if (seed === undefined) {
    return Math.random;
  }

  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Hex to RGB conversion
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 128, g: 128, b: 128 };
}
