/**
 * Scalable Network Graph
 * 
 * Uses graphology for efficient graph data structure and layout,
 * but renders with D3 SVG to preserve the beautiful circular node aesthetic.
 * 
 * Architecture:
 * - graphology: Graph data structure (O(1) lookups, efficient iteration)
 * - graphology-layout-forceatlas2: Barnes-Hut optimized layout (O(n log n))
 * - D3: SVG rendering (your existing beautiful look)
 * 
 * Performance targets:
 * - 2,000 nodes: smooth interaction
 * - 5,000 nodes: usable with slight lag
 * - 10,000+ nodes: consider switching to WebGL (Sigma.js)
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import * as d3 from 'd3';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useGalleryStore } from '@/stores/galleryStore';
import { getDominantColor } from '@/lib/similarity/vectors';
import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

interface NodeAttributes {
  image: ImageMetadata;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface EdgeAttributes {
  weight: number;
}

interface LayoutSettings {
  iterations: number;
  barnesHutOptimize: boolean;
  barnesHutTheta: number;
  gravity: number;
  scalingRatio: number;
  strongGravityMode: boolean;
  slowDown: number;
}

// =============================================================================
// GRAPH BUILDER
// =============================================================================

function buildGraph(
  images: ImageMetadata[],
  edges: SimilarityEdge[],
  width: number,
  height: number
): Graph<NodeAttributes, EdgeAttributes> {
  const graph = new Graph<NodeAttributes, EdgeAttributes>({ type: 'undirected' });
  
  // Add nodes with initial random positions
  images.forEach((img, i) => {
    // Distribute in a circle initially for faster convergence
    const angle = (i / images.length) * 2 * Math.PI;
    const radius = Math.min(width, height) * 0.3;
    
    graph.addNode(img.id, {
      image: img,
      x: width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
      y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
      size: 1,
      color: getDominantColor(img),
    });
  });
  
  // Add edges
  edges.forEach(edge => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      try {
        graph.addEdge(edge.source, edge.target, {
          weight: edge.weight,
        });
      } catch (e) {
        // Edge might already exist (duplicate in data)
      }
    }
  });
  
  return graph;
}

// =============================================================================
// LAYOUT COMPUTATION
// =============================================================================

function computeLayout(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  settings: Partial<LayoutSettings> = {}
): void {
  const nodeCount = graph.order;
  
  // Adaptive settings based on graph size
  const defaultSettings: LayoutSettings = {
    iterations: Math.min(500, Math.max(100, 1000 - nodeCount * 0.3)),
    barnesHutOptimize: nodeCount > 100,  // Use Barnes-Hut for >100 nodes
    barnesHutTheta: nodeCount > 1000 ? 0.8 : 0.5,  // More aggressive for large graphs
    gravity: 1,
    scalingRatio: Math.max(1, Math.log10(nodeCount) * 5),
    strongGravityMode: true,
    slowDown: 1 + nodeCount / 500,
  };
  
  const finalSettings = { ...defaultSettings, ...settings };
  
  console.log(`Running ForceAtlas2: ${nodeCount} nodes, ${graph.size} edges, ${finalSettings.iterations} iterations`);
  const startTime = performance.now();
  
  // Run synchronous layout (for smaller graphs)
  // For very large graphs, use the web worker version
  forceAtlas2.assign(graph, finalSettings);
  
  const elapsed = performance.now() - startTime;
  console.log(`Layout computed in ${elapsed.toFixed(0)}ms`);
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function NetworkGraphScalable() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph<NodeAttributes, EdgeAttributes> | null>(null);
  
  const { filteredImages, edges, openModal, forceSettings } = useGalleryStore();
  
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isComputing, setIsComputing] = useState(false);
  const [layoutComplete, setLayoutComplete] = useState(false);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, time: 0 });
  
  
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
  
  // Build and layout graph when data changes
  useEffect(() => {
    if (filteredImages.length === 0) return;
    
    setIsComputing(true);
    setLayoutComplete(false);
    
    const startTime = performance.now();
    
    // Build graph
    const graph = buildGraph(filteredImages, edges, dimensions.width, dimensions.height);
    graphRef.current = graph;
    
    // Compute layout with store's force settings
    computeLayout(graph, {
      gravity: forceSettings.gravity * 20,  // Scale for ForceAtlas2 (expects ~1-10)
      scalingRatio: forceSettings.scaling * 10,  // Scale for ForceAtlas2
    });
    
    // Normalize positions to fit viewport
    normalizePositions(graph, dimensions.width, dimensions.height);
    
    const elapsed = performance.now() - startTime;
    
    setStats({
      nodes: graph.order,
      edges: graph.size,
      time: elapsed,
    });
    
    setIsComputing(false);
    setLayoutComplete(true);
    
  }, [filteredImages, edges, dimensions.width, dimensions.height, forceSettings]);
  
  // Render with D3 when layout is complete
  useEffect(() => {
    if (!layoutComplete || !graphRef.current || !svgRef.current) return;
    
    const graph = graphRef.current;
    const svg = d3.select(svgRef.current);
    const { width, height } = dimensions;
    
    // Clear previous
    svg.selectAll('*').remove();
    
    // Compute node radius based on count
    const nodeCount = graph.order;
    const nodeRadius = Math.max(8, Math.min(30, 400 / Math.sqrt(nodeCount)));
    
    // Setup zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 8])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });
    
    svg.call(zoom);
    
    const container = svg.append('g');
    
    // Helper to create safe CSS IDs (no special chars)
    const safeId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Create clip paths for circular images
    const defs = svg.append('defs');
    graph.forEachNode((nodeId) => {
      defs.append('clipPath')
        .attr('id', `clip-${safeId(nodeId)}`)
        .append('circle')
        .attr('r', nodeRadius - 2);
    });
    
    // Extract data for D3
    const nodesData = graph.mapNodes((nodeId, attrs) => ({
      id: nodeId,
      x: attrs.x,
      y: attrs.y,
      color: attrs.color,
      image: attrs.image,
    }));
    
    const edgesData = graph.mapEdges((edgeId, attrs, source, target) => ({
      source: graph.getNodeAttribute(source, 'x'),
      sourceY: graph.getNodeAttribute(source, 'y'),
      target: graph.getNodeAttribute(target, 'x'),
      targetY: graph.getNodeAttribute(target, 'y'),
      weight: attrs.weight,
    }));
    
    // Draw edges
    const edgeGroup = container.append('g').attr('class', 'edges');
    edgeGroup.selectAll('line')
      .data(edgesData)
      .join('line')
      .attr('x1', d => d.source)
      .attr('y1', d => d.sourceY)
      .attr('x2', d => d.target)
      .attr('y2', d => d.targetY)
      .attr('stroke', 'rgba(99, 112, 242, 0.4)')
      .attr('stroke-width', d => 0.3 + d.weight * 1.2)
      .attr('stroke-opacity', d => 0.08 + d.weight * 0.35);
    
    // Draw nodes
    const nodeGroup = container.append('g').attr('class', 'nodes');
    const nodes = nodeGroup.selectAll('g')
      .data(nodesData)
      .join('g')
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .attr('class', 'cursor-pointer')
      .style('pointer-events', 'all');
    
    // Glow effect (outer ring blur)
    nodes.append('circle')
      .attr('r', nodeRadius + 3)
      .attr('fill', d => d.color)
      .attr('opacity', 0.3)
      .style('filter', 'blur(4px)');
    
    // Image
    nodes.append('image')
      .attr('xlink:href', d => d.image.urls.small)
      .attr('x', -nodeRadius + 2)
      .attr('y', -nodeRadius + 2)
      .attr('width', (nodeRadius - 2) * 2)
      .attr('height', (nodeRadius - 2) * 2)
      .attr('clip-path', d => `url(#clip-${safeId(d.id)})`)
      .attr('preserveAspectRatio', 'xMidYMid slice');
    
    // Colored ring border
    nodes.append('circle')
      .attr('r', nodeRadius - 1)
      .attr('fill', 'none')
      .attr('stroke', d => d.color)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.85);
    
    // Hover ring (hidden by default)
    nodes.append('circle')
      .attr('r', nodeRadius + 2)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(34, 211, 238, 1)')
      .attr('stroke-width', 2)
      .attr('opacity', 0)
      .attr('class', 'hover-ring');
    
    // Interactions
    nodes
      .on('mouseenter', function(event, d) {
        d3.select(this).select('.hover-ring').attr('opacity', 1);
        d3.select(this).raise();
        
        // Find connected nodes
        const connectedIds = new Set<string>([d.id]);
        graph.forEachEdge(d.id, (edge, attrs, source, target) => {
          connectedIds.add(source);
          connectedIds.add(target);
        });
        
        // Highlight edges
        edgeGroup.selectAll('line')
          .attr('stroke-opacity', (l: any, i) => {
            const ed = edgesData[i];
            // Check if this edge connects to hovered node
            const nodeData = nodesData.find(n => n.id === d.id);
            if (!nodeData) return 0.02;
            const isConnected = 
              (ed.source === nodeData.x && ed.sourceY === nodeData.y) ||
              (ed.target === nodeData.x && ed.targetY === nodeData.y);
            return isConnected ? 0.85 : 0.02;
          })
          .attr('stroke', (l: any, i) => {
            const ed = edgesData[i];
            const nodeData = nodesData.find(n => n.id === d.id);
            if (!nodeData) return 'rgba(99, 112, 242, 0.1)';
            const isConnected = 
              (ed.source === nodeData.x && ed.sourceY === nodeData.y) ||
              (ed.target === nodeData.x && ed.targetY === nodeData.y);
            return isConnected ? 'rgba(34, 211, 238, 0.9)' : 'rgba(99, 112, 242, 0.1)';
          });
        
        // Dim unconnected nodes
        nodes.attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15);
      })
      .on('mouseleave', function() {
        d3.select(this).select('.hover-ring').attr('opacity', 0);
        
        // Reset edges
        edgeGroup.selectAll('line')
          .attr('stroke-opacity', (d: any) => 0.08 + d.weight * 0.35)
          .attr('stroke', 'rgba(99, 112, 242, 0.4)');
        
        // Reset nodes
        nodes.attr('opacity', 1);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        openModal(d.image);
      });
    
    // Drag behavior for interactive positioning
    const drag = d3.drag<SVGGElement, typeof nodesData[0]>()
      .on('start', function(event, d) {
        d3.select(this).raise();
      })
      .on('drag', function(event, d) {
        d.x = event.x;
        d.y = event.y;
        d3.select(this).attr('transform', `translate(${d.x}, ${d.y})`);
        
        // Update connected edges (expensive for many edges - could optimize)
        if (graph.order < 500) {
          updateEdges();
        }
      })
      .on('end', function(event, d) {
        // Update graph data
        graph.setNodeAttribute(d.id, 'x', d.x);
        graph.setNodeAttribute(d.id, 'y', d.y);
        updateEdges();
      });
    
    function updateEdges() {
      const newEdgesData = graph.mapEdges((edgeId, attrs, source, target) => ({
        source: graph.getNodeAttribute(source, 'x'),
        sourceY: graph.getNodeAttribute(source, 'y'),
        target: graph.getNodeAttribute(target, 'x'),
        targetY: graph.getNodeAttribute(target, 'y'),
        weight: attrs.weight,
      }));
      
      edgeGroup.selectAll('line')
        .data(newEdgesData)
        .attr('x1', d => d.source)
        .attr('y1', d => d.sourceY)
        .attr('x2', d => d.target)
        .attr('y2', d => d.targetY);
    }
    
    nodes.call(drag as any);
    
    // Initial zoom to fit
    const scale = Math.min(0.9, Math.max(0.05, 25 / Math.sqrt(nodeCount)));
    const initialTransform = d3.zoomIdentity
      .translate(width * 0.05, height * 0.05)
      .scale(scale);
    svg.call(zoom.transform as any, initialTransform);
    
  }, [layoutComplete, dimensions, openModal]);
  
  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full relative bg-cosmos-void"
    >
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
      />
      
      {/* Stats overlay */}
      <div className="absolute top-4 right-4 glass rounded-lg p-3 text-xs space-y-1">
        <div className="text-nebula-300">
          {stats.nodes} nodes • {stats.edges} edges
        </div>
        <div className={layoutComplete ? 'text-green-400' : 'text-yellow-400'}>
          {isComputing ? '○ Computing layout...' : `● Layout computed (${stats.time.toFixed(0)}ms)`}
        </div>
      </div>
      
      
      {/* Computing overlay */}
      {isComputing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-lg">Computing layout for {filteredImages.length} images...</div>
        </div>
      )}
      
      {filteredImages.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-nebula-400">
          No images match your filter
        </div>
      )}
      
      {edges.length === 0 && filteredImages.length > 0 && !isComputing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-lg px-4 py-2 text-sm text-yellow-400">
          No edges found. Try lowering the similarity threshold.
        </div>
      )}
    </motion.div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize node positions to fit within the viewport with padding
 */
function normalizePositions(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  width: number,
  height: number,
  padding: number = 50
): void {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  graph.forEachNode((node, attrs) => {
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
  });
  
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  
  const targetWidth = width - padding * 2;
  const targetHeight = height - padding * 2;
  
  // Maintain aspect ratio
  const scale = Math.min(targetWidth / rangeX, targetHeight / rangeY);
  
  const offsetX = (width - rangeX * scale) / 2;
  const offsetY = (height - rangeY * scale) / 2;
  
  graph.updateEachNodeAttributes((node, attrs) => ({
    ...attrs,
    x: (attrs.x - minX) * scale + offsetX,
    y: (attrs.y - minY) * scale + offsetY,
  }));
}

export default NetworkGraphScalable;


