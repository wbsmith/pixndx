import { useCallback, useMemo } from 'react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { LayoutType, LayoutConfig, ClusterConfig } from '@/types/gallery';

interface LayoutInfo {
  type: LayoutType;
  label: string;
  description: string;
  icon: string;
  requiresSimilarity: boolean;
  supportsFiltering: boolean;
}

const LAYOUT_INFO: Record<LayoutType, LayoutInfo> = {
  grid: {
    type: 'grid',
    label: 'Grid',
    description: 'Traditional responsive grid layout',
    icon: 'grid',
    requiresSimilarity: false,
    supportsFiltering: true,
  },
  network: {
    type: 'network',
    label: 'Network',
    description: 'Force-directed graph showing image relationships',
    icon: 'network',
    requiresSimilarity: true,
    supportsFiltering: true,
  },
  colorWheel: {
    type: 'colorWheel',
    label: 'Color Wheel',
    description: 'Images arranged by dominant color on a color wheel',
    icon: 'palette',
    requiresSimilarity: false,
    supportsFiltering: true,
  },
  moodSpectrum: {
    type: 'moodSpectrum',
    label: 'Mood Spectrum',
    description: 'Images arranged by mood and energy level',
    icon: 'activity',
    requiresSimilarity: false,
    supportsFiltering: true,
  },
  timeline: {
    type: 'timeline',
    label: 'Timeline',
    description: 'Chronological layout based on capture date',
    icon: 'calendar',
    requiresSimilarity: false,
    supportsFiltering: true,
  },
  cluster: {
    type: 'cluster',
    label: 'Clusters',
    description: 'Images grouped by visual or semantic similarity',
    icon: 'layers',
    requiresSimilarity: true,
    supportsFiltering: true,
  },
};

interface UseLayoutReturn {
  // Current state
  currentLayout: LayoutType;
  layoutConfig: LayoutConfig;
  layoutInfo: LayoutInfo;
  
  // Available layouts
  availableLayouts: LayoutInfo[];
  
  // Actions
  setLayout: (type: LayoutType) => void;
  setLayoutConfig: (config: Partial<LayoutConfig>) => void;
  setClusterConfig: (config: Partial<ClusterConfig>) => void;
  
  // Helpers
  isCurrentLayout: (type: LayoutType) => boolean;
  getLayoutInfo: (type: LayoutType) => LayoutInfo;
}

/**
 * Hook for managing layout state and configuration
 */
export function useLayout(): UseLayoutReturn {
  const { layout, setLayout: storeSetLayout } = useGalleryStore();
  
  const currentLayout = layout.type;
  const layoutInfo = LAYOUT_INFO[currentLayout];
  const availableLayouts = Object.values(LAYOUT_INFO);
  
  const setLayout = useCallback((type: LayoutType) => {
    storeSetLayout({ ...layout, type });
  }, [layout, storeSetLayout]);
  
  const setLayoutConfig = useCallback((config: Partial<LayoutConfig>) => {
    storeSetLayout({ ...layout, ...config });
  }, [layout, storeSetLayout]);
  
  const setClusterConfig = useCallback((config: Partial<ClusterConfig>) => {
    storeSetLayout({
      ...layout,
      clustering: { ...layout.clustering, ...config } as ClusterConfig,
    });
  }, [layout, storeSetLayout]);
  
  const isCurrentLayout = useCallback((type: LayoutType) => {
    return currentLayout === type;
  }, [currentLayout]);
  
  const getLayoutInfo = useCallback((type: LayoutType) => {
    return LAYOUT_INFO[type];
  }, []);
  
  return {
    currentLayout,
    layoutConfig: layout,
    layoutInfo,
    availableLayouts,
    setLayout,
    setLayoutConfig,
    setClusterConfig,
    isCurrentLayout,
    getLayoutInfo,
  };
}

/**
 * Hook for layout-specific computations
 */
export function useLayoutComputation(layoutType: LayoutType) {
  const { filteredImages, edges } = useGalleryStore();
  
  const computation = useMemo(() => {
    switch (layoutType) {
      case 'network':
        return computeNetworkLayout(filteredImages.length, edges.length);
      case 'colorWheel':
        return computeColorWheelLayout(filteredImages.length);
      case 'moodSpectrum':
        return computeMoodSpectrumLayout(filteredImages.length);
      case 'cluster':
        return computeClusterLayout(filteredImages.length, edges.length);
      case 'timeline':
        return computeTimelineLayout(filteredImages.length);
      default:
        return computeGridLayout(filteredImages.length);
    }
  }, [layoutType, filteredImages.length, edges.length]);
  
  return computation;
}

// Layout computation helpers
function computeGridLayout(imageCount: number) {
  const columns = imageCount <= 4 ? 2 : imageCount <= 9 ? 3 : 4;
  const rows = Math.ceil(imageCount / columns);
  return {
    type: 'grid' as const,
    columns,
    rows,
    estimatedHeight: rows * 250,
    complexity: 'low',
  };
}

function computeNetworkLayout(imageCount: number, edgeCount: number) {
  const density = edgeCount / (imageCount * (imageCount - 1) / 2);
  return {
    type: 'network' as const,
    nodeCount: imageCount,
    edgeCount,
    density,
    estimatedIterations: Math.min(300, imageCount * 10),
    complexity: density > 0.5 ? 'high' : density > 0.2 ? 'medium' : 'low',
  };
}

function computeColorWheelLayout(imageCount: number) {
  const rings = Math.ceil(imageCount / 12);
  return {
    type: 'colorWheel' as const,
    rings,
    imagesPerRing: Math.ceil(imageCount / rings),
    estimatedRadius: 200 + rings * 80,
    complexity: 'low',
  };
}

function computeMoodSpectrumLayout(imageCount: number) {
  return {
    type: 'moodSpectrum' as const,
    width: Math.max(800, imageCount * 60),
    estimatedOverlap: imageCount > 20 ? 'high' : 'low',
    complexity: 'low',
  };
}

function computeClusterLayout(imageCount: number, edgeCount: number) {
  const suggestedClusters = Math.max(2, Math.min(8, Math.floor(Math.sqrt(imageCount))));
  return {
    type: 'cluster' as const,
    suggestedClusters,
    averageClusterSize: Math.ceil(imageCount / suggestedClusters),
    complexity: imageCount > 50 ? 'high' : 'medium',
  };
}

function computeTimelineLayout(imageCount: number) {
  return {
    type: 'timeline' as const,
    estimatedWidth: imageCount * 100,
    groupingOptions: ['day', 'week', 'month', 'year'],
    complexity: 'low',
  };
}

/**
 * Hook for responsive layout adjustments
 */
export function useResponsiveLayout() {
  const getColumnsForWidth = useCallback((width: number) => {
    if (width < 640) return 2;
    if (width < 768) return 3;
    if (width < 1024) return 4;
    if (width < 1280) return 5;
    return 6;
  }, []);
  
  const getNodeRadiusForCount = useCallback((count: number, containerWidth: number) => {
    const baseRadius = 32;
    const minRadius = 16;
    const scaleFactor = Math.sqrt(containerWidth / 800);
    const countFactor = Math.sqrt(50 / Math.max(count, 1));
    return Math.max(minRadius, baseRadius * scaleFactor * countFactor);
  }, []);
  
  return {
    getColumnsForWidth,
    getNodeRadiusForCount,
  };
}
