import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';
import { getDominantColor, getColorPalette } from './vectors';

// Types
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: ImageMetadata;
  metadata?: Record<string, unknown>;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  bounds: { width: number; height: number };
  metadata?: Record<string, unknown>;
}

export interface LayoutOptions {
  width: number;
  height: number;
  padding?: number;
  nodeSize?: number;
}

// ============================================================================
// GRID LAYOUT
// ============================================================================

export interface GridLayoutOptions extends LayoutOptions {
  columns?: number;
  gap?: number;
  aspectRatio?: number;
}

/**
 * Simple responsive grid layout
 */
export function gridLayout(
  images: ImageMetadata[],
  options: GridLayoutOptions
): LayoutResult {
  const {
    width,
    height,
    padding = 20,
    columns = Math.ceil(Math.sqrt(images.length)),
    gap = 16,
    aspectRatio = 3 / 2,
  } = options;

  const availableWidth = width - padding * 2;
  const nodeWidth = (availableWidth - gap * (columns - 1)) / columns;
  const nodeHeight = nodeWidth / aspectRatio;

  const nodes: LayoutNode[] = images.map((image, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);

    return {
      id: image.id,
      x: padding + col * (nodeWidth + gap),
      y: padding + row * (nodeHeight + gap),
      width: nodeWidth,
      height: nodeHeight,
      image,
    };
  });

  const rows = Math.ceil(images.length / columns);
  const totalHeight = padding * 2 + rows * nodeHeight + (rows - 1) * gap;

  return {
    nodes,
    bounds: { width, height: Math.max(height, totalHeight) },
  };
}

// ============================================================================
// MASONRY LAYOUT
// ============================================================================

export interface MasonryLayoutOptions extends LayoutOptions {
  columns?: number;
  gap?: number;
}

/**
 * Pinterest-style masonry layout
 */
export function masonryLayout(
  images: ImageMetadata[],
  options: MasonryLayoutOptions
): LayoutResult {
  const {
    width,
    padding = 20,
    columns = 4,
    gap = 16,
  } = options;

  const availableWidth = width - padding * 2;
  const columnWidth = (availableWidth - gap * (columns - 1)) / columns;

  // Track height of each column
  const columnHeights = Array(columns).fill(padding);

  const nodes: LayoutNode[] = images.map((image) => {
    // Find shortest column
    const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));

    // Calculate image height based on aspect ratio from EXIF or default
    const imgWidth = image.exif?.ImageWidth || 1920;
    const imgHeight = image.exif?.ImageHeight || 1280;
    const aspectRatio = imgWidth / imgHeight;
    const nodeHeight = columnWidth / aspectRatio;

    const node: LayoutNode = {
      id: image.id,
      x: padding + shortestColumn * (columnWidth + gap),
      y: columnHeights[shortestColumn],
      width: columnWidth,
      height: nodeHeight,
      image,
    };

    // Update column height
    columnHeights[shortestColumn] += nodeHeight + gap;

    return node;
  });

  const maxHeight = Math.max(...columnHeights);

  return {
    nodes,
    bounds: { width, height: maxHeight + padding },
  };
}

// ============================================================================
// FORCE-DIRECTED LAYOUT
// ============================================================================

export interface ForceLayoutOptions extends LayoutOptions {
  edges: SimilarityEdge[];
  iterations?: number;
  repulsion?: number;
  attraction?: number;
  damping?: number;
}

/**
 * Force-directed graph layout using Fruchterman-Reingold algorithm
 */
export function forceDirectedLayout(
  images: ImageMetadata[],
  options: ForceLayoutOptions
): LayoutResult {
  const {
    width,
    height,
    padding = 50,
    nodeSize = 64,
    edges,
    iterations = 100,
    repulsion = 10000,
    attraction = 0.1,
    damping = 0.85,
  } = options;

  const area = (width - padding * 2) * (height - padding * 2);
  const k = Math.sqrt(area / images.length);

  // Initialize positions randomly
  const positions: Map<string, { x: number; y: number; vx: number; vy: number }> = new Map();

  images.forEach((img) => {
    positions.set(img.id, {
      x: padding + Math.random() * (width - padding * 2),
      y: padding + Math.random() * (height - padding * 2),
      vx: 0,
      vy: 0,
    });
  });

  // Create edge lookup
  const edgeMap = new Map<string, SimilarityEdge[]>();
  edges.forEach((edge) => {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
    if (!edgeMap.has(edge.target)) edgeMap.set(edge.target, []);
    edgeMap.get(edge.source)!.push(edge);
    edgeMap.get(edge.target)!.push(edge);
  });

  // Iterate
  let temperature = width / 10;
  const coolingFactor = 0.95;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsive forces between all pairs
    images.forEach((img1) => {
      const pos1 = positions.get(img1.id)!;
      let fx = 0;
      let fy = 0;

      images.forEach((img2) => {
        if (img1.id === img2.id) return;

        const pos2 = positions.get(img2.id)!;
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

        const force = repulsion / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      });

      pos1.vx += fx;
      pos1.vy += fy;
    });

    // Attractive forces along edges
    edges.forEach((edge) => {
      const pos1 = positions.get(edge.source);
      const pos2 = positions.get(edge.target);
      if (!pos1 || !pos2) return;

      const dx = pos2.x - pos1.x;
      const dy = pos2.y - pos1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

      const force = (dist * dist) / k * attraction * edge.weight;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      pos1.vx += fx;
      pos1.vy += fy;
      pos2.vx -= fx;
      pos2.vy -= fy;
    });

    // Apply forces with temperature limiting
    positions.forEach((pos) => {
      const velocity = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy) || 0.01;
      const cappedVelocity = Math.min(velocity, temperature);

      pos.x += (pos.vx / velocity) * cappedVelocity;
      pos.y += (pos.vy / velocity) * cappedVelocity;

      // Keep within bounds
      pos.x = Math.max(padding, Math.min(width - padding, pos.x));
      pos.y = Math.max(padding, Math.min(height - padding, pos.y));

      // Apply damping
      pos.vx *= damping;
      pos.vy *= damping;
    });

    // Cool down
    temperature *= coolingFactor;
  }

  // Create nodes
  const nodes: LayoutNode[] = images.map((image) => {
    const pos = positions.get(image.id)!;
    return {
      id: image.id,
      x: pos.x - nodeSize / 2,
      y: pos.y - nodeSize / 2,
      width: nodeSize,
      height: nodeSize,
      image,
    };
  });

  return {
    nodes,
    bounds: { width, height },
  };
}

// ============================================================================
// RADIAL LAYOUT (COLOR WHEEL)
// ============================================================================

export interface RadialLayoutOptions extends LayoutOptions {
  centerX?: number;
  centerY?: number;
  innerRadius?: number;
  outerRadius?: number;
  sortBy?: 'hue' | 'saturation' | 'brightness';
}

/**
 * Radial layout arranged by color hue
 */
export function radialColorLayout(
  images: ImageMetadata[],
  options: RadialLayoutOptions
): LayoutResult {
  const {
    width,
    height,
    nodeSize = 48,
    centerX = width / 2,
    centerY = height / 2,
    innerRadius = 100,
    outerRadius = Math.min(width, height) / 2 - 50,
    sortBy = 'hue',
  } = options;

  // Calculate color properties for each image
  const imageColors = images.map((image) => {
    const hex = getDominantColor(image);
    const hsl = hexToHsl(hex);
    return {
      image,
      hue: hsl.h,
      saturation: hsl.s,
      lightness: hsl.l,
    };
  });

  // Sort by selected property
  imageColors.sort((a, b) => {
    switch (sortBy) {
      case 'hue':
        return a.hue - b.hue;
      case 'saturation':
        return b.saturation - a.saturation;
      case 'brightness':
        return b.lightness - a.lightness;
    }
  });

  // Distribute into rings based on saturation
  const highSat = imageColors.filter((c) => c.saturation > 0.5);
  const lowSat = imageColors.filter((c) => c.saturation <= 0.5);

  const nodes: LayoutNode[] = [];

  // Place high saturation images in outer ring
  highSat.forEach((item, i) => {
    const angle = (item.hue / 360) * Math.PI * 2 - Math.PI / 2;
    const radius = outerRadius - (i % 2) * nodeSize * 1.5;

    nodes.push({
      id: item.image.id,
      x: centerX + Math.cos(angle) * radius - nodeSize / 2,
      y: centerY + Math.sin(angle) * radius - nodeSize / 2,
      width: nodeSize,
      height: nodeSize,
      image: item.image,
      metadata: { hue: item.hue, saturation: item.saturation },
    });
  });

  // Place low saturation images in inner ring
  lowSat.forEach((item, i) => {
    const angle = (i / lowSat.length) * Math.PI * 2 - Math.PI / 2;
    const radius = innerRadius + (i % 2) * nodeSize;

    nodes.push({
      id: item.image.id,
      x: centerX + Math.cos(angle) * radius - nodeSize / 2,
      y: centerY + Math.sin(angle) * radius - nodeSize / 2,
      width: nodeSize,
      height: nodeSize,
      image: item.image,
      metadata: { hue: item.hue, saturation: item.saturation },
    });
  });

  return {
    nodes,
    bounds: { width, height },
  };
}

// ============================================================================
// LINEAR SPECTRUM LAYOUT (MOOD)
// ============================================================================

export interface SpectrumLayoutOptions extends LayoutOptions {
  attribute: 'warmth' | 'energy' | 'brightness';
  vertical?: boolean;
}

/**
 * Linear spectrum layout based on computed attribute
 */
export function spectrumLayout(
  images: ImageMetadata[],
  options: SpectrumLayoutOptions
): LayoutResult {
  const {
    width,
    height,
    padding = 40,
    nodeSize = 64,
    attribute,
    vertical = false,
  } = options;

  // Calculate attribute value for each image
  const imageValues = images.map((image) => ({
    image,
    value: calculateAttribute(image, attribute),
  }));

  // Sort by value
  imageValues.sort((a, b) => a.value - b.value);

  const availableLength = vertical
    ? height - padding * 2
    : width - padding * 2;

  const nodes: LayoutNode[] = imageValues.map((item, i) => {
    const position = (item.value * availableLength) + padding;
    const offset = (i % 3 - 1) * nodeSize * 0.8; // Stagger to avoid overlap

    return {
      id: item.image.id,
      x: vertical ? width / 2 + offset - nodeSize / 2 : position - nodeSize / 2,
      y: vertical ? position - nodeSize / 2 : height / 2 + offset - nodeSize / 2,
      width: nodeSize,
      height: nodeSize,
      image: item.image,
      metadata: { [attribute]: item.value },
    };
  });

  return {
    nodes,
    bounds: { width, height },
  };
}

/**
 * Calculate attribute value (0-1) for an image
 */
function calculateAttribute(
  image: ImageMetadata,
  attribute: 'warmth' | 'energy' | 'brightness'
): number {
  switch (attribute) {
    case 'warmth': {
      const hex = getDominantColor(image);
      const hsl = hexToHsl(hex);
      // Warm colors: red (0) to yellow (60)
      // Cool colors: cyan (180) to blue (240)
      if (hsl.h <= 60 || hsl.h >= 300) {
        return 0.5 + (hsl.h <= 60 ? hsl.h : 360 - hsl.h) / 120 * 0.5;
      } else if (hsl.h >= 180 && hsl.h <= 240) {
        return 0.5 - (hsl.h - 180) / 120 * 0.5;
      }
      return 0.5;
    }

    case 'energy': {
      const moodWords = image.mood.toLowerCase();
      const energeticWords = ['dynamic', 'vibrant', 'bold', 'dramatic', 'energetic', 'exciting'];
      const calmWords = ['calm', 'peaceful', 'serene', 'tranquil', 'quiet', 'gentle'];

      let score = 0.5;
      energeticWords.forEach((w) => {
        if (moodWords.includes(w)) score += 0.1;
      });
      calmWords.forEach((w) => {
        if (moodWords.includes(w)) score -= 0.1;
      });

      return Math.max(0, Math.min(1, score));
    }

    case 'brightness': {
      const hex = getDominantColor(image);
      const hsl = hexToHsl(hex);
      return hsl.l;
    }
  }
}

// ============================================================================
// TIMELINE LAYOUT
// ============================================================================

export interface TimelineLayoutOptions extends LayoutOptions {
  groupBy: 'day' | 'week' | 'month' | 'year';
  direction?: 'horizontal' | 'vertical';
}

/**
 * Timeline layout grouped by date
 */
export function timelineLayout(
  images: ImageMetadata[],
  options: TimelineLayoutOptions
): LayoutResult {
  const {
    width,
    height,
    padding = 40,
    nodeSize = 64,
    groupBy,
    direction = 'horizontal',
  } = options;

  // Parse dates and group
  const imageWithDates = images
    .map((image) => ({
      image,
      date: parseExifDate(image.exif?.DateTimeOriginal),
    }))
    .filter((item) => item.date !== null)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());

  // Group by time period
  const groups = new Map<string, ImageMetadata[]>();
  imageWithDates.forEach(({ image, date }) => {
    const key = formatDateKey(date!, groupBy);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(image);
  });

  const groupArray = Array.from(groups.entries());
  const groupCount = groupArray.length;

  const nodes: LayoutNode[] = [];
  const groupSpacing = direction === 'horizontal'
    ? (width - padding * 2) / Math.max(1, groupCount)
    : (height - padding * 2) / Math.max(1, groupCount);

  groupArray.forEach(([key, groupImages], groupIndex) => {
    const groupCenter = padding + groupSpacing * (groupIndex + 0.5);

    groupImages.forEach((image, imgIndex) => {
      const offset = (imgIndex % 3 - 1) * nodeSize * 0.6;

      nodes.push({
        id: image.id,
        x: direction === 'horizontal'
          ? groupCenter - nodeSize / 2
          : width / 2 + offset - nodeSize / 2,
        y: direction === 'horizontal'
          ? height / 2 + offset - nodeSize / 2
          : groupCenter - nodeSize / 2,
        width: nodeSize,
        height: nodeSize,
        image,
        metadata: { group: key, index: imgIndex },
      });
    });
  });

  return {
    nodes,
    bounds: { width, height },
    metadata: {
      groups: groupArray.map(([key, imgs]) => ({ key, count: imgs.length })),
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert hex to HSL
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 0.5 };

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    case b:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h: h * 360, s, l };
}

/**
 * Parse EXIF date string
 */
function parseExifDate(exifDate?: string): Date | null {
  if (!exifDate) return null;

  try {
    // EXIF format: "YYYY:MM:DD HH:MM:SS"
    const isoDate = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const date = new Date(isoDate);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Format date into grouping key
 */
function formatDateKey(date: Date, groupBy: 'day' | 'week' | 'month' | 'year'): string {
  switch (groupBy) {
    case 'day':
      return date.toISOString().split('T')[0];
    case 'week': {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      return `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    case 'month':
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'year':
      return date.getFullYear().toString();
  }
}

/**
 * Pack circles into a container (simple algorithm)
 */
export function packCircles(
  radii: number[],
  containerWidth: number,
  containerHeight: number
): Array<{ x: number; y: number; radius: number }> {
  const circles: Array<{ x: number; y: number; radius: number }> = [];

  radii.forEach((radius) => {
    let placed = false;
    let attempts = 0;
    const maxAttempts = 1000;

    while (!placed && attempts < maxAttempts) {
      const x = radius + Math.random() * (containerWidth - radius * 2);
      const y = radius + Math.random() * (containerHeight - radius * 2);

      const overlaps = circles.some((c) => {
        const dx = c.x - x;
        const dy = c.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist < c.radius + radius + 5;
      });

      if (!overlaps) {
        circles.push({ x, y, radius });
        placed = true;
      }

      attempts++;
    }

    if (!placed) {
      // Force placement at center
      circles.push({ x: containerWidth / 2, y: containerHeight / 2, radius });
    }
  });

  return circles;
}
