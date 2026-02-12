/**
 * Unified Network Graph Component
 *
 * Provides a single entry point for network graph visualization with
 * pluggable layout algorithms:
 * - d3: D3 force simulation with SVG rendering (animated)
 * - forceAtlas2: ForceAtlas2 via web worker with SVG rendering (animated)
 * - sigma: Sigma.js WebGL rendering for very large graphs
 *
 * All algorithms animate at runtime and share the same visual styling.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { getSignedImageUrl } from '@/lib/amplify';
import { IS_LOCAL_DEV } from '@/config';
import { detectCommunities, type LODResult } from '@/lib/graph/communityDetection';

import type { AlgorithmType, GraphNode, LayoutAlgorithm, NetworkGraphProps } from './types';
import { buildNodes, buildLinks } from './types';

import { D3ForceAlgorithm } from './algorithms/D3ForceAlgorithm';
import { ForceAtlas2Algorithm } from './algorithms/ForceAtlas2Algorithm';
import { SigmaAlgorithm } from './algorithms/SigmaAlgorithm';

import { D3SVGRenderer } from './renderers/D3SVGRenderer';
import { SigmaRenderer } from './renderers/SigmaRenderer';

import {
  StatsOverlay,
  UnstableWarning,
  NoEdgesWarning,
  EmptyState,
  ComputingOverlay,
  type GraphStats,
  type LayoutStatus,
} from './shared/StatsOverlay';

// Algorithm labels for UI
const ALGORITHM_LABELS: Record<AlgorithmType, string> = {
  d3: 'D3 Force Simulation',
  forceAtlas2: 'ForceAtlas2 (Web Worker)',
  sigma: 'Sigma.js WebGL',
};

export function NetworkGraph({ algorithm = 'd3' }: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const algorithmRef = useRef<LayoutAlgorithm | null>(null);

  // Store values
  const { filteredImages, edges, openModal, colorMode, graphLOD, forceSettings } = useGalleryStore();

  // Local state
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [lodResult, setLodResult] = useState<LODResult | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [layoutStatus, setLayoutStatus] = useState<LayoutStatus>('computing');
  const [stats, setStats] = useState<GraphStats>({ nodes: 0, edges: 0, communities: 0 });
  const [isReady, setIsReady] = useState(false);

  // Build graph data
  const { nodes, links } = useMemo(() => {
    if (filteredImages.length === 0) {
      return { nodes: [], links: [], nodeMap: new Map<string, GraphNode>() };
    }

    const n = buildNodes(
      filteredImages,
      dimensions.width,
      dimensions.height,
      lodResult,
      graphLOD.enabled,
      graphLOD.zoomThreshold
    );

    const map = new Map<string, GraphNode>();
    n.forEach(node => map.set(node.id, node));

    const l = buildLinks(edges, map);

    return { nodes: n, links: l };
  }, [filteredImages, edges, dimensions, lodResult, graphLOD.enabled, graphLOD.zoomThreshold]);

  // Check if images have UMAP layout data
  const hasLayoutData = useMemo(() => {
    return filteredImages.some(img => img.layoutPosition);
  }, [filteredImages]);

  // Responsive dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Fetch signed URLs for images
  useEffect(() => {
    if (filteredImages.length === 0) return;

    let cancelled = false;

    const fetchUrls = async () => {
      if (IS_LOCAL_DEV) {
        setIsReady(true);
        return;
      }

      console.log(`[NetworkGraph] Fetching signed URLs for ${filteredImages.length} images...`);

      const urls = new Map<string, string>();

      await Promise.all(
        filteredImages.map(async (img) => {
          try {
            const url = await getSignedImageUrl(img.urls.small, 'small');
            urls.set(img.id, url);
          } catch {
            urls.set(img.id, img.urls.small);
          }
        })
      );

      if (!cancelled) {
        setSignedUrls(urls);
        setIsReady(true);
        console.log(`[NetworkGraph] Signed URLs fetched`);
      }
    };

    fetchUrls();

    return () => {
      cancelled = true;
    };
  }, [filteredImages]);

  // Run community detection for LOD
  useEffect(() => {
    if (!graphLOD.enabled || filteredImages.length <= graphLOD.nodeThreshold) {
      setLodResult(null);
      setStats(s => ({ ...s, communities: 0 }));
      return;
    }

    console.log(`[NetworkGraph] Running community detection for LOD (resolution=${graphLOD.resolution})...`);
    const result = detectCommunities(filteredImages, graphLOD.resolution);
    setLodResult(result);
    setStats(s => ({ ...s, communities: result.communities.length }));
  }, [filteredImages, graphLOD.enabled, graphLOD.nodeThreshold, graphLOD.resolution]);

  // Initialize and run algorithm
  useEffect(() => {
    if (!isReady || nodes.length === 0) return;

    // Clean up previous algorithm
    if (algorithmRef.current) {
      algorithmRef.current.destroy();
      algorithmRef.current = null;
    }

    // Create new algorithm instance
    let algo: LayoutAlgorithm;

    switch (algorithm) {
      case 'forceAtlas2':
        algo = new ForceAtlas2Algorithm();
        break;
      case 'sigma':
        algo = new SigmaAlgorithm();
        break;
      case 'd3':
      default:
        algo = new D3ForceAlgorithm();
        break;
    }

    algorithmRef.current = algo;

    // Set up callbacks
    algo.onComplete(() => {
      setLayoutStatus('stable');
    });

    algo.onStabilityChange?.((isStable) => {
      setLayoutStatus(isStable ? 'stable' : 'computing');
    });

    if ('onInstability' in algo) {
      (algo as D3ForceAlgorithm).onInstability?.(() => {
        setLayoutStatus('unstable');
      });
    }

    // Initialize with graph data
    const startTime = performance.now();
    setLayoutStatus('computing');

    algo.initialize(nodes, links, {
      width: dimensions.width,
      height: dimensions.height,
      forceSettings,
      hasLayoutData,
    });

    // Update stats
    setStats({
      nodes: nodes.length,
      edges: links.length,
      communities: lodResult?.communities.length ?? 0,
      layoutTime: undefined,
    });

    // Start the algorithm
    algo.start();

    // For algorithms that complete quickly, update stats
    algo.onComplete(() => {
      const elapsed = performance.now() - startTime;
      setStats(s => ({ ...s, layoutTime: elapsed }));
    });

    return () => {
      if (algorithmRef.current) {
        algorithmRef.current.destroy();
        algorithmRef.current = null;
      }
    };
  }, [algorithm, nodes.length, links.length, dimensions, forceSettings, hasLayoutData, isReady]);

  // Update algorithm's color mode (for Sigma)
  useEffect(() => {
    if (algorithmRef.current && algorithm === 'sigma') {
      (algorithmRef.current as SigmaAlgorithm).setColorMode(colorMode);
    }
  }, [colorMode, algorithm]);

  // Stop layout handler
  const handleStopLayout = () => {
    if (algorithmRef.current) {
      algorithmRef.current.stop();
      setLayoutStatus('stable');
    }
  };

  // Render appropriate renderer based on algorithm
  const renderGraph = () => {
    if (!isReady || nodes.length === 0) return null;

    const commonProps = {
      nodes,
      links,
      colorMode,
      signedUrls,
      lodResult,
      lodSettings: graphLOD,
      onNodeClick: openModal,
      onZoomChange: setCurrentZoom,
      width: dimensions.width,
      height: dimensions.height,
    };

    if (algorithm === 'sigma') {
      return (
        <SigmaRenderer
          {...commonProps}
          algorithm={algorithmRef.current as SigmaAlgorithm}
          forceSettings={forceSettings}
        />
      );
    }

    // D3 and ForceAtlas2 both use D3SVGRenderer
    return (
      <D3SVGRenderer
        {...commonProps}
        algorithm={algorithmRef.current!}
      />
    );
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative bg-cosmos-void"
    >
      {renderGraph()}

      {/* Stats overlay */}
      <StatsOverlay
        stats={stats}
        status={layoutStatus}
        currentZoom={currentZoom}
        algorithmLabel={ALGORITHM_LABELS[algorithm]}
        onStop={handleStopLayout}
      />

      {/* Warnings and states */}
      {layoutStatus === 'unstable' && <UnstableWarning />}

      {filteredImages.length === 0 && <EmptyState />}

      {edges.length === 0 && filteredImages.length > 0 && layoutStatus !== 'computing' && (
        <NoEdgesWarning />
      )}

      {layoutStatus === 'computing' && algorithm !== 'd3' && nodes.length > 100 && (
        <ComputingOverlay nodeCount={nodes.length} />
      )}
    </motion.div>
  );
}

// Re-export types and algorithm names for external use
export type { AlgorithmType, NetworkGraphProps } from './types';
export { ALGORITHM_LABELS };
