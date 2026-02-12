/**
 * ForceAtlas2 Layout Algorithm
 *
 * Uses graphology-layout-forceatlas2/worker for animated layout computation.
 * The web worker runs continuously, updating graph positions which we
 * poll via requestAnimationFrame for smooth rendering.
 *
 * Good for larger graphs (500-5000 nodes) with distinct clusters.
 */

import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import type {
  LayoutAlgorithm,
  GraphNode,
  GraphLink,
  LayoutConfig,
  Position,
  PositionUpdateCallback,
  LayoutCompleteCallback,
  StabilityCallback,
} from '../types';

interface GraphNodeAttributes {
  x: number;
  y: number;
  image: any;
}

interface GraphEdgeAttributes {
  weight: number;
}

export class ForceAtlas2Algorithm implements LayoutAlgorithm {
  private graph: Graph<GraphNodeAttributes, GraphEdgeAttributes> | null = null;
  private layout: FA2Layout | null = null;
  private nodes: GraphNode[] = [];
  private config: LayoutConfig | null = null;

  private positionCallbacks: PositionUpdateCallback[] = [];
  private completeCallbacks: LayoutCompleteCallback[] = [];
  private stabilityCallbacks: StabilityCallback[] = [];

  private running = false;
  private animationFrameId: number | null = null;
  private startTime = 0;
  private maxIterationTime = 10000;  // Stop after 10 seconds

  initialize(nodes: GraphNode[], links: GraphLink[], config: LayoutConfig): void {
    this.destroy();  // Clean up previous state

    this.nodes = nodes;
    this.config = config;

    // Build graphology graph
    this.graph = new Graph<GraphNodeAttributes, GraphEdgeAttributes>({ type: 'undirected' });

    // Add nodes
    const addedNodes = new Set<string>();
    for (const node of nodes) {
      if (addedNodes.has(node.id) || this.graph.hasNode(node.id)) continue;
      addedNodes.add(node.id);

      this.graph.addNode(node.id, {
        x: node.x,
        y: node.y,
        image: node.image,
      });
    }

    // Add edges
    for (const link of links) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;

      if (this.graph.hasNode(sourceId) && this.graph.hasNode(targetId)) {
        try {
          this.graph.addEdge(sourceId, targetId, {
            weight: link.weight,
          });
        } catch {
          // Edge might already exist
        }
      }
    }
  }

  start(): void {
    if (!this.graph || !this.config) return;

    const { forceSettings } = this.config;
    const nodeCount = this.graph.order;

    // Map store settings to ForceAtlas2 parameters
    const gravity = forceSettings.gravity * 5;
    const scalingRatio = forceSettings.scaling * 5;

    console.log(`[FA2] Starting worker: ${nodeCount} nodes, gravity=${gravity.toFixed(2)}, scaling=${scalingRatio.toFixed(2)}`);

    // Create FA2 worker layout
    this.layout = new FA2Layout(this.graph, {
      settings: {
        barnesHutOptimize: nodeCount > 50,
        barnesHutTheta: 0.5,
        gravity,
        scalingRatio,
        strongGravityMode: forceSettings.strongGravityMode,
        slowDown: Math.max(1, nodeCount / 200),
        edgeWeightInfluence: forceSettings.edgeWeightInfluence,
        linLogMode: forceSettings.linLogMode,
        outboundAttractionDistribution: forceSettings.outboundAttractionDistribution,
      },
    });

    this.running = true;
    this.startTime = performance.now();

    // Start the web worker
    this.layout.start();

    // Start animation loop to poll positions
    this.animate();
  }

  private animate = (): void => {
    if (!this.running || !this.graph || !this.layout) return;

    // Update node positions from graph
    this.syncPositionsFromGraph();

    // Notify listeners
    this.positionCallbacks.forEach(cb => cb(this.nodes));

    // Check if we should stop (time limit or convergence)
    const elapsed = performance.now() - this.startTime;
    if (elapsed > this.maxIterationTime) {
      console.log(`[FA2] Stopping after ${elapsed.toFixed(0)}ms`);
      this.stop();
      this.stabilityCallbacks.forEach(cb => cb(true));
      this.completeCallbacks.forEach(cb => cb());
      return;
    }

    // Continue animation
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private syncPositionsFromGraph(): void {
    if (!this.graph) return;

    for (const node of this.nodes) {
      if (this.graph.hasNode(node.id)) {
        const attrs = this.graph.getNodeAttributes(node.id);
        node.x = attrs.x;
        node.y = attrs.y;
      }
    }
  }

  stop(): void {
    this.running = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.layout) {
      this.layout.stop();
    }
  }

  destroy(): void {
    this.stop();

    if (this.layout) {
      this.layout.kill();
      this.layout = null;
    }

    this.graph = null;
    this.nodes = [];
    this.positionCallbacks = [];
    this.completeCallbacks = [];
    this.stabilityCallbacks = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  getPositions(): Map<string, Position> {
    const positions = new Map<string, Position>();

    if (this.graph) {
      this.graph.forEachNode((nodeId, attrs) => {
        positions.set(nodeId, { x: attrs.x, y: attrs.y });
      });
    }

    return positions;
  }

  reheat(): void {
    // For FA2, just restart
    if (this.layout && !this.running) {
      this.running = true;
      this.startTime = performance.now();
      this.layout.start();
      this.animate();
    }
  }

  fixNode(nodeId: string, x: number, y: number): void {
    // FA2 worker doesn't support fixing nodes directly
    // Just update the position
    if (this.graph && this.graph.hasNode(nodeId)) {
      this.graph.setNodeAttribute(nodeId, 'x', x);
      this.graph.setNodeAttribute(nodeId, 'y', y);
    }

    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  releaseNode(_nodeId: string): void {
    // No-op for FA2
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

  /**
   * Get the underlying graphology graph for advanced usage.
   */
  getGraph(): Graph<GraphNodeAttributes, GraphEdgeAttributes> | null {
    return this.graph;
  }
}
