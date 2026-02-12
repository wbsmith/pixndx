/**
 * Community detection and LOD (Level of Detail) for graph visualization.
 * Uses Louvain algorithm on the precomputed neighbor graph to detect communities,
 * then selects representative nodes for each community.
 */

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { ImageMetadata } from '@/types/gallery';

export interface Community {
  id: number;
  members: string[];  // Image IDs
  representative: string;  // Image ID of representative node
  size: number;
}

export interface LODResult {
  communities: Community[];
  nodeToCommnity: Map<string, number>;
  representatives: Set<string>;
}

/**
 * Build a graph from image metadata using precomputed clipNeighbors.
 */
function buildNeighborGraph(images: ImageMetadata[]): Graph {
  const graph = new Graph({ type: 'undirected' });

  // Add all nodes
  for (const image of images) {
    graph.addNode(image.id, { image });
  }

  // Add edges from clipNeighbors
  const imageIds = new Set(images.map(img => img.id));
  for (const image of images) {
    const neighbors = image.clipNeighbors || [];
    for (const neighbor of neighbors) {
      // Only add edge if both nodes exist and edge doesn't already exist
      if (imageIds.has(neighbor.id) && !graph.hasEdge(image.id, neighbor.id)) {
        graph.addEdge(image.id, neighbor.id, { weight: neighbor.clipWeight });
      }
    }
  }

  return graph;
}

/**
 * Select representative node for a community.
 * Uses highest degree (most connected) as the criterion.
 * Could also use: highest rating, closest to centroid, etc.
 */
function selectRepresentative(
  graph: Graph,
  memberIds: string[],
  _images: Map<string, ImageMetadata>  // Available for future use (e.g., select by rating)
): string {
  let bestId = memberIds[0];
  let bestScore = -1;

  for (const id of memberIds) {
    // Use degree as primary criterion
    const degree = graph.degree(id);
    // Could add rating as secondary criterion:
    // const image = images.get(id);
    // const rating = image?.avgRating || 0;
    // const score = degree * 10 + rating;
    const score = degree;

    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return bestId;
}

/**
 * Detect communities in the image graph and select representatives.
 * @param images - Array of image metadata
 * @param resolution - Louvain resolution parameter (default 1.0, higher = more communities)
 */
export function detectCommunities(images: ImageMetadata[], resolution: number = 1.0): LODResult {
  if (images.length === 0) {
    return {
      communities: [],
      nodeToCommnity: new Map(),
      representatives: new Set(),
    };
  }

  // Build graph from neighbor data
  const graph = buildNeighborGraph(images);

  // Run Louvain community detection
  // Returns an object mapping node ID to community number
  const communityAssignments = louvain(graph, {
    resolution,  // Higher = more communities
  });

  // Group nodes by community
  const communityMembers = new Map<number, string[]>();
  const nodeToCommnity = new Map<string, number>();

  for (const [nodeId, communityId] of Object.entries(communityAssignments)) {
    nodeToCommnity.set(nodeId, communityId);
    if (!communityMembers.has(communityId)) {
      communityMembers.set(communityId, []);
    }
    communityMembers.get(communityId)!.push(nodeId);
  }

  // Create image lookup
  const imageMap = new Map(images.map(img => [img.id, img]));

  // Build community objects with representatives
  const communities: Community[] = [];
  const representatives = new Set<string>();

  for (const [communityId, members] of communityMembers) {
    const representative = selectRepresentative(graph, members, imageMap);
    representatives.add(representative);

    communities.push({
      id: communityId,
      members,
      representative,
      size: members.length,
    });
  }

  // Sort communities by size (largest first)
  communities.sort((a, b) => b.size - a.size);

  console.log(`[LOD] Detected ${communities.length} communities from ${images.length} images`);
  console.log(`[LOD] Community sizes: ${communities.slice(0, 5).map(c => c.size).join(', ')}${communities.length > 5 ? '...' : ''}`);

  return {
    communities,
    nodeToCommnity,
    representatives,
  };
}

/**
 * Determine which nodes to show based on zoom level and LOD settings.
 */
export function getVisibleNodes(
  allNodeIds: string[],
  lodResult: LODResult,
  zoomLevel: number,
  zoomThreshold: number
): Set<string> {
  // Above threshold: show all nodes
  if (zoomLevel >= zoomThreshold) {
    return new Set(allNodeIds);
  }

  // Below threshold: show only representatives
  return lodResult.representatives;
}

/**
 * Get node size multiplier based on community size (for representative nodes).
 */
export function getNodeSizeMultiplier(
  nodeId: string,
  lodResult: LODResult,
  zoomLevel: number,
  zoomThreshold: number
): number {
  // At full zoom, normal size
  if (zoomLevel >= zoomThreshold) {
    return 1;
  }

  // Find community for this node
  const communityId = lodResult.nodeToCommnity.get(nodeId);
  if (communityId === undefined) return 1;

  // Find community size
  const community = lodResult.communities.find(c => c.id === communityId);
  if (!community) return 1;

  // Scale size based on community size (sqrt to prevent huge nodes)
  // Representative nodes get size proportional to sqrt(community size)
  if (lodResult.representatives.has(nodeId)) {
    return Math.max(1, Math.sqrt(community.size) * 0.8);
  }

  return 1;
}
