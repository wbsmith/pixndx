/**
 * WebGL Network Graph using Sigma.js
 * 
 * For very large graphs (5000+ nodes), SVG rendering becomes too slow.
 * Sigma.js uses WebGL for hardware-accelerated rendering.
 * 
 * This version maintains the same visual language as the D3 version:
 * - Circular image nodes with colored rings
 * - Edge highlighting on hover
 * - Click to open modal
 * 
 * Note: Requires sigma and @sigma/node-image packages
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useGalleryStore, type ColorMode } from '@/stores/galleryStore';
import { getDominantColor } from '@/lib/similarity/vectors';
import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';
import { getSignedImageUrl } from '@/lib/amplify';
import { IS_LOCAL_DEV } from '@/config';

// Sigma imports - these will error until packages are installed
// import Sigma from 'sigma';
// import { NodeImageProgram } from '@sigma/node-image';

// =============================================================================
// TYPES
// =============================================================================

interface NodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  image: string;      // URL for Sigma
  label: string;
  imageData: ImageMetadata;  // Full data for click handler
}

interface EdgeAttributes {
  weight: number;
  color: string;
  size: number;
}

// =============================================================================
// COLOR HELPERS
// =============================================================================

const CLUSTER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
];

const MOOD_COLORS: Record<string, string> = {
  peaceful: '#98D8C8',
  dramatic: '#E74C3C',
  mysterious: '#9B59B6',
  joyful: '#F1C40F',
  melancholic: '#3498DB',
  energetic: '#E67E22',
  serene: '#1ABC9C',
  tense: '#C0392B',
};

function getNodeColor(img: ImageMetadata, colorMode: ColorMode): string {
  switch (colorMode) {
    case 'uniform':
      return '#6366F2';
    case 'cluster':
      return CLUSTER_COLORS[(img.cluster ?? 0) % CLUSTER_COLORS.length];
    case 'community':
      return CLUSTER_COLORS[(img.community ?? 0) % CLUSTER_COLORS.length];
    case 'mood':
      return MOOD_COLORS[img.mood?.toLowerCase() ?? ''] ?? '#6366F2';
    case 'color':
      return getDominantColor(img);
    default:
      return '#6366F2';
  }
}

// =============================================================================
// GRAPH BUILDER
// =============================================================================

function buildGraph(
  images: ImageMetadata[],
  edges: SimilarityEdge[],
  colorMode: ColorMode,
  signedUrls: Map<string, string>
): Graph<NodeAttributes, EdgeAttributes> {
  const graph = new Graph<NodeAttributes, EdgeAttributes>({ type: 'undirected' });
  
  // Add nodes (skip duplicates)
  const addedNodes = new Set<string>();
  images.forEach((img, i) => {
    // Skip if already added (duplicate ID or already in graph)
    if (addedNodes.has(img.id) || graph.hasNode(img.id)) return;
    addedNodes.add(img.id);
    
    const angle = (i / images.length) * 2 * Math.PI;
    const radius = Math.sqrt(images.length) * 10;
    
    // Use signed URL if available, otherwise fall back to direct URL
    const imageUrl = signedUrls.get(img.id) || img.urls.small;
    
    graph.addNode(img.id, {
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
      size: 15,
      color: getNodeColor(img, colorMode),
      type: 'image',  // Required for NodeImageProgram
      image: imageUrl,
      label: img.main_subject || img.id,
      imageData: img,
    });
  });
  
  // Add edges
  edges.forEach(edge => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      try {
        graph.addEdge(edge.source, edge.target, {
          weight: edge.weight,
          color: `rgba(99, 112, 242, ${0.1 + edge.weight * 0.4})`,
          size: 0.5 + edge.weight * 2,
        });
      } catch (e) {
        // Edge might already exist
      }
    }
  });
  
  return graph;
}

// =============================================================================
// LAYOUT
// =============================================================================

interface ForceParams {
  gravity: number;
  scaling: number;
  edgeWeightInfluence?: number;
}

function runLayout(graph: Graph<NodeAttributes, EdgeAttributes>, forceParams?: ForceParams): void {
  const nodeCount = graph.order;
  
  console.log(`Running ForceAtlas2 for ${nodeCount} nodes...`);
  const startTime = performance.now();
  
  const gravity = forceParams?.gravity ?? 0.05;
  const scaling = forceParams?.scaling ?? 1.0;
  const edgeWeightInfluence = forceParams?.edgeWeightInfluence ?? 1.0;
  
  console.log(`  ForceAtlas2 params: gravity=${(gravity * 10).toFixed(2)}, scalingRatio=${(scaling * 10).toFixed(2)}, edgeWeight=${edgeWeightInfluence.toFixed(2)}`);
  
  forceAtlas2.assign(graph, {
    iterations: Math.min(300, Math.max(50, 500 - nodeCount * 0.05)),
    settings: {
      barnesHutOptimize: true,
      barnesHutTheta: 0.8,
      gravity: gravity * 10,  // Scale for ForceAtlas2
      scalingRatio: scaling * 10,
      strongGravityMode: true,
      slowDown: 2,
      edgeWeightInfluence: edgeWeightInfluence,
    },
  });
  
  console.log(`Layout done in ${(performance.now() - startTime).toFixed(0)}ms`);
}

// =============================================================================
// COMPONENT
// =============================================================================

export function NetworkGraphSigma() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<any>(null);  // Sigma instance
  const graphRef = useRef<Graph<NodeAttributes, EdgeAttributes> | null>(null);
  
  // Read stable values from store - forceSettings is read fresh inside useEffect to avoid stale closures
  const { filteredImages, edges, openModal, colorMode } = useGalleryStore();
  
  const [isComputing, setIsComputing] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);  // Incremented to trigger re-render
  const [stats, setStats] = useState({ nodes: 0, edges: 0, time: 0 });
  const [sigmaAvailable, setSigmaAvailable] = useState(false);
  
  
  // Check if Sigma is available
  useEffect(() => {
    import('sigma').then(() => {
      setSigmaAvailable(true);
    }).catch(() => {
      console.warn('Sigma.js not installed. Install with: npm install sigma @sigma/node-image');
      setSigmaAvailable(false);
    });
  }, []);
  
  // Build graph and run layout
  useEffect(() => {
    if (filteredImages.length === 0) return;
    
    let cancelled = false;
    
    const buildGraphAsync = async () => {
      setIsComputing(true);
      const startTime = performance.now();
      
      // Get fresh forceSettings from store to avoid stale closures
      const forceSettings = useGalleryStore.getState().forceSettings;
      
      console.log(`[NetworkGraphSigma] Building: ${filteredImages.length} images, ${edges.length} edges`);
      console.log(`[NetworkGraphSigma] forceSettings: gravity=${forceSettings.gravity}, scaling=${forceSettings.scaling}, edgeWeight=${forceSettings.edgeWeightInfluence}`);
      
      // Pre-fetch signed URLs for all images (in production)
      const signedUrls = new Map<string, string>();
      if (!IS_LOCAL_DEV) {
        console.log(`[NetworkGraphSigma] Fetching signed URLs for ${filteredImages.length} images...`);
        await Promise.all(
          filteredImages.map(async (img) => {
            try {
              const url = await getSignedImageUrl(img.urls.small, 'small');
              signedUrls.set(img.id, url);
            } catch (e) {
              // Use direct URL as fallback
              signedUrls.set(img.id, img.urls.small);
            }
          })
        );
        console.log(`[NetworkGraphSigma] Signed URLs fetched`);
      }
      
      if (cancelled) return;
      
      // Build and layout graph
      const graph = buildGraph(filteredImages, edges, colorMode, signedUrls);
      runLayout(graph, { 
        gravity: forceSettings.gravity, 
        scaling: forceSettings.scaling,
        edgeWeightInfluence: forceSettings.edgeWeightInfluence,
      });
      graphRef.current = graph;
      
      console.log(`[NetworkGraphSigma] Graph: ${graph.order} nodes, ${graph.size} edges`);
      
      setStats({
        nodes: graph.order,
        edges: graph.size,
        time: performance.now() - startTime,
      });
      
      setIsComputing(false);
      // Increment version to trigger Sigma re-init - ALWAYS changes
      setLayoutVersion(v => v + 1);
    };
    
    buildGraphAsync();
    
    return () => { cancelled = true; };
  // Note: forceSettings and colorMode intentionally NOT in deps
  // - forceSettings: only recompute when Apply is clicked (edges change)
  // - colorMode: handled by separate effect that just updates colors
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredImages, edges]);
  
  // Initialize Sigma renderer (triggered by layoutVersion change)
  useEffect(() => {
    if (!sigmaAvailable || !containerRef.current || !graphRef.current || layoutVersion === 0) return;
    
    console.log(`[NetworkGraphSigma] Initializing Sigma, layoutVersion=${layoutVersion}`);
    
    const initSigma = async () => {
      const Sigma = (await import('sigma')).default;
      
      // Try to load node-image program, fallback to circles
      let nodeProgram;
      try {
        const { NodeImageProgram } = await import('@sigma/node-image');
        nodeProgram = NodeImageProgram;
      } catch {
        console.warn('@sigma/node-image not available, using circles');
        nodeProgram = undefined;
      }
      
      // Clean up previous instance
      if (sigmaRef.current) {
        sigmaRef.current.kill();
      }
      
      const graph = graphRef.current!;
      
      // Create Sigma renderer
      const sigma = new Sigma(graph, containerRef.current!, {
        renderLabels: false,
        renderEdgeLabels: false,
        enableEdgeEvents: true,
        defaultNodeType: nodeProgram ? 'image' : 'circle',
        nodeProgramClasses: nodeProgram ? { image: nodeProgram } : undefined,
        nodeReducer: (_node, data) => {
          return {
            ...data,
          };
        },
        edgeReducer: (_edge, data) => {
          return {
            ...data,
            color: data.color || 'rgba(99, 112, 242, 0.3)',
          };
        },
      });
      
      sigmaRef.current = sigma;
      
      // Click handler
      sigma.on('clickNode', ({ node }) => {
        const attrs = graph.getNodeAttributes(node);
        if (attrs.imageData) {
          openModal(attrs.imageData);
        }
      });
      
      // Hover handlers for edge highlighting
      let highlightedNode: string | null = null;
      let highlightedNeighbors = new Set<string>();
      
      sigma.on('enterNode', ({ node }) => {
        highlightedNode = node;
        highlightedNeighbors = new Set(graph.neighbors(node));
        highlightedNeighbors.add(node);
        
        sigma.setSetting('nodeReducer', (n, data) => {
          if (highlightedNode && !highlightedNeighbors.has(n)) {
            return { ...data, color: '#333', zIndex: 0 };
          }
          if (n === highlightedNode) {
            return { ...data, zIndex: 2, size: data.size * 1.3 };
          }
          return { ...data, zIndex: 1 };
        });
        
        sigma.setSetting('edgeReducer', (edge, data) => {
          const [source, target] = graph.extremities(edge);
          if (highlightedNode === source || highlightedNode === target) {
            return { ...data, color: 'rgba(34, 211, 238, 0.8)', size: 2 };
          }
          return { ...data, color: 'rgba(99, 112, 242, 0.05)' };
        });
        
        sigma.refresh();
      });
      
      sigma.on('leaveNode', () => {
        highlightedNode = null;
        highlightedNeighbors.clear();
        
        sigma.setSetting('nodeReducer', (_node, data) => data);
        sigma.setSetting('edgeReducer', (_edge, data) => data);
        sigma.refresh();
      });
    };
    
    initSigma();
    
    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [sigmaAvailable, layoutVersion, openModal]);
  
  // Update colors when colorMode changes (without recomputing layout)
  useEffect(() => {
    if (!graphRef.current || !sigmaRef.current) return;
    
    const graph = graphRef.current;
    const currentColorMode = useGalleryStore.getState().colorMode;
    
    console.log(`[NetworkGraphSigma] Updating colors to mode: ${currentColorMode}`);
    
    // Update node colors in the graph
    graph.forEachNode((node, attrs) => {
      const newColor = getNodeColor(attrs.imageData, currentColorMode);
      graph.setNodeAttribute(node, 'color', newColor);
    });
    
    // Refresh Sigma display
    sigmaRef.current.refresh();
  }, [colorMode]);
  
  // Fallback if Sigma not available
  if (!sigmaAvailable) {
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative bg-cosmos-void"
    >
      <div
        ref={containerRef}
        className="w-full h-full"
      />
      
      {/* Stats overlay */}
      <div className="absolute top-4 right-4 glass rounded-lg p-3 text-xs space-y-1">
        <div className="text-nebula-300">
          {stats.nodes} nodes • {stats.edges} edges
        </div>
        <div className="text-stellar-violet">
          WebGL Renderer (Sigma.js)
        </div>
        <div className={isComputing ? 'text-yellow-400' : 'text-green-400'}>
          {isComputing ? '○ Computing...' : `● Ready (${stats.time.toFixed(0)}ms)`}
        </div>
      </div>
      
      
      {/* Computing overlay */}
      {isComputing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="text-white text-lg">
            Computing layout for {filteredImages.length} images...
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default NetworkGraphSigma;

