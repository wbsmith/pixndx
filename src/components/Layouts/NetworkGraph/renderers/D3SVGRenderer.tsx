/**
 * D3 SVG Renderer
 *
 * Renders graph nodes and edges using D3 with SVG.
 * Used by both D3 Force and ForceAtlas2 algorithms.
 * Features circular image nodes with glow effects.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphLink, LayoutAlgorithm } from '../types';
import type { ColorMode } from '@/stores/galleryStore';
import type { ImageMetadata } from '@/types/gallery';
import type { LODResult } from '@/lib/graph/communityDetection';
import {
  safeId,
  calculateNodeRadius,
  createClipPaths,
  createNodeElements,
  setupNodeHoverInteractions,
  updateNodeColors,
  type HighlightController,
} from '../shared/nodeStyles';
import { DEFAULT_EDGE_COLOR } from '../shared/colors';

interface D3SVGRendererProps {
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
  algorithm: LayoutAlgorithm;
  width: number;
  height: number;
}

export function D3SVGRenderer({
  nodes,
  links,
  colorMode,
  signedUrls,
  lodResult,
  lodSettings,
  onNodeClick,
  onZoomChange,
  algorithm,
  width,
  height,
}: D3SVGRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<SVGGElement | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null);
  const highlightControllerRef = useRef<HighlightController | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const nodeRadius = calculateNodeRadius(nodes.length);
  const lodActive = lodSettings.enabled && lodResult && nodes.length > lodSettings.nodeThreshold;

  // Get connected node IDs for hover
  const getConnectedIds = useCallback((nodeId: string) => {
    const connectedIds = new Set<string>([nodeId]);
    links.forEach((l) => {
      const sid = typeof l.source === 'object' ? (l.source as GraphNode).id : String(l.source);
      const tid = typeof l.target === 'object' ? (l.target as GraphNode).id : String(l.target);
      if (sid === nodeId) connectedIds.add(tid);
      if (tid === nodeId) connectedIds.add(sid);
    });
    return connectedIds;
  }, [links]);

  // Initialize SVG structure
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create defs for clip paths
    const defs = svg.append('defs');
    createClipPaths(defs, nodes, nodeRadius);

    // Create main container for zoom
    const container = svg.append('g');
    containerRef.current = container.node();

    // Setup zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 5])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);

        const zoomLevel = event.transform.k;
        onZoomChange?.(zoomLevel);

        // LOD visibility
        if (lodActive && lodResult && nodeSelectionRef.current && linkSelectionRef.current) {
          applyLODVisibility(zoomLevel);
        }
      });

    svg.call(zoom);

    // Create link group
    const linkGroup = container.append('g').attr('class', 'links');
    const linkSelection = linkGroup.selectAll<SVGLineElement, GraphLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', DEFAULT_EDGE_COLOR)
      .attr('stroke-width', (d) => 0.3 + d.weight * 1.2)
      .attr('stroke-opacity', (d) => 0.08 + d.weight * 0.35);

    linkSelectionRef.current = linkSelection;

    // Create node group
    const nodeGroup = container.append('g').attr('class', 'nodes');
    const nodeSelection = createNodeElements(
      nodeGroup,
      nodes,
      nodeRadius,
      colorMode,
      signedUrls
    );

    nodeSelectionRef.current = nodeSelection;

    // Setup interactions - store the controller for cleanup handlers
    const highlightController = setupNodeHoverInteractions(nodeSelection, linkSelection, getConnectedIds);
    highlightControllerRef.current = highlightController;

    // Click handler on nodes
    nodeSelection.on('click', (event, d) => {
      event.stopPropagation();
      onNodeClick(d.image);
    });

    // Fallback: clear highlight when clicking on empty canvas space
    svg.on('click', () => {
      highlightController.clearHighlight();
    });

    // Fallback: clear highlight when cursor leaves the SVG entirely
    svg.on('mouseleave', () => {
      highlightController.clearHighlight();
    });

    // Drag behavior
    const drag = d3.drag<SVGGElement, GraphNode>()
      .on('start', (_event, d) => {
        algorithm.fixNode?.(d.id, d.x, d.y);
        algorithm.reheat?.();
      })
      .on('drag', (event, d) => {
        d.x = event.x;
        d.y = event.y;
        algorithm.fixNode?.(d.id, event.x, event.y);
        d3.select(event.sourceEvent.target.parentNode)
          .attr('transform', `translate(${event.x},${event.y})`);
      })
      .on('end', (_event, d) => {
        algorithm.releaseNode?.(d.id);
      });

    nodeSelection.call(drag as any);

    // Initial zoom to fit
    const scale = Math.min(0.9, Math.max(0.08, 30 / Math.sqrt(nodes.length)));
    const initialTransform = d3.zoomIdentity
      .translate(width * 0.05, height * 0.05)
      .scale(scale);
    svg.call(zoom.transform as any, initialTransform);

    // Apply initial LOD visibility
    if (lodActive && lodResult && scale < lodSettings.zoomThreshold) {
      applyLODVisibility(scale);
    }

    setIsInitialized(true);

    return () => {
      setIsInitialized(false);
    };
  }, [nodes.length, links.length, width, height]);

  // Update positions when algorithm updates
  useEffect(() => {
    if (!isInitialized || !nodeSelectionRef.current || !linkSelectionRef.current) return;

    const updatePositions = (updatedNodes: GraphNode[]) => {
      // Update node positions
      nodeSelectionRef.current
        ?.data(updatedNodes)
        .attr('transform', (d) => {
          const x = Number.isFinite(d.x) ? d.x : 0;
          const y = Number.isFinite(d.y) ? d.y : 0;
          return `translate(${x},${y})`;
        });

      // Update link positions
      linkSelectionRef.current
        ?.attr('x1', (d: any) => d.source.x ?? 0)
        .attr('y1', (d: any) => d.source.y ?? 0)
        .attr('x2', (d: any) => d.target.x ?? 0)
        .attr('y2', (d: any) => d.target.y ?? 0);
    };

    algorithm.onPositionUpdate(updatePositions);

    // Initial position update
    updatePositions(nodes);
  }, [isInitialized, algorithm, nodes]);

  // Update colors when colorMode changes
  useEffect(() => {
    if (!svgRef.current || !isInitialized) return;
    const svg = d3.select(svgRef.current);
    updateNodeColors(svg, colorMode);
  }, [colorMode, isInitialized]);

  // Compute size multiplier for a representative node based on community size
  const getRepresentativeSizeMultiplier = useCallback((nodeId: string) => {
    if (!lodResult) return 1;
    const communityId = lodResult.nodeToCommnity.get(nodeId);
    if (communityId === undefined) return 1;
    const community = lodResult.communities.find(c => c.id === communityId);
    if (!community) return 1;
    return Math.max(1.5, Math.sqrt(community.size) * 0.8);
  }, [lodResult]);

  // LOD visibility helper - shows only representatives when zoomed out, with enlarged sizes
  const applyLODVisibility = useCallback((zoomLevel: number) => {
    if (!lodResult || !nodeSelectionRef.current || !linkSelectionRef.current || !svgRef.current) return;

    const isZoomedOut = zoomLevel < lodSettings.zoomThreshold;
    const svg = d3.select(svgRef.current);

    if (isZoomedOut) {
      // Zoomed out: show only representatives with scaled sizes
      nodeSelectionRef.current.each(function(d) {
        const isRep = lodResult.representatives.has(d.id);
        const node = d3.select(this);

        if (!isRep) {
          node.style('display', 'none');
        } else {
          node.style('display', null);

          // Scale up representative nodes
          const scale = getRepresentativeSizeMultiplier(d.id);

          // Update clip path radius for this node
          svg.select(`#clip-${safeId(d.id)} circle`)
            .attr('r', (nodeRadius - 2) * scale);

          // Scale glow
          node.select('circle.glow')
            .attr('r', (nodeRadius + 3) * scale);

          // Scale image
          node.select('image')
            .attr('x', (-nodeRadius + 2) * scale)
            .attr('y', (-nodeRadius + 2) * scale)
            .attr('width', (nodeRadius - 2) * 2 * scale)
            .attr('height', (nodeRadius - 2) * 2 * scale);

          // Scale ring
          node.select('circle.ring')
            .attr('r', (nodeRadius - 1) * scale)
            .attr('stroke-width', 1.5 * scale);

          // Scale hover ring
          node.select('circle.hover-ring')
            .attr('r', (nodeRadius + 2) * scale);
        }
      });

      // Hide edges to non-representative nodes
      linkSelectionRef.current.style('display', (d: any) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : String(d.source);
        const targetId = typeof d.target === 'object' ? d.target.id : String(d.target);
        return lodResult.representatives.has(sourceId) && lodResult.representatives.has(targetId)
          ? null
          : 'none';
      });
    } else {
      // Zoomed in: show all nodes at normal size
      nodeSelectionRef.current.each(function(d) {
        const node = d3.select(this);
        node.style('display', null);

        // Reset clip path radius
        svg.select(`#clip-${safeId(d.id)} circle`)
          .attr('r', nodeRadius - 2);

        // Reset to normal size
        node.select('circle.glow')
          .attr('r', nodeRadius + 3);

        node.select('image')
          .attr('x', -nodeRadius + 2)
          .attr('y', -nodeRadius + 2)
          .attr('width', (nodeRadius - 2) * 2)
          .attr('height', (nodeRadius - 2) * 2);

        node.select('circle.ring')
          .attr('r', nodeRadius - 1)
          .attr('stroke-width', 1.5);

        node.select('circle.hover-ring')
          .attr('r', nodeRadius + 2);
      });

      linkSelectionRef.current.style('display', null);
    }
  }, [lodResult, lodSettings.zoomThreshold, nodeRadius, getRepresentativeSizeMultiplier]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="w-full h-full"
      style={{ touchAction: 'none' }}
    />
  );
}
