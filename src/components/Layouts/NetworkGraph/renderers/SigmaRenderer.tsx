/**
 * Sigma WebGL Renderer
 *
 * Renders graph using Sigma.js WebGL for very large graphs (5000+ nodes).
 * The SigmaAlgorithm handles its own rendering, so this is a thin wrapper.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { GraphNode, GraphLink } from '../types';
import type { ColorMode } from '@/stores/galleryStore';
import type { ImageMetadata } from '@/types/gallery';
import type { LODResult } from '@/lib/graph/communityDetection';
import { SigmaAlgorithm } from '../algorithms/SigmaAlgorithm';

interface SigmaRendererProps {
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
  algorithm: SigmaAlgorithm;
  width: number;
  height: number;
  forceSettings: {
    gravity: number;
    scaling: number;
    edgeWeightInfluence: number;
    linLogMode: boolean;
    strongGravityMode: boolean;
    outboundAttractionDistribution: boolean;
  };
}

export function SigmaRenderer({
  nodes,
  links,
  colorMode,
  signedUrls,
  onNodeClick,
  algorithm,
  width,
  height,
  forceSettings,
}: SigmaRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sigmaAvailable, setSigmaAvailable] = useState<boolean | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize Sigma when container is ready
  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    const init = async () => {
      // Configure algorithm
      algorithm.setContainer(containerRef.current!);
      algorithm.setSignedUrls(signedUrls);
      algorithm.setOnNodeClick(onNodeClick);
      algorithm.setColorMode(colorMode);

      // Initialize with graph data
      algorithm.initialize(nodes, links, {
        width,
        height,
        forceSettings,
      });

      // Start rendering
      await algorithm.start();

      setSigmaAvailable(algorithm.isSigmaAvailable());
      setIsInitialized(true);
    };

    init();

    return () => {
      algorithm.destroy();
      setIsInitialized(false);
    };
  }, [nodes.length, links.length, width, height]);

  // Update colors when colorMode changes
  useEffect(() => {
    if (!isInitialized) return;
    algorithm.setColorMode(colorMode);
  }, [colorMode, isInitialized, algorithm]);

  // Fallback if Sigma not available
  if (sigmaAvailable === false) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full h-full flex items-center justify-center bg-cosmos-void"
      >
        <div className="text-center p-8 glass rounded-lg max-w-md">
          <h3 className="text-white text-lg font-medium mb-2">
            WebGL Renderer Not Available
          </h3>
          <p className="text-nebula-400 text-sm mb-4">
            For graphs with 5000+ nodes, install Sigma.js for WebGL acceleration:
          </p>
          <code className="block bg-black/50 p-3 rounded text-xs text-stellar-cyan">
            npm install sigma @sigma/node-image
          </code>
          <p className="text-nebula-500 text-xs mt-4">
            The standard graph view will work for smaller datasets.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ width, height }}
    />
  );
}
