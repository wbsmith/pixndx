/**
 * Shared node styling utilities for D3 SVG rendering.
 * Creates consistent circular image nodes with glow effects.
 */

import * as d3 from 'd3';
import type { GraphNode } from '../types';
import { getNodeColor, DEFAULT_EDGE_COLOR, HIGHLIGHT_EDGE_COLOR, HOVER_RING_COLOR } from './colors';
import type { ColorMode } from '@/stores/galleryStore';

/**
 * Create a safe CSS ID from a node ID (removes special characters).
 */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Calculate node radius based on total node count.
 */
export function calculateNodeRadius(nodeCount: number): number {
  return Math.max(12, Math.min(30, 600 / Math.sqrt(nodeCount)));
}

/**
 * Create clip paths for circular node images.
 */
export function createClipPaths(
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  nodes: GraphNode[],
  nodeRadius: number
): void {
  nodes.forEach((node) => {
    const r = (nodeRadius - 2) * (node.sizeMultiplier ?? 1);
    defs.append('clipPath')
      .attr('id', `clip-${safeId(node.id)}`)
      .append('circle')
      .attr('r', r);
  });
}

/**
 * Create node elements with consistent styling.
 */
export function createNodeElements(
  nodeGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: GraphNode[],
  nodeRadius: number,
  colorMode: ColorMode,
  signedUrls: Map<string, string>
): d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> {
  const nodeSelection = nodeGroup.selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'cursor-pointer node')
    .style('pointer-events', 'all');

  // Glow effect - scaled for LOD representatives
  nodeSelection.append('circle')
    .attr('r', (d) => (nodeRadius + 3) * (d.sizeMultiplier ?? 1))
    .attr('fill', (d) => getNodeColor(d.image, colorMode))
    .attr('opacity', 0.3)
    .style('filter', 'blur(4px)')
    .attr('class', 'glow');

  // Image - scaled for LOD representatives
  nodeSelection.append('image')
    .attr('xlink:href', (d) => signedUrls.get(d.id) || d.image.urls.small)
    .attr('x', (d) => (-nodeRadius + 2) * (d.sizeMultiplier ?? 1))
    .attr('y', (d) => (-nodeRadius + 2) * (d.sizeMultiplier ?? 1))
    .attr('width', (d) => (nodeRadius - 2) * 2 * (d.sizeMultiplier ?? 1))
    .attr('height', (d) => (nodeRadius - 2) * 2 * (d.sizeMultiplier ?? 1))
    .attr('clip-path', (d) => `url(#clip-${safeId(d.id)})`)
    .attr('preserveAspectRatio', 'xMidYMid slice');

  // Colored ring border - scaled for LOD representatives
  nodeSelection.append('circle')
    .attr('r', (d) => (nodeRadius - 1) * (d.sizeMultiplier ?? 1))
    .attr('fill', 'none')
    .attr('stroke', (d) => getNodeColor(d.image, colorMode))
    .attr('stroke-width', (d) => 1.5 * (d.sizeMultiplier ?? 1))
    .attr('opacity', 0.85)
    .attr('class', 'ring');

  // Hover ring (hidden by default) - scaled for LOD representatives
  nodeSelection.append('circle')
    .attr('r', (d) => (nodeRadius + 2) * (d.sizeMultiplier ?? 1))
    .attr('fill', 'none')
    .attr('stroke', HOVER_RING_COLOR)
    .attr('stroke-width', 2)
    .attr('opacity', 0)
    .attr('class', 'hover-ring');

  return nodeSelection;
}

/**
 * Update node colors without re-creating elements.
 */
export function updateNodeColors(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  colorMode: ColorMode
): void {
  svg.selectAll<SVGGElement, GraphNode>('g.node').each(function(d) {
    if (!d?.image) return;
    const newColor = getNodeColor(d.image, colorMode);

    // Update glow
    d3.select(this).select('circle.glow')
      .attr('fill', newColor);

    // Update ring
    d3.select(this).select('circle.ring')
      .attr('stroke', newColor);
  });
}

/**
 * Set up hover interactions for nodes.
 */
export function setupNodeHoverInteractions(
  nodeSelection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  linkSelection: d3.Selection<SVGLineElement, any, SVGGElement, unknown>,
  getConnectedIds: (nodeId: string) => Set<string>
): void {
  nodeSelection
    .on('mouseenter', function(_event, d) {
      d3.select(this).select('.hover-ring').attr('opacity', 1);
      d3.select(this).raise();

      const connectedIds = getConnectedIds(d.id);

      // Highlight connected edges
      linkSelection
        .attr('stroke-opacity', (l: any) => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          return (sid === d.id || tid === d.id) ? 0.85 : 0.015;
        })
        .attr('stroke', (l: any) => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          return (sid === d.id || tid === d.id) ? HIGHLIGHT_EDGE_COLOR : 'rgba(99, 112, 242, 0.1)';
        });

      // Dim unconnected nodes
      nodeSelection.attr('opacity', (n) => connectedIds.has(n.id) ? 1 : 0.15);
    })
    .on('mouseleave', function() {
      d3.select(this).select('.hover-ring').attr('opacity', 0);

      // Reset edges
      linkSelection
        .attr('stroke-opacity', (d: any) => 0.08 + d.weight * 0.35)
        .attr('stroke', DEFAULT_EDGE_COLOR);

      // Reset nodes
      nodeSelection.attr('opacity', 1);
    });
}
