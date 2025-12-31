import { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import type { ImageMetadata, SimilarityEdge } from '@/types/gallery';
import { getDominantColor } from '@/lib/similarity/vectors';

interface ForceGraphProps {
  images: ImageMetadata[];
  edges: SimilarityEdge[];
  onNodeClick?: (image: ImageMetadata) => void;
  onNodeHover?: (image: ImageMetadata | null) => void;
  hoveredImageId?: string | null;
  width?: number;
  height?: number;
  nodeRadius?: number;
  showLabels?: boolean;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  image: ImageMetadata;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: GraphNode | string;
  target: GraphNode | string;
  weight: number;
}

export function ForceGraph({
  images,
  edges,
  onNodeClick,
  onNodeHover,
  hoveredImageId,
  width = 800,
  height = 600,
  nodeRadius = 32,
  showLabels = false,
}: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Create/update the force simulation
  const initializeSimulation = useCallback(() => {
    if (!svgRef.current || images.length === 0) return;
    
    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();
    
    // Create nodes
    const nodes: GraphNode[] = images.map((img) => ({
      id: img.id,
      image: img,
    }));
    
    // Create links
    const links: GraphLink[] = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    }));
    
    // Create SVG group with zoom
    const svg = d3.select(svgRef.current);
    const g = svg.append('g');
    
    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    
    svg.call(zoom);
    
    // Center the view
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2)
    );
    
    // Create force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3.forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => 150 * (1 - d.weight))
          .strength((d) => d.weight * 0.5)
      )
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(400))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(nodeRadius + 10));
    
    simulationRef.current = simulation;
    
    // Create gradient definitions for glows
    const defs = svg.append('defs');
    
    nodes.forEach((node) => {
      const color = getDominantColor(node.image);
      const gradientId = `glow-${node.id}`;
      
      const gradient = defs.append('radialGradient')
        .attr('id', gradientId)
        .attr('cx', '50%')
        .attr('cy', '50%')
        .attr('r', '50%');
      
      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', color)
        .attr('stop-opacity', 0.6);
      
      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', color)
        .attr('stop-opacity', 0);
    });
    
    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#4a5568')
      .attr('stroke-opacity', (d) => d.weight * 0.5)
      .attr('stroke-width', (d) => Math.max(1, d.weight * 3));
    
    // Create node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );
    
    // Node glow background
    node.append('circle')
      .attr('r', nodeRadius + 8)
      .attr('fill', (d) => `url(#glow-${d.id})`)
      .attr('class', 'node-glow');
    
    // Clip path for circular images
    node.append('clipPath')
      .attr('id', (d) => `clip-${d.id}`)
      .append('circle')
      .attr('r', nodeRadius);
    
    // Node image
    node.append('image')
      .attr('xlink:href', (d) => d.image.urls.small)
      .attr('x', -nodeRadius)
      .attr('y', -nodeRadius)
      .attr('width', nodeRadius * 2)
      .attr('height', nodeRadius * 2)
      .attr('clip-path', (d) => `url(#clip-${d.id})`)
      .attr('preserveAspectRatio', 'xMidYMid slice');
    
    // Node border
    node.append('circle')
      .attr('r', nodeRadius + 1)
      .attr('fill', 'none')
      .attr('stroke', (d) => getDominantColor(d.image))
      .attr('stroke-width', 2)
      .attr('class', 'node-border');
    
    // Labels (optional)
    if (showLabels) {
      node.append('text')
        .attr('dy', nodeRadius + 15)
        .attr('text-anchor', 'middle')
        .attr('fill', '#a0aec0')
        .attr('font-size', '10px')
        .text((d) => d.image.main_subject.substring(0, 20));
    }
    
    // Event handlers
    node
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeClick?.(d.image);
      })
      .on('mouseenter', (event, d) => {
        onNodeHover?.(d.image);
        
        // Highlight connected edges
        link
          .attr('stroke-opacity', (l) => {
            const source = typeof l.source === 'object' ? l.source.id : l.source;
            const target = typeof l.target === 'object' ? l.target.id : l.target;
            return source === d.id || target === d.id ? 0.8 : 0.1;
          })
          .attr('stroke', (l) => {
            const source = typeof l.source === 'object' ? l.source.id : l.source;
            const target = typeof l.target === 'object' ? l.target.id : l.target;
            return source === d.id || target === d.id 
              ? getDominantColor(d.image) 
              : '#4a5568';
          });
        
        // Highlight connected nodes
        node.selectAll('.node-glow')
          .attr('opacity', (n: GraphNode) => {
            if (n.id === d.id) return 1;
            const isConnected = links.some((l) => {
              const source = typeof l.source === 'object' ? l.source.id : l.source;
              const target = typeof l.target === 'object' ? l.target.id : l.target;
              return (source === d.id && target === n.id) ||
                     (target === d.id && source === n.id);
            });
            return isConnected ? 0.8 : 0.3;
          });
      })
      .on('mouseleave', () => {
        onNodeHover?.(null);
        
        // Reset edge styles
        link
          .attr('stroke-opacity', (d) => d.weight * 0.5)
          .attr('stroke', '#4a5568');
        
        // Reset node styles
        node.selectAll('.node-glow').attr('opacity', 1);
      });
    
    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);
      
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
    
    setIsInitialized(true);
    
    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [images, edges, width, height, nodeRadius, showLabels, onNodeClick, onNodeHover]);
  
  // Initialize on mount and data change
  useEffect(() => {
    const cleanup = initializeSimulation();
    return cleanup;
  }, [initializeSimulation]);
  
  // Update hover state externally
  useEffect(() => {
    if (!svgRef.current || !isInitialized) return;
    
    const svg = d3.select(svgRef.current);
    
    svg.selectAll('.nodes g')
      .selectAll('.node-border')
      .attr('stroke-width', function(this: SVGCircleElement) {
        const nodeGroup = d3.select(this.parentNode as SVGGElement);
        const nodeData = nodeGroup.datum() as GraphNode;
        return nodeData.id === hoveredImageId ? 4 : 2;
      });
  }, [hoveredImageId, isInitialized]);
  
  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="w-full h-full"
      style={{ background: 'transparent' }}
    />
  );
}

// Utility hook for using ForceGraph with gallery store
export function useForceGraph() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      });
      
      resizeObserver.observe(node);
      
      return () => resizeObserver.disconnect();
    }
  }, []);
  
  return { containerRef, dimensions };
}
