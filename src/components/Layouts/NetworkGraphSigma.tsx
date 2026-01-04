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

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useGalleryStore } from '@/stores/galleryStore';
import { getDominantColor } from '@/lib/similarity/vectors';
import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';

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
// GRAPH BUILDER
// =============================================================================

function buildGraph(
  images: ImageMetadata[],
  edges: SimilarityEdge[]
): Graph<NodeAttributes, EdgeAttributes> {
  const graph = new Graph<NodeAttributes, EdgeAttributes>({ type: 'undirected' });
  
  // Add nodes
  images.forEach((img, i) => {
    const angle = (i / images.length) * 2 * Math.PI;
    const radius = Math.sqrt(images.length) * 10;
    
    graph.addNode(img.id, {
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
      size: 15,
      color: getDominantColor(img),
      image: img.urls.small,
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
}

function runLayout(graph: Graph<NodeAttributes, EdgeAttributes>, forceParams?: ForceParams): void {
  const nodeCount = graph.order;
  
  console.log(`Running ForceAtlas2 for ${nodeCount} nodes...`);
  const startTime = performance.now();
  
  const gravity = forceParams?.gravity ?? 0.05;
  const scaling = forceParams?.scaling ?? 1.0;
  
  forceAtlas2.assign(graph, {
    iterations: Math.min(300, Math.max(50, 500 - nodeCount * 0.05)),
    settings: {
      barnesHutOptimize: true,
      barnesHutTheta: 0.8,
      gravity: gravity * 10,  // Scale for ForceAtlas2
      scalingRatio: scaling * 10,
      strongGravityMode: true,
      slowDown: 2,
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
  
  const { filteredImages, edges, openModal, forceSettings } = useGalleryStore();
  
  const [isComputing, setIsComputing] = useState(false);
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
    
    setIsComputing(true);
    const startTime = performance.now();
    
    // Build and layout graph
    const graph = buildGraph(filteredImages, edges);
    runLayout(graph, { gravity: forceSettings.gravity, scaling: forceSettings.scaling });
    graphRef.current = graph;
    
    setStats({
      nodes: graph.order,
      edges: graph.size,
      time: performance.now() - startTime,
    });
    
    setIsComputing(false);
  }, [filteredImages, edges, forceSettings]);
  
  // Initialize Sigma renderer
  useEffect(() => {
    if (!sigmaAvailable || !containerRef.current || !graphRef.current || isComputing) return;
    
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
        nodeReducer: (node, data) => {
          return {
            ...data,
            // Sigma uses 'image' attribute for NodeImageProgram
            image: data.image,
          };
        },
        edgeReducer: (edge, data) => {
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
        
        sigma.setSetting('nodeReducer', (node, data) => data);
        sigma.setSetting('edgeReducer', (edge, data) => data);
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
  }, [sigmaAvailable, isComputing, openModal]);
  
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

