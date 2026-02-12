/**
 * Sigma.js WebGL Algorithm
 *
 * Uses Sigma.js with ForceAtlas2 supervisor for WebGL-accelerated rendering.
 * Best for very large graphs (5000+ nodes) where SVG becomes too slow.
 *
 * Note: This algorithm handles its own rendering via Sigma, so it doesn't
 * return positions for external rendering. Instead, it manages the entire
 * visualization lifecycle.
 */

import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
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
import type { ImageMetadata } from '@/types/gallery';
import type { ColorMode } from '@/stores/galleryStore';
import { getNodeColor } from '../shared/colors';

interface SigmaNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  type: string;
  image: string;
  label: string;
  imageData: ImageMetadata;
}

interface SigmaEdgeAttributes {
  weight: number;
  color: string;
  size: number;
}

export class SigmaAlgorithm implements LayoutAlgorithm {
  private graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null = null;
  private sigma: any = null;  // Sigma instance
  private container: HTMLElement | null = null;
  private nodes: GraphNode[] = [];
  private config: LayoutConfig | null = null;
  private colorMode: ColorMode = 'color';
  private signedUrls: Map<string, string> = new Map();
  private onNodeClick: ((image: ImageMetadata) => void) | null = null;

  private positionCallbacks: PositionUpdateCallback[] = [];
  private completeCallbacks: LayoutCompleteCallback[] = [];
  private stabilityCallbacks: StabilityCallback[] = [];

  private running = false;
  private sigmaAvailable = false;

  /**
   * Set the container element for Sigma rendering.
   */
  setContainer(container: HTMLElement): void {
    this.container = container;
  }

  /**
   * Set the color mode for node coloring.
   */
  setColorMode(colorMode: ColorMode): void {
    this.colorMode = colorMode;
    this.updateColors();
  }

  /**
   * Set signed URLs for image loading.
   */
  setSignedUrls(urls: Map<string, string>): void {
    this.signedUrls = urls;
  }

  /**
   * Set click handler for nodes.
   */
  setOnNodeClick(handler: (image: ImageMetadata) => void): void {
    this.onNodeClick = handler;
  }

  initialize(nodes: GraphNode[], links: GraphLink[], config: LayoutConfig): void {
    this.destroy();  // Clean up previous state

    this.nodes = nodes;
    this.config = config;

    // Build graphology graph
    this.graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({ type: 'undirected' });

    // Add nodes
    const addedNodes = new Set<string>();
    for (const node of nodes) {
      if (addedNodes.has(node.id) || this.graph.hasNode(node.id)) continue;
      addedNodes.add(node.id);

      const imageUrl = this.signedUrls.get(node.id) || node.image.urls.small;

      this.graph.addNode(node.id, {
        x: node.x,
        y: node.y,
        size: 15 * (node.sizeMultiplier ?? 1),
        color: getNodeColor(node.image, this.colorMode),
        type: 'image',
        image: imageUrl,
        label: node.image.main_subject || node.id,
        imageData: node.image,
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
            color: `rgba(99, 112, 242, ${0.1 + link.weight * 0.4})`,
            size: 0.5 + link.weight * 2,
          });
        } catch {
          // Edge might already exist
        }
      }
    }
  }

  async start(): Promise<void> {
    if (!this.graph || !this.config || !this.container) return;

    const { forceSettings } = this.config;
    const nodeCount = this.graph.order;

    // Check if Sigma is available
    try {
      const Sigma = (await import('sigma')).default;
      this.sigmaAvailable = true;

      // Run ForceAtlas2 layout (synchronously, unlike the worker version)
      console.log(`[Sigma] Running ForceAtlas2 for ${nodeCount} nodes...`);
      const startTime = performance.now();

      forceAtlas2.assign(this.graph, {
        iterations: Math.min(300, Math.max(50, 500 - nodeCount * 0.05)),
        settings: {
          barnesHutOptimize: true,
          barnesHutTheta: 0.8,
          gravity: forceSettings.gravity * 10,
          scalingRatio: forceSettings.scaling * 10,
          strongGravityMode: true,
          slowDown: 2,
          edgeWeightInfluence: forceSettings.edgeWeightInfluence,
        },
      });

      console.log(`[Sigma] Layout done in ${(performance.now() - startTime).toFixed(0)}ms`);

      // Sync positions back to nodes
      this.syncPositionsFromGraph();

      // Try to load node-image program
      let nodeProgram;
      try {
        const { NodeImageProgram } = await import('@sigma/node-image');
        nodeProgram = NodeImageProgram;
      } catch {
        console.warn('@sigma/node-image not available, using circles');
      }

      // Create Sigma renderer
      this.sigma = new Sigma(this.graph, this.container, {
        renderLabels: false,
        renderEdgeLabels: false,
        enableEdgeEvents: true,
        defaultNodeType: nodeProgram ? 'image' : 'circle',
        nodeProgramClasses: nodeProgram ? { image: nodeProgram } : undefined,
      });

      this.setupInteractions();

      this.running = false;  // Sigma doesn't have continuous animation
      this.stabilityCallbacks.forEach(cb => cb(true));
      this.completeCallbacks.forEach(cb => cb());

    } catch (error) {
      console.warn('Sigma.js not installed:', error);
      this.sigmaAvailable = false;
    }
  }

  private setupInteractions(): void {
    if (!this.sigma || !this.graph) return;

    // Click handler
    this.sigma.on('clickNode', ({ node }: { node: string }) => {
      const attrs = this.graph!.getNodeAttributes(node);
      if (attrs.imageData && this.onNodeClick) {
        this.onNodeClick(attrs.imageData);
      }
    });

    // Hover handlers
    let highlightedNode: string | null = null;
    let highlightedNeighbors = new Set<string>();

    this.sigma.on('enterNode', ({ node }: { node: string }) => {
      highlightedNode = node;
      highlightedNeighbors = new Set(this.graph!.neighbors(node));
      highlightedNeighbors.add(node);

      this.sigma.setSetting('nodeReducer', (n: string, data: any) => {
        if (highlightedNode && !highlightedNeighbors.has(n)) {
          return { ...data, color: '#333', zIndex: 0 };
        }
        if (n === highlightedNode) {
          return { ...data, zIndex: 2, size: data.size * 1.3 };
        }
        return { ...data, zIndex: 1 };
      });

      this.sigma.setSetting('edgeReducer', (edge: string, data: any) => {
        const [source, target] = this.graph!.extremities(edge);
        if (highlightedNode === source || highlightedNode === target) {
          return { ...data, color: 'rgba(34, 211, 238, 0.8)', size: 2 };
        }
        return { ...data, color: 'rgba(99, 112, 242, 0.05)' };
      });

      this.sigma.refresh();
    });

    this.sigma.on('leaveNode', () => {
      highlightedNode = null;
      highlightedNeighbors.clear();

      this.sigma.setSetting('nodeReducer', (_node: string, data: any) => data);
      this.sigma.setSetting('edgeReducer', (_edge: string, data: any) => data);
      this.sigma.refresh();
    });

    // Reset on stage click
    this.sigma.on('clickStage', () => {
      if (highlightedNode) {
        highlightedNode = null;
        highlightedNeighbors.clear();
        this.sigma.setSetting('nodeReducer', (_node: string, data: any) => data);
        this.sigma.setSetting('edgeReducer', (_edge: string, data: any) => data);
        this.sigma.refresh();
      }
    });

    // Reset on mouse leave
    const handleMouseLeave = () => {
      if (highlightedNode) {
        highlightedNode = null;
        highlightedNeighbors.clear();
        this.sigma.setSetting('nodeReducer', (_node: string, data: any) => data);
        this.sigma.setSetting('edgeReducer', (_edge: string, data: any) => data);
        this.sigma.refresh();
      }
    };

    this.container?.addEventListener('mouseleave', handleMouseLeave);
  }

  private syncPositionsFromGraph(): void {
    if (!this.graph) return;

    for (const node of this.nodes) {
      if (this.graph.hasNode(node.id)) {
        const attrs = this.graph.getNodeAttributes(node.id);
        node.x = attrs.x;
        node.y = attrs.y;
      }
    }

    this.positionCallbacks.forEach(cb => cb(this.nodes));
  }

  private updateColors(): void {
    if (!this.graph || !this.sigma) return;

    this.graph.forEachNode((node, attrs) => {
      const newColor = getNodeColor(attrs.imageData, this.colorMode);
      this.graph!.setNodeAttribute(node, 'color', newColor);
    });

    this.sigma.refresh();
  }

  stop(): void {
    this.running = false;
  }

  destroy(): void {
    this.stop();

    if (this.sigma) {
      this.sigma.kill();
      this.sigma = null;
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

  isSigmaAvailable(): boolean {
    return this.sigmaAvailable;
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
   * Get the underlying Sigma instance.
   */
  getSigma(): any {
    return this.sigma;
  }

  /**
   * Get the underlying graphology graph.
   */
  getGraph(): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null {
    return this.graph;
  }
}
