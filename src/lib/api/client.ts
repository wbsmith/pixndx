/**
 * API Client for PixNdx Gallery
 * 
 * Provides typed access to the GraphQL API and S3 storage.
 * Works with Amplify Gen 2 backend.
 */

import type { ImageMetadata, SearchFilters, SimilarityMode, SimilarityEdge } from '@/types/gallery';

// ============================================================================
// CONFIGURATION
// ============================================================================

interface ClientConfig {
  apiEndpoint?: string;
  region?: string;
  authMode?: 'apiKey' | 'iam' | 'userPool';
}

let config: ClientConfig = {
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT,
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  authMode: 'iam',
};

/**
 * Configure the API client
 */
export function configureClient(newConfig: Partial<ClientConfig>): void {
  config = { ...config, ...newConfig };
}

// ============================================================================
// GRAPHQL QUERIES
// ============================================================================

const SEARCH_IMAGES_QUERY = `
  query SearchImages($query: String!, $limit: Int, $filters: AWSJSON) {
    searchImages(query: $query, limit: $limit, filters: $filters) {
      imageId
      score
      matchedFields
    }
  }
`;

const GET_IMAGE_QUERY = `
  query GetImage($id: ID!) {
    getImage(id: $id) {
      id
      filename
      urlSmall
      urlMedium
      urlFull
      description
      mood
      mainSubject
      tags
      mainColors
      exif
      clipEmbedding
      descriptionEmbedding
      dominantColorHex
      warmth
      dateTaken
      createdAt
      updatedAt
    }
  }
`;

const LIST_IMAGES_QUERY = `
  query ListImages($limit: Int, $nextToken: String) {
    listImages(limit: $limit, nextToken: $nextToken) {
      items {
        id
        filename
        urlSmall
        urlMedium
        urlFull
        description
        mood
        mainSubject
        tags
        mainColors
        exif
        dominantColorHex
        dateTaken
      }
      nextToken
    }
  }
`;

const COMPUTE_SIMILARITY_QUERY = `
  query ComputeSimilarityEdges(
    $imageIds: [ID!]!
    $mode: SimilarityMode
    $threshold: Float
    $weights: AWSJSON
  ) {
    computeSimilarityEdges(
      imageIds: $imageIds
      mode: $mode
      threshold: $threshold
      weights: $weights
    ) {
      sourceId
      targetId
      weight
      mode
    }
  }
`;

const GET_SIMILAR_IMAGES_QUERY = `
  query GetSimilarImages($imageId: ID!, $limit: Int, $mode: SimilarityMode) {
    getSimilarImages(imageId: $imageId, limit: $limit, mode: $mode) {
      imageId
      score
      matchedFields
    }
  }
`;

// ============================================================================
// API TYPES
// ============================================================================

interface SearchResult {
  imageId: string;
  score: number;
  matchedFields: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface ListImagesResponse {
  items: ImageMetadata[];
  nextToken?: string;
}

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Execute a GraphQL query
 */
async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  if (!config.apiEndpoint) {
    throw new Error('API endpoint not configured. Call configureClient() first.');
  }

  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Add auth headers based on mode
      // In production, use Amplify's auth utilities
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join(', '));
  }

  return result.data as T;
}

// ============================================================================
// IMAGE OPERATIONS
// ============================================================================

/**
 * Search images using natural language query
 */
export async function searchImages(
  query: string,
  options: {
    limit?: number;
    filters?: SearchFilters;
  } = {}
): Promise<SearchResult[]> {
  const { limit = 20, filters } = options;

  const result = await graphql<{ searchImages: SearchResult[] }>(
    SEARCH_IMAGES_QUERY,
    {
      query,
      limit,
      filters: filters ? JSON.stringify(filters) : undefined,
    }
  );

  return result.searchImages;
}

/**
 * Get a single image by ID
 */
export async function getImage(id: string): Promise<ImageMetadata | null> {
  const result = await graphql<{ getImage: RawImageData | null }>(
    GET_IMAGE_QUERY,
    { id }
  );

  return result.getImage ? transformImageData(result.getImage) : null;
}

/**
 * List all images with pagination
 */
export async function listImages(
  options: {
    limit?: number;
    nextToken?: string;
  } = {}
): Promise<ListImagesResponse> {
  const { limit = 50, nextToken } = options;

  const result = await graphql<{ listImages: { items: RawImageData[]; nextToken?: string } }>(
    LIST_IMAGES_QUERY,
    { limit, nextToken }
  );

  return {
    items: result.listImages.items.map(transformImageData),
    nextToken: result.listImages.nextToken,
  };
}

/**
 * Load all images (handles pagination automatically)
 */
export async function loadAllImages(): Promise<ImageMetadata[]> {
  const allImages: ImageMetadata[] = [];
  let nextToken: string | undefined;

  do {
    const response = await listImages({ limit: 100, nextToken });
    allImages.push(...response.items);
    nextToken = response.nextToken;
  } while (nextToken);

  return allImages;
}

// ============================================================================
// SIMILARITY OPERATIONS
// ============================================================================

/**
 * Compute similarity edges between images
 */
export async function computeSimilarityEdges(
  imageIds: string[],
  options: {
    mode?: SimilarityMode;
    threshold?: number;
    weights?: {
      visual: number;
      semantic: number;
      color: number;
      mood: number;
    };
  } = {}
): Promise<SimilarityEdge[]> {
  const { mode = 'composite', threshold = 0.3, weights } = options;

  const result = await graphql<{ computeSimilarityEdges: Array<{
    sourceId: string;
    targetId: string;
    weight: number;
    mode: string;
  }> }>(
    COMPUTE_SIMILARITY_QUERY,
    {
      imageIds,
      mode,
      threshold,
      weights: weights ? JSON.stringify(weights) : undefined,
    }
  );

  return result.computeSimilarityEdges.map((edge) => ({
    source: edge.sourceId,
    target: edge.targetId,
    weight: edge.weight,
    mode: edge.mode as SimilarityMode,
  }));
}

/**
 * Get similar images to a specific image
 */
export async function getSimilarImages(
  imageId: string,
  options: {
    limit?: number;
    mode?: SimilarityMode;
  } = {}
): Promise<SearchResult[]> {
  const { limit = 10, mode = 'composite' } = options;

  const result = await graphql<{ getSimilarImages: SearchResult[] }>(
    GET_SIMILAR_IMAGES_QUERY,
    { imageId, limit, mode }
  );

  return result.getSimilarImages;
}

// ============================================================================
// STORAGE OPERATIONS
// ============================================================================

/**
 * Get signed URL for an image
 */
export async function getImageUrl(
  key: string,
  size: 'small' | 'medium' | 'full' = 'medium'
): Promise<string> {
  // In production, use Amplify Storage
  // For now, construct URL directly
  const baseUrl = import.meta.env.VITE_STORAGE_URL || '';
  return `${baseUrl}/images/${size}/${key}`;
}

/**
 * Upload an image
 */
export async function uploadImage(
  file: File,
  options: {
    onProgress?: (progress: number) => void;
  } = {}
): Promise<{ key: string; url: string }> {
  // In production, use Amplify Storage
  // This is a placeholder implementation
  const key = `${Date.now()}-${file.name}`;
  
  // Simulate upload
  options.onProgress?.(100);
  
  return {
    key,
    url: await getImageUrl(key),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

interface RawImageData {
  id: string;
  filename: string;
  urlSmall: string;
  urlMedium: string;
  urlFull: string;
  description: string;
  mood: string;
  mainSubject: string;
  tags: string; // JSON string
  mainColors: string; // JSON string
  exif?: string; // JSON string
  clipEmbedding?: string; // JSON string
  descriptionEmbedding?: string; // JSON string
  dominantColorHex?: string;
  warmth?: number;
  dateTaken?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Transform raw API data to ImageMetadata
 */
function transformImageData(raw: RawImageData): ImageMetadata {
  return {
    id: raw.id,
    filename: raw.filename,
    urls: {
      small: raw.urlSmall,
      medium: raw.urlMedium,
      full: raw.urlFull,
    },
    description: raw.description,
    mood: raw.mood,
    main_subject: raw.mainSubject,
    tags: parseJson(raw.tags, {}),
    main_colors: parseJson(raw.mainColors, {}),
    exif: parseJson(raw.exif || '{}', {}),
    embedding: raw.clipEmbedding ? {
      clip: parseJson(raw.clipEmbedding, []),
      description: parseJson(raw.descriptionEmbedding || '[]', []),
    } : undefined,
  };
}

/**
 * Safely parse JSON
 */
function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ============================================================================
// OFFLINE / MOCK MODE
// ============================================================================

let mockMode = false;
let mockData: ImageMetadata[] = [];

/**
 * Enable mock mode for development/offline use
 */
export function enableMockMode(images: ImageMetadata[]): void {
  mockMode = true;
  mockData = images;
}

/**
 * Disable mock mode
 */
export function disableMockMode(): void {
  mockMode = false;
  mockData = [];
}

/**
 * Check if running in mock mode
 */
export function isMockMode(): boolean {
  return mockMode;
}

// Override functions when in mock mode
const originalListImages = listImages;
const originalSearchImages = searchImages;

export const listImagesMock = async (): Promise<ListImagesResponse> => {
  if (mockMode) {
    return { items: mockData };
  }
  return originalListImages();
};

export const searchImagesMock = async (
  query: string,
  options: { limit?: number; filters?: SearchFilters } = {}
): Promise<SearchResult[]> => {
  if (mockMode) {
    // Simple mock search
    const queryLower = query.toLowerCase();
    return mockData
      .filter((img) => 
        img.description.toLowerCase().includes(queryLower) ||
        img.main_subject.toLowerCase().includes(queryLower) ||
        Object.values(img.tags).flat().some((t) => t.toLowerCase().includes(queryLower))
      )
      .slice(0, options.limit || 20)
      .map((img) => ({
        imageId: img.id,
        score: 1,
        matchedFields: ['mock'],
      }));
  }
  return originalSearchImages(query, options);
};
