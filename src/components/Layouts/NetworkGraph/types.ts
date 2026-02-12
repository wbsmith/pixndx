/**
 * Shared types for the unified network graph component.
 */

import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';
import type { ForceSettings, ColorMode } from '@/stores/galleryStore';
import type { LODResult } from '@/lib/graph/communityDetection';

// =============================================================================
// ALGORITHM TYPES
// =============================================================================

export type AlgorithmType = 'd3' | 'forceAtlas2' | 'sigma';

/**
 * Position in 2D space.
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Graph node with position and metadata.
 */
export interface GraphNode {
  id: string;
  image: ImageMetadata;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  sizeMultiplier?: number;  // LOD: larger for representatives
}

/**
 * Graph link with weight.
 */
export interface GraphLink {
  source: GraphNode | string;
  target: GraphNode | string;
  weight: number;
}

/**
 * Configuration for layout algorithms.
 */
export interface LayoutConfig {
  width: number;
  height: number;
  forceSettings: ForceSettings;
  hasLayoutData?: boolean;  // Whether images have UMAP positions
}

/**
 * Callback for position updates during animation.
 */
export type PositionUpdateCallback = (nodes: GraphNode[]) => void;

/**
 * Callback for layout completion.
 */
export type LayoutCompleteCallback = () => void;

/**
 * Callback for stability detection.
 */
export type StabilityCallback = (isStable: boolean) => void;

/**
 * Callback for instability detection (numerical overflow).
 */
export type InstabilityCallback = () => void;

/**
 * Interface for layout algorithms.
 * All algorithms must implement these methods.
 */
export interface LayoutAlgorithm {
  /**
   * Initialize the algorithm with graph data.
   */
  initialize(
    nodes: GraphNode[],
    links: GraphLink[],
    config: LayoutConfig
  ): void;

  /**
   * Start the layout computation/animation.
   */
  start(): void;

  /**
   * Stop the layout computation/animation.
   */
  stop(): void;

  /**
   * Clean up resources (web workers, etc).
   */
  destroy(): void;

  /**
   * Check if the algorithm is currently running.
   */
  isRunning(): boolean;

  /**
   * Get current node positions.
   */
  getPositions(): Map<string, Position>;

  /**
   * Reheat the simulation (restart from current positions).
   */
  reheat?(): void;

  /**
   * Fix a node at a position (for dragging).
   */
  fixNode?(nodeId: string, x: number, y: number): void;

  /**
   * Release a fixed node.
   */
  releaseNode?(nodeId: string): void;

  /**
   * Register callback for position updates.
   */
  onPositionUpdate(callback: PositionUpdateCallback): void;

  /**
   * Register callback for layout completion.
   */
  onComplete(callback: LayoutCompleteCallback): void;

  /**
   * Register callback for stability changes.
   */
  onStabilityChange?(callback: StabilityCallback): void;

  /**
   * Register callback for numerical instability.
   */
  onInstability?(callback: InstabilityCallback): void;
}

// =============================================================================
// RENDERER TYPES
// =============================================================================

/**
 * Props for renderer components.
 */
export interface RendererProps {
  nodes: GraphNode[];
  links: GraphLink[];
  colorMode: ColorMode;
  signedUrls: Map<string, string>;
  lodResult: LODResult | null;
  lodSettings: {
    enabled: boolean;
    nodeThreshold: number;
    zoomThreshold: number;
  };
  onNodeClick: (image: ImageMetadata) => void;
  onZoomChange?: (zoom: number) => void;
  algorithm?: LayoutAlgorithm;  // For animated renderers
}

// =============================================================================
// COMPONENT PROPS
// =============================================================================

/**
 * Props for the unified NetworkGraph component.
 */
export interface NetworkGraphProps {
  algorithm?: AlgorithmType;
}

// =============================================================================
// GRAPH DATA
// =============================================================================

/**
 * Build graph nodes from images.
 * Note: sizeMultiplier is always 1 here - dynamic sizing for LOD is applied in the renderer.
 */
export function buildNodes(
  images: ImageMetadata[],
  width: number,
  height: number,
  _lodResult: LODResult | null,
  _lodEnabled: boolean,
  _zoomThreshold: number
): GraphNode[] {
  // Deduplicate images by ID
  const seenIds = new Set<string>();
  const uniqueImages = images.filter(img => {
    if (seenIds.has(img.id)) return false;
    seenIds.add(img.id);
    return true;
  });

  return uniqueImages.map((img, i) => {
    // Use UMAP position if available
    if (img.layoutPosition) {
      const scale = Math.min(width, height) / 1200;
      return {
        id: img.id,
        image: img,
        x: width / 2 + (img.layoutPosition.x - 500) * scale,
        y: height / 2 + (img.layoutPosition.y - 500) * scale,
        sizeMultiplier: 1,
      };
    }

    // Fallback: circular arrangement
    const angle = (i / uniqueImages.length) * 2 * Math.PI;
    const radius = Math.sqrt(uniqueImages.length) * 15 + Math.random() * 100;
    return {
      id: img.id,
      image: img,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      sizeMultiplier: 1,
    };
  });
}

/**
 * Build graph links from edges.
 */
export function buildLinks(
  edges: SimilarityEdge[],
  nodeMap: Map<string, GraphNode>
): GraphLink[] {
  return edges
    .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map(e => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      weight: e.weight,
    }));
}

