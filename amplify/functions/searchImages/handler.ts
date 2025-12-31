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
  exif: Record<string, any>;
  embedding?: {
    clip: number[];
    description: number[];
  };
}

interface SearchFilters {
  tags?: string[];
  mood?: string[];
  colors?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
}

interface SearchResult {
  imageId: string;
  score: number;
  matchedFields: string[];
}

/**
 * Main handler for searchImages query
 */
export const handler: Schema['searchImages']['functionHandler'] = async (event) => {
  const { query, limit = 20, filters } = event.arguments;
  
  try {
    // Load all image metadata from S3
    const images = await loadAllMetadata();
    
    // Parse filters if provided
    const parsedFilters: SearchFilters | undefined = filters 
      ? JSON.parse(JSON.stringify(filters)) 
      : undefined;
    
    // Score each image against the query
    const results = images
      .map((image) => scoreImage(image, query, parsedFilters))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return results;
  } catch (error) {
    console.error('Search error:', error);
    throw new Error(`Search failed: ${error}`);
  }
};

/**
 * Load all image metadata from S3
 */
async function loadAllMetadata(): Promise<ImageMetadata[]> {
  const images: ImageMetadata[] = [];
  
  // List all metadata files
  const listCommand = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: 'metadata/',
  });
  
  const listResponse = await s3Client.send(listCommand);
  
  if (!listResponse.Contents) {
    return images;
  }
  
  // Load each metadata file
  for (const object of listResponse.Contents) {
    if (!object.Key || !object.Key.endsWith('.json')) continue;
    
    try {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: object.Key,
      });
      
      const response = await s3Client.send(getCommand);
      const body = await streamToString(response.Body as Readable);
      const metadata = JSON.parse(body);
      
      // Extract ID from filename
      const id = object.Key.replace('metadata/', '').replace('.json', '');
      
      images.push({
        id,
        ...metadata,
      });
    } catch (error) {
      console.warn(`Failed to load metadata from ${object.Key}:`, error);
    }
  }
  
  return images;
}

/**
 * Score an image against a search query
 */
function scoreImage(
  image: ImageMetadata,
  query: string,
  filters?: SearchFilters
): SearchResult {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  
  let score = 0;
  const matchedFields: string[] = [];
  
  // Get all tags as flat array
  const allTags = Object.values(image.tags)
    .flat()
    .map((t) => t.toLowerCase());
  
  // Get tag category names
  const tagCategories = Object.keys(image.tags).map((c) => c.toLowerCase());
  
  // Score each query word
  for (const word of queryWords) {
    // Exact tag match (highest weight)
    if (allTags.includes(word)) {
      score += 3;
      if (!matchedFields.includes('tags')) matchedFields.push('tags');
    }
    // Tag category match
    else if (tagCategories.includes(word)) {
      score += 2.5;
      if (!matchedFields.includes('tags')) matchedFields.push('tags');
    }
    // Partial tag match
    else if (allTags.some((t) => t.includes(word))) {
      score += 2;
      if (!matchedFields.includes('tags')) matchedFields.push('tags');
    }
    // Main subject match
    else if (image.main_subject.toLowerCase().includes(word)) {
      score += 2.5;
      if (!matchedFields.includes('main_subject')) matchedFields.push('main_subject');
    }
    // Mood match
    else if (image.mood.toLowerCase().includes(word)) {
      score += 2;
      if (!matchedFields.includes('mood')) matchedFields.push('mood');
    }
    // Description match
    else if (image.description.toLowerCase().includes(word)) {
      score += 1.5;
      if (!matchedFields.includes('description')) matchedFields.push('description');
    }
    // Color name match
    else if (Object.keys(image.main_colors).some((c) => c.toLowerCase().includes(word))) {
      score += 2;
      if (!matchedFields.includes('main_colors')) matchedFields.push('main_colors');
    }
  }
  
  // Bonus for phrase match
  if (queryWords.length > 1) {
    if (image.description.toLowerCase().includes(queryLower)) {
      score += 2;
    }
    if (image.main_subject.toLowerCase().includes(queryLower)) {
      score += 2;
    }
  }
  
  // Apply filters
  if (filters) {
    // Tag filter
    if (filters.tags?.length) {
      const hasMatchingTag = filters.tags.some((filterTag) =>
        allTags.some((t) => t.includes(filterTag.toLowerCase()))
      );
      if (!hasMatchingTag) {
        score = 0;
      }
    }
    
    // Mood filter
    if (filters.mood?.length) {
      const hasMatchingMood = filters.mood.some((filterMood) =>
        image.mood.toLowerCase().includes(filterMood.toLowerCase())
      );
      if (!hasMatchingMood) {
        score = 0;
      }
    }
    
    // Color filter
    if (filters.colors?.length) {
      const colorNames = Object.keys(image.main_colors).map((c) => c.toLowerCase());
      const hasMatchingColor = filters.colors.some((filterColor) =>
        colorNames.some((c) => c.includes(filterColor.toLowerCase()))
      );
      if (!hasMatchingColor) {
        score = 0;
      }
    }
    
    // Date range filter
    if (filters.dateRange && image.exif?.DateTimeOriginal) {
      const imageDate = parseExifDate(image.exif.DateTimeOriginal);
      if (imageDate) {
        const start = new Date(filters.dateRange.start);
        const end = new Date(filters.dateRange.end);
        if (imageDate < start || imageDate > end) {
          score = 0;
        }
      }
    }
  }
  
  return {
    imageId: image.id,
    score,
    matchedFields,
  };
}

/**
 * Parse EXIF date format (YYYY:MM:DD HH:MM:SS)
 */
function parseExifDate(exifDate: string): Date | null {
  try {
    // Convert EXIF format to ISO format
    const isoDate = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    return new Date(isoDate);
  } catch {
    return null;
  }
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
