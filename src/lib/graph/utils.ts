/**
 * Shared utilities for network graph visualizations
 * Used by NetworkGraph, NetworkGraphScalable, and NetworkGraphSigma
 */

import type { ImageMetadata } from '@/types/gallery';

/**
 * Create a safe CSS ID from any string (removes special characters)
 * Essential for SVG clipPath/mask IDs which break with special chars
 */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Calculate optimal node radius based on node count
 * Smaller nodes for larger graphs to reduce visual clutter
 */
export function calculateNodeRadius(nodeCount: number, options?: {
  minRadius?: number;
  maxRadius?: number;
  scaleFactor?: number;
}): number {
  const { minRadius = 8, maxRadius = 30, scaleFactor = 400 } = options ?? {};
  return Math.max(minRadius, Math.min(maxRadius, scaleFactor / Math.sqrt(nodeCount)));
}

/**
 * Calculate initial zoom scale based on node count
 * Zoom out more for larger graphs
 */
export function calculateInitialZoom(nodeCount: number, options?: {
  minZoom?: number;
  maxZoom?: number;
  scaleFactor?: number;
}): number {
  const { minZoom = 0.05, maxZoom = 0.9, scaleFactor = 30 } = options ?? {};
  return Math.min(maxZoom, Math.max(minZoom, scaleFactor / Math.sqrt(nodeCount)));
}

/**
 * Get a dominant color from image metadata for node styling
 */
export function getDominantColorFromImage(image: ImageMetadata): string {
  // Try to get the first color from main_colors
  if (image.main_colors) {
    const colors = Object.values(image.main_colors);
    if (colors.length > 0) {
      return colors[0];
    }
  }
  // Fallback to a default color
  return '#6366f1';
}

/**
 * ForceAtlas2 settings calculator based on graph size
 */
export function getForceAtlas2Settings(nodeCount: number, customSettings?: Partial<ForceAtlas2Settings>): ForceAtlas2Settings {
  const defaults: ForceAtlas2Settings = {
    iterations: Math.min(500, Math.max(100, 1000 - nodeCount * 0.3)),
    barnesHutOptimize: nodeCount > 100,
    barnesHutTheta: nodeCount > 1000 ? 0.8 : 0.5,
    gravity: 1,
    scalingRatio: Math.max(1, Math.log10(nodeCount) * 5),
    strongGravityMode: true,
    slowDown: 1 + nodeCount / 500,
  };
  
  return { ...defaults, ...customSettings };
}

export interface ForceAtlas2Settings {
  iterations: number;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
  gravity: number;
  scalingRatio: number;
  strongGravityMode: boolean;
  slowDown: number;
}

/**
 * D3 force simulation settings calculator based on graph size
 */
export function getD3ForceSettings(nodeCount: number, hasLayoutData: boolean, customSettings?: Partial<D3ForceSettings>): D3ForceSettings {
  const nodeRadius = calculateNodeRadius(nodeCount);
  
  const defaults: D3ForceSettings = {
    chargeStrength: Math.max(-150, -40000 / nodeCount),
    linkDistance: 50,
    linkStrength: 0.5,
    centerStrength: 0.05,
    collisionRadius: nodeRadius + 2,
    collisionStrength: 0.6,
    alphaDecay: hasLayoutData ? 0.05 : 0.018,
    velocityDecay: hasLayoutData ? 0.6 : 0.4,
  };
  
  return { ...defaults, ...customSettings };
}

export interface D3ForceSettings {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
  centerStrength: number;
  collisionRadius: number;
  collisionStrength: number;
  alphaDecay: number;
  velocityDecay: number;
}

/**
 * Edge styling constants
 */
export const EDGE_STYLES = {
  default: {
    stroke: 'rgba(99, 112, 242, 0.4)',
    strokeWidthBase: 0.3,
    strokeWidthScale: 1.2,
    opacityBase: 0.08,
    opacityScale: 0.35,
  },
  highlighted: {
    stroke: 'rgba(34, 211, 238, 0.9)',
    opacity: 0.85,
  },
  dimmed: {
    stroke: 'rgba(99, 112, 242, 0.1)',
    opacity: 0.015,
  },
} as const;

/**
 * Calculate edge stroke width based on weight
 */
export function getEdgeStrokeWidth(weight: number): number {
  return EDGE_STYLES.default.strokeWidthBase + weight * EDGE_STYLES.default.strokeWidthScale;
}

/**
 * Calculate edge opacity based on weight
 */
export function getEdgeOpacity(weight: number): number {
  return EDGE_STYLES.default.opacityBase + weight * EDGE_STYLES.default.opacityScale;
}

