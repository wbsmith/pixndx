/**
 * Shared color utilities for network graph visualization.
 */

import type { ImageMetadata } from '@/types/gallery';
import type { ColorMode } from '@/stores/galleryStore';
import { getDominantColor } from '@/lib/similarity/vectors';

// Color palettes for different modes
export const CLUSTER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];

export const MOOD_COLORS: Record<string, string> = {
  peaceful: '#98D8C8',
  dramatic: '#E74C3C',
  mysterious: '#9B59B6',
  joyful: '#F1C40F',
  melancholic: '#3498DB',
  energetic: '#E67E22',
  serene: '#1ABC9C',
  tense: '#C0392B',
};

// Default colors
export const DEFAULT_NODE_COLOR = '#6366F2';  // stellar-violet
export const HIGHLIGHT_EDGE_COLOR = 'rgba(34, 211, 238, 0.9)';
export const DEFAULT_EDGE_COLOR = 'rgba(99, 112, 242, 0.4)';
export const DIM_EDGE_COLOR = 'rgba(99, 112, 242, 0.1)';
export const HOVER_RING_COLOR = 'rgba(34, 211, 238, 1)';

/**
 * Get node color based on image metadata and current color mode.
 */
export function getNodeColor(img: ImageMetadata, colorMode: ColorMode): string {
  switch (colorMode) {
    case 'uniform':
      return DEFAULT_NODE_COLOR;
    case 'cluster':
      return CLUSTER_COLORS[(img.cluster ?? 0) % CLUSTER_COLORS.length];
    case 'community':
      return CLUSTER_COLORS[(img.community ?? 0) % CLUSTER_COLORS.length];
    case 'mood':
      return MOOD_COLORS[img.mood?.toLowerCase() ?? ''] ?? DEFAULT_NODE_COLOR;
    case 'color':
      return getDominantColor(img);
    default:
      return DEFAULT_NODE_COLOR;
  }
}
