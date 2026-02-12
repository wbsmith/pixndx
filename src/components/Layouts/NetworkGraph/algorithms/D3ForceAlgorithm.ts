/**
 * D3 Force Layout Algorithm
 *
 * Uses D3's force simulation for animated graph layout.
 * Good for interactive exploration with < 500 nodes.
 */

import * as d3 from 'd3';
import type {
  LayoutAlgorithm,
  GraphNode,
  GraphLink,
  LayoutConfig,
  Position,
  PositionUpdateCallback,
  LayoutCompleteCallback,
  StabilityCallback,
  InstabilityCallback,
} from '../types';

export class D3ForceAlgorithm implements LayoutAlgorithm {
  private simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private config: LayoutConfig | null = null;

  private positionCallbacks: PositionUpdateCallback[] = [];
  private completeCallbacks: LayoutCompleteCallback[] = [];
  private stabilityCallbacks: StabilityCallback[] = [];
  private instabilityCallbacks: InstabilityCallback[] = [];

  private running = false;

  initialize(nodes: GraphNode[], links: GraphLink[], config: LayoutConfig): void {
    this.nodes = nodes;
    this.links = links;
    this.config = config;

    // Clean up existing simulation
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
  }

  start(): void {
    if (!this.config || this.nodes.length === 0) return;

    const { width, height, forceSettings, hasLayoutData } = this.config;
    const { gravity, scaling, edgeWeightInfluence } = forceSettings;

    const nodeCount = this.nodes.length;
    const nodeRadius = Math.max(12, Math.min(30, 600 / Math.sqrt(nodeCount)));
    const chargeStrength = Math.max(-150, -40000 / nodeCount) * scaling;

    // If we have UMAP positions, use gentler forces to preserve the layout
    const alphaDecay = hasLayoutData ? 0.05 : 0.018;
    const velocityDecay = hasLayoutData ? 0.6 : 0.4;
    const linkStrengthMultiplier = hasLayoutData ? 0.5 : 1.0;

    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(this.links)
        .id((d) => d.id)
        .distance((d) => (20 + 80 * (1 - d.weight)) * scaling)
        .strength((d) => (0.2 + d.weight * 0.6) * edgeWeightInfluence * linkStrengthMultiplier))
      .force('charge', d3.forceManyBody()
        .strength(chargeStrength * (hasLayoutData ? 0.3 : 1))
        .distanceMin(nodeRadius)
        .distanceMax(350 * scaling))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(gravity * (hasLayoutData ? 0.2 : 1)))
      .force('collision', d3.forceCollide().radius(nodeRadius + 2).strength(0.6))
      .velocityDecay(velocityDecay)
      .alphaDecay(alphaDecay)
      .alphaMin(0.001);

    this.running = true;

    this.simulation.on('tick', () => {
      // Check for numerical instability
      let hasInstability = false;
      for (const n of this.nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y) ||
            Math.abs(n.x!) > 1e6 || Math.abs(n.y!) > 1e6) {
          hasInstability = true;
          break;
        }
      }

      if (hasInstability) {
        this.stop();
        this.instabilityCallbacks.forEach(cb => cb());
        return;
      }

      // Notify position update callbacks
      this.positionCallbacks.forEach(cb => cb(this.nodes));
    });

    this.simulation.on('end', () => {
      this.running = false;
      this.stabilityCallbacks.forEach(cb => cb(true));
      this.completeCallbacks.forEach(cb => cb());
    });
  }

  stop(): void {
    if (this.simulation) {
      this.simulation.stop();
      this.running = false;
    }
  }

  destroy(): void {
    this.stop();
    this.simulation = null;
    this.nodes = [];
    this.links = [];
    this.positionCallbacks = [];
    this.completeCallbacks = [];
    this.stabilityCallbacks = [];
    this.instabilityCallbacks = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  getPositions(): Map<string, Position> {
    const positions = new Map<string, Position>();
    for (const node of this.nodes) {
      positions.set(node.id, { x: node.x, y: node.y });
    }
    return positions;
  }

  reheat(): void {
    if (this.simulation) {
      this.simulation.alphaTarget(0.02).restart();
      this.running = true;

      // Decay alpha target after a short time
      setTimeout(() => {
        if (this.simulation) {
          this.simulation.alphaTarget(0);
        }
      }, 300);
    }
  }

  fixNode(nodeId: string, x: number, y: number): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.fx = x;
      node.fy = y;
    }

    if (this.simulation) {
      this.simulation.alphaTarget(0.02).restart();
    }
  }

  releaseNode(nodeId: string): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }

    if (this.simulation) {
      this.simulation.alphaTarget(0);
    }
  }

  onPositionUpdate(callback: PositionUpdateCallback): void {
    this.positionCallbacks.push(callback);
  }

  onComplete(callback: LayoutCompleteCallback): void {
    this.completeCallbacks.push(callback);
  }

  onStabilityChange(callback: StabilityCallback): void {
    this.stabilityCallbacks.push(callback);
  }

  onInstability(callback: InstabilityCallback): void {
    this.instabilityCallbacks.push(callback);
  }

  /**
   * Get the underlying D3 simulation for advanced usage.
   */
  getSimulation(): d3.Simulation<GraphNode, GraphLink> | null {
    return this.simulation;
  }
}
