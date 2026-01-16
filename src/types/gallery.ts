// CLIP neighbor - precomputed similar image with both similarity metrics
export interface ClipNeighbor {
  id: string;
  clipWeight: number;      // 0-1 CLIP embedding cosine similarity
  compositeWeight: number; // 0-1 blended CLIP + metadata similarity
}

// Core image types - matches your JSON metadata structure
export interface ImageMetadata {
  // Generated/computed fields
  id: string;
  filename: string;
  urls: {
    small: string;
    medium: string;
    full: string;
  };
  
  // Direct from your JSON
  description: string;
  tags: Record<string, string[]>;  // e.g., { landscape: ["coastal", "sunset"], weather: ["clouds"] }
  mood: string;
  main_subject: string;
  main_colors: Record<string, string>;  // e.g., { orange: "#FFA500", dark_blue: "#000080" }
  exif: ExifData;
  
  // Precomputed CLIP neighbors (from preprocessing/compute_neighbors.py)
  // Used for CLIP-based edge computation at runtime
  clipNeighbors?: ClipNeighbor[];
  
  // Precomputed layout data (from preprocessing/cluster_layout.py)
  // UMAP 2D position for initial graph layout
  layoutPosition?: {
    x: number;
    y: number;
  };
  // HDBSCAN cluster assignment (-1 = noise/unclustered)
  cluster?: number;
  // Louvain community assignment
  community?: number;
  // Probability of cluster membership (0-1)
  clusterProbability?: number;
  
  // Optional computed fields for similarity (legacy)
  embedding?: {
    clip: number[];
    description: number[];
  };
  
  // Rating fields
  avgRating?: number;        // Average rating 0-5
  ratingCount?: number;      // Number of ratings
  userRating?: number;       // Current user's rating (if any)
}

// Your EXIF structure
export interface ExifData {
  SourceFile?: string;
  ExifToolVersion?: number;
  FileName?: string;
  Directory?: string;
  FileSize?: number;
  FileModifyDate?: string;
  FileAccessDate?: string;
  FileInodeChangeDate?: string;
  FilePermissions?: number;
  FileType?: string;
  FileTypeExtension?: string;
  MIMEType?: string;
  JFIFVersion?: string;
  ExifByteOrder?: string;
  
  // Common camera EXIF fields
  Make?: string;
  Model?: string;
  Orientation?: number;
  XResolution?: number;
  YResolution?: number;
  ResolutionUnit?: number;
  Software?: string;
  ModifyDate?: string;
  ExposureTime?: string | number;
  FNumber?: number;
  ExposureProgram?: number;
  ISO?: number;
  DateTimeOriginal?: string;
  CreateDate?: string;
  ShutterSpeedValue?: string | number;
  ApertureValue?: number;
  ExposureCompensation?: number;
  MaxApertureValue?: number;
  MeteringMode?: number;
  LightSource?: number;
  Flash?: number;
  FocalLength?: string | number;
  ImageWidth?: number;
  ImageHeight?: number;
  LensModel?: string;
  LensInfo?: string;
  
  // Allow any other EXIF fields
  [key: string]: unknown;
}

// Similarity and layout types
// 'clip' uses precomputed CLIP embedding similarity
// 'composite' uses precomputed blended CLIP + metadata similarity
export type SimilarityMode = 'clip' | 'composite';

export interface SimilarityConfig {
  mode: SimilarityMode;
  thresholdMin: number;      // 0-1, minimum edge weight to include
  thresholdMax: number;      // 0-1, maximum edge weight to include
  maxEdgesPerNode: number;   // Maximum connections per image
}

export interface SimilarityEdge {
  source: string;
  target: string;
  weight: number;
  mode: SimilarityMode;
}

export interface GraphNode {
  id: string;
  image: ImageMetadata;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

// Layout types
export type LayoutType =
  | 'grid'
  | 'network'
  | 'colorWheel'
  | 'moodSpectrum'
  | 'timeline';

export interface LayoutConfig {
  type: LayoutType;
  similarity?: SimilarityConfig;
  clustering?: ClusterConfig;
}

export interface ClusterConfig {
  algorithm: 'kmeans' | 'dbscan';
  attribute: 'tags' | 'colors' | 'mood' | 'embedding';
  numClusters?: number;
  epsilon?: number;
}

// Search types
export interface SearchQuery {
  text: string;
  filters?: SearchFilters;
}

export interface SearchFilters {
  tags?: string[];
  colors?: string[];
  mood?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  camera?: string[];
}

export interface SearchResult {
  image: ImageMetadata;
  score: number;
  matchedFields: string[];
}

// UI State types
export interface GalleryState {
  images: ImageMetadata[];
  selectedImage: ImageMetadata | null;
  layout: LayoutConfig;
  search: SearchQuery;
  loading: boolean;
  error: string | null;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

// Helper to extract dimensions from EXIF
export function getDimensions(metadata: ImageMetadata): { width: number; height: number; aspectRatio: number } {
  const width = metadata.exif?.ImageWidth || 1920;
  const height = metadata.exif?.ImageHeight || 1080;
  return {
    width,
    height,
    aspectRatio: width / height,
  };
}

// Helper to get all tags as flat array
export function getAllTagsFromImage(metadata: ImageMetadata): string[] {
  return Object.values(metadata.tags).flat();
}

// Helper to get color palette from main_colors
export function getColorPalette(metadata: ImageMetadata): string[] {
  return Object.values(metadata.main_colors);
}

// Helper to get dominant color (first in main_colors)
export function getDominantColor(metadata: ImageMetadata): string {
  const colors = Object.values(metadata.main_colors);
  return colors[0] || '#808080';
}

// Helper to get short description (first sentence)
export function getShortDescription(metadata: ImageMetadata): string {
  return metadata.main_subject || metadata.description.split('.')[0];
}

// Color analysis types
export interface ColorAnalysis {
  hue: number;
  saturation: number;
  lightness: number;
  warmth: number;
  dominantFamily: ColorFamily;
}

export type ColorFamily =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'magenta'
  | 'neutral';

// Animation types
export interface TransitionConfig {
  duration: number;
  easing: string;
  stagger?: number;
}
