import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as d3 from 'd3';
import { useGalleryStore, type ColorMode } from '@/stores/galleryStore';
import { getDominantColor } from '@/lib/similarity/vectors';
import type { ImageMetadata } from '@/types/gallery';
import { getSignedImageUrl } from '@/lib/amplify';
import { IS_LOCAL_DEV } from '@/config';

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

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  image: ImageMetadata;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  weight: number;
}

export function NetworkGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Read stable values from store - forceSettings is read fresh inside useEffect to avoid stale closures
  const { filteredImages, edges, openModal, colorMode } = useGalleryStore();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isStable, setIsStable] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

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

  useEffect(() => {
    if (!svgRef.current || filteredImages.length === 0) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = dimensions;

    svg.selectAll('*').remove();
    setIsStable(false);

    // No node limit - use all filtered images
    const displayImages = filteredImages;
    
    // Pre-fetch signed URLs for all images (in production)
    const signedUrlsRef: Map<string, string> = new Map();
    let cancelled = false;
    
    const initGraph = async () => {
      if (!IS_LOCAL_DEV) {
        console.log(`[NetworkGraph] Fetching signed URLs for ${displayImages.length} images...`);
        await Promise.all(
          displayImages.map(async (img) => {
            try {
              const url = await getSignedImageUrl(img.urls.small, 'small');
              signedUrlsRef.set(img.id, url);
            } catch {
              signedUrlsRef.set(img.id, img.urls.small);
            }
          })
        );
        console.log(`[NetworkGraph] Signed URLs fetched`);
      }
      
      // Don't render if component was unmounted during fetch
      if (cancelled) return;
      
      buildGraph();
    };
    
    const buildGraph = () => {

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 5])
      .on('zoom', (event) => container.attr('transform', event.transform));

    svg.call(zoom);
    const container = svg.append('g');

    // Check if we have UMAP layout data
    const hasLayoutData = displayImages.some(img => img.layoutPosition);
    
    // Deduplicate images by ID
    const seenIds = new Set<string>();
    const uniqueImages = displayImages.filter(img => {
      if (seenIds.has(img.id)) return false;
      seenIds.add(img.id);
      return true;
    });
    
    const nodes: GraphNode[] = uniqueImages.map((img, i) => {
      // Use UMAP position if available, otherwise use circular layout
      if (img.layoutPosition) {
        // UMAP positions are in [0, 1000] range, scale to fit viewport
        const scale = Math.min(width, height) / 1200;
        return {
          id: img.id,
          image: img,
          x: width / 2 + (img.layoutPosition.x - 500) * scale,
          y: height / 2 + (img.layoutPosition.y - 500) * scale,
        };
      }
      
      // Fallback: circular arrangement
      const angle = (i / uniqueImages.length) * 2 * Math.PI;
      const radius = Math.sqrt(uniqueImages.length) * 15 + Math.random() * 100;
      return {
        id: img.id,
        image: img,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      };
    });

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Edges are already filtered by recomputeEdges() in the store
    // Just filter to only include edges between visible nodes
    const validEdges = edges.filter(e => 
      nodeMap.has(e.source) && 
      nodeMap.has(e.target)
    );
    
    const links: GraphLink[] = validEdges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      weight: e.weight,
    }));

    setNodeCount(nodes.length);
    setEdgeCount(links.length);

    // Get fresh force settings from store to avoid stale closures
    const { gravity, scaling, edgeWeightInfluence } = useGalleryStore.getState().forceSettings;

    // Scale parameters based on graph size
    const nodeRadius = Math.max(12, Math.min(30, 600 / Math.sqrt(nodes.length)));
    const chargeStrength = Math.max(-150, -40000 / nodes.length) * scaling;

    // If we have UMAP positions, use gentler forces to preserve the layout
    const alphaDecay = hasLayoutData ? 0.05 : 0.018;  // Converge faster with UMAP
    const velocityDecay = hasLayoutData ? 0.6 : 0.4;  // More friction with UMAP
    const linkStrengthMultiplier = hasLayoutData ? 0.5 : 1.0;  // Weaker links with UMAP

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => (20 + 80 * (1 - d.weight)) * scaling)
        .strength((d) => (0.2 + d.weight * 0.6) * edgeWeightInfluence * linkStrengthMultiplier))
      .force('charge', d3.forceManyBody()
        .strength(chargeStrength * (hasLayoutData ? 0.3 : 1))  // Weaker repulsion with UMAP
        .distanceMin(nodeRadius)
        .distanceMax(350 * scaling))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(gravity * (hasLayoutData ? 0.2 : 1)))
      .force('collision', d3.forceCollide().radius(nodeRadius + 2).strength(0.6))
      .velocityDecay(velocityDecay)
      .alphaDecay(alphaDecay)
      .alphaMin(0.001);

    simulationRef.current = simulation;

    // Helper to create safe CSS IDs (no special chars)
    const safeId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '_');
    
    const defs = svg.append('defs');
    nodes.forEach((d) => {
      defs.append('clipPath')
        .attr('id', `clip-${safeId(d.id)}`)
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', nodeRadius - 2);
    });

    const linkGroup = container.append('g').attr('class', 'links');
    const link = linkGroup.selectAll('line').data(links).join('line')
      .attr('stroke', 'rgba(99, 112, 242, 0.4)')
      .attr('stroke-width', (d) => 0.3 + d.weight * 1.2)
      .attr('stroke-opacity', (d) => 0.08 + d.weight * 0.35);

    const nodeGroup = container.append('g').attr('class', 'nodes');
    const node = nodeGroup.selectAll('g').data(nodes).join('g')
      .attr('class', 'cursor-pointer')
      .style('pointer-events', 'all');

    node.append('circle').attr('r', nodeRadius + 3)
      .attr('fill', (d) => getNodeColor(d.image, colorMode))
      .attr('opacity', 0.3).style('filter', 'blur(4px)');

    node.append('image')
      .attr('xlink:href', (d) => signedUrlsRef.get(d.id) || d.image.urls.small)
      .attr('x', -nodeRadius + 2).attr('y', -nodeRadius + 2)
      .attr('width', (nodeRadius - 2) * 2).attr('height', (nodeRadius - 2) * 2)
      .attr('clip-path', (d) => `url(#clip-${safeId(d.id)})`)
      .attr('preserveAspectRatio', 'xMidYMid slice');

    node.append('circle').attr('r', nodeRadius - 1).attr('fill', 'none')
      .attr('stroke', (d) => getNodeColor(d.image, colorMode))
      .attr('stroke-width', 1.5).attr('opacity', 0.85);

    node.append('circle').attr('r', nodeRadius + 2).attr('fill', 'none')
      .attr('stroke', 'rgba(34, 211, 238, 1)').attr('stroke-width', 2)
      .attr('opacity', 0).attr('class', 'hover-ring');

    node
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('.hover-ring').attr('opacity', 1);
        d3.select(this).raise();

        const connectedIds = new Set<string>([d.id]);
        links.forEach((l) => {
          const sid = typeof l.source === 'object' ? (l.source as GraphNode).id : String(l.source);
          const tid = typeof l.target === 'object' ? (l.target as GraphNode).id : String(l.target);
          if (sid === d.id) connectedIds.add(tid);
          if (tid === d.id) connectedIds.add(sid);
        });

        link.attr('stroke-opacity', (l: any) => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          return (sid === d.id || tid === d.id) ? 0.85 : 0.015;
        }).attr('stroke', (l: any) => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          return (sid === d.id || tid === d.id) ? 'rgba(34, 211, 238, 0.9)' : 'rgba(99, 112, 242, 0.1)';
        });

        node.attr('opacity', (n: any) => connectedIds.has(n.id) ? 1 : 0.15);
      })
      .on('mouseleave', function () {
        d3.select(this).select('.hover-ring').attr('opacity', 0);
        link.attr('stroke-opacity', (d: any) => 0.08 + d.weight * 0.35)
          .attr('stroke', 'rgba(99, 112, 242, 0.4)');
        node.attr('opacity', 1);
      })
      .on('click', (event, d) => { event.stopPropagation(); openModal(d.image); });

    const dragBehavior = d3.drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.02).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0);
      });

    node.call(dragBehavior as any);

    simulation.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    simulation.on('end', () => setIsStable(true));

    // Auto-scale zoom based on node count
    const scale = Math.min(0.9, Math.max(0.08, 30 / Math.sqrt(nodes.length)));
    svg.call(zoom.transform as any, d3.zoomIdentity.translate(width * 0.05, height * 0.05).scale(scale));
    }; // end buildGraph
    
    initGraph();

    return () => { 
      cancelled = true;
      if (simulationRef.current) {
        simulationRef.current.stop(); 
        simulationRef.current = null; 
      }
    };
  // Note: forceSettings and colorMode intentionally NOT in deps
  // - forceSettings: only recompute when Apply is clicked (edges change)  
  // - colorMode: handled by separate effect that just updates colors
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredImages, edges, dimensions, openModal]);
  
  // Update colors when colorMode changes (without recomputing layout)
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    const currentColorMode = useGalleryStore.getState().colorMode;
    
    console.log(`[NetworkGraph] Updating colors to mode: ${currentColorMode}`);
    
    // Update each node's glow and ring colors
    svg.selectAll('g').filter(function() {
      return d3.select(this).selectAll('circle').size() >= 3;
    }).each(function(d: any) {
      if (!d?.image) return;
      const newColor = getNodeColor(d.image, currentColorMode);
      
      // First circle is glow
      d3.select(this).select('circle:first-of-type')
        .attr('fill', newColor);
      
      // Second circle after image is the ring
      const circles = d3.select(this).selectAll('circle');
      if (circles.size() >= 3) {
        d3.select(circles.nodes()[2])
          .attr('stroke', newColor);
      }
    });
  }, [colorMode]);

  return (
    <motion.div ref={containerRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="w-full h-full relative bg-cosmos-void">
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="w-full h-full" style={{ touchAction: 'none' }} />

      <div className="absolute top-4 right-4 glass rounded-lg p-3 text-xs space-y-1">
        <div className="text-nebula-300">{nodeCount} nodes • {edgeCount} edges</div>
        <div className={isStable ? 'text-green-400' : 'text-yellow-400'}>
          {isStable ? '● Layout stable' : '○ Computing layout...'}
        </div>
      </div>


      {filteredImages.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-nebula-400">No images found</div>
      )}

      {edges.length === 0 && filteredImages.length > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-lg px-4 py-2 text-sm text-yellow-400">
          No edges found. Lower the similarity threshold.
        </div>
      )}
    </motion.div>
  );
}

