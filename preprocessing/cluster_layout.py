#!/usr/bin/env python3
"""
Compute Layout and Clusters from CLIP Embeddings

Supports multiple algorithms:
- UMAP for dimensionality reduction to 2D
- HDBSCAN for density-based clustering
- Louvain for modularity-based community detection (on similarity graph)

The output can be used to:
1. Initialize force-directed graph positions (faster convergence)
2. Show cluster/community boundaries in the UI
3. Enable "zoom to cluster" functionality
4. Color nodes by community

Usage:
    # From gallery directory (your pipeline structure)
    python cluster_layout.py --gallery ./gallery_processed --output ./layout.json
    
    # With Louvain community detection
    python cluster_layout.py --gallery ./gallery_processed --algorithm louvain
    
    # With both HDBSCAN and Louvain
    python cluster_layout.py --gallery ./gallery_processed --algorithm both
"""

import json
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import Counter

import numpy as np
import click
from tqdm import tqdm

# Optional dependencies
try:
    import umap
    HAS_UMAP = True
except ImportError:
    HAS_UMAP = False

try:
    import hdbscan
    HAS_HDBSCAN = True
except ImportError:
    HAS_HDBSCAN = False

try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False


@dataclass
class LayoutNode:
    id: str
    x: float
    y: float
    cluster: int
    community: int
    cluster_probability: float


def load_embedding(npy_path: Path) -> Optional[np.ndarray]:
    """Load a single .npy embedding file."""
    try:
        emb = np.load(npy_path)
        if emb.ndim > 1:
            emb = emb.squeeze()
        return emb.astype(np.float32)
    except Exception as e:
        print(f"Error loading {npy_path}: {e}")
        return None


def discover_embeddings(gallery_dir: Path) -> List[Tuple[str, Path]]:
    """Discover embeddings from gallery structure."""
    meta_dir = gallery_dir / "metadata"
    
    if not meta_dir.exists():
        # Try embeddings directory fallback
        emb_dir = gallery_dir / "embeddings"
        if emb_dir.exists():
            return [(p.stem, p) for p in sorted(emb_dir.glob("*.npy"))]
        return []
    
    return [(p.stem, p) for p in sorted(meta_dir.glob("*.npy"))]


def load_all_embeddings(embedding_paths: List[Tuple[str, Path]]) -> Tuple[List[str], np.ndarray]:
    """Load all embeddings and return (image_ids, embedding_matrix)."""
    embeddings = []
    image_ids = []
    
    for image_id, npy_path in tqdm(embedding_paths, desc="Loading embeddings"):
        emb = load_embedding(npy_path)
        if emb is not None:
            embeddings.append(emb)
            image_ids.append(image_id)
    
    if not embeddings:
        raise ValueError("No embeddings loaded!")
    
    embedding_matrix = np.vstack(embeddings)
    return image_ids, embedding_matrix


def compute_umap_layout(
    embeddings: np.ndarray,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    metric: str = 'cosine',
    random_state: int = 42,
) -> np.ndarray:
    """Reduce embeddings to 2D using UMAP."""
    if not HAS_UMAP:
        raise ImportError("umap-learn is required: pip install umap-learn")
    
    print(f"Running UMAP (n_neighbors={n_neighbors}, min_dist={min_dist})...")
    
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric=metric,
        random_state=random_state,
        verbose=True,
    )
    
    coords = reducer.fit_transform(embeddings)
    
    # Normalize to [0, 1000] range for UI consumption
    coords_min = coords.min(axis=0)
    coords_max = coords.max(axis=0)
    coords_normalized = (coords - coords_min) / (coords_max - coords_min + 1e-8) * 1000
    
    return coords_normalized


def compute_hdbscan_clusters(
    embeddings: np.ndarray,
    min_cluster_size: int = 5,
    min_samples: Optional[int] = None,
    metric: str = 'euclidean',
) -> Tuple[np.ndarray, np.ndarray]:
    """Cluster embeddings using HDBSCAN."""
    if not HAS_HDBSCAN:
        raise ImportError("hdbscan is required: pip install hdbscan")
    
    print(f"Running HDBSCAN (min_cluster_size={min_cluster_size})...")
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric=metric,
        cluster_selection_epsilon=0.0,
        prediction_data=True,
    )
    
    labels = clusterer.fit_predict(embeddings)
    probabilities = clusterer.probabilities_
    
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = (labels == -1).sum()
    
    print(f"Found {n_clusters} clusters, {n_noise} noise points")
    
    return labels, probabilities


def compute_louvain_communities(
    image_ids: List[str],
    embeddings: np.ndarray,
    threshold: float = 0.7,
    resolution: float = 1.0,
) -> np.ndarray:
    """
    Detect communities using the Louvain algorithm.
    
    This builds a similarity graph and then partitions it to maximize modularity.
    
    Louvain advantages:
    - Works directly on the graph structure (edge weights)
    - Fast for large graphs
    - Resolution parameter to control community granularity
    - Produces hierarchical communities
    """
    if not HAS_NETWORKX:
        raise ImportError("networkx is required: pip install networkx python-louvain")
    
    try:
        import community as community_louvain
        HAS_LOUVAIN = True
    except ImportError:
        HAS_LOUVAIN = False
    
    n = len(image_ids)
    
    # Normalize embeddings for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)
    
    # Build similarity graph
    print(f"Building similarity graph (threshold={threshold})...")
    G = nx.Graph()
    
    # Add all nodes
    for i, img_id in enumerate(image_ids):
        G.add_node(img_id)
    
    # Compute similarities and add edges
    # Use batched matrix multiplication for efficiency
    similarity_matrix = normalized @ normalized.T
    
    edge_count = 0
    for i in tqdm(range(n), desc="Adding edges"):
        for j in range(i + 1, n):
            sim = similarity_matrix[i, j]
            if sim >= threshold:
                # Weight = similarity (higher = more connected)
                G.add_edge(image_ids[i], image_ids[j], weight=float(sim))
                edge_count += 1
    
    print(f"Built graph with {n} nodes, {edge_count} edges")
    
    if edge_count == 0:
        print("⚠️  No edges above threshold! Try lowering --louvain-threshold")
        return np.zeros(n, dtype=np.int32)
    
    # Run Louvain community detection
    print(f"Running Louvain community detection (resolution={resolution})...")
    
    if HAS_LOUVAIN:
        # Use python-louvain library
        partition = community_louvain.best_partition(G, weight='weight', resolution=resolution)
    else:
        # Fallback to NetworkX's built-in Louvain (requires NetworkX >= 2.8)
        try:
            communities = nx.community.louvain_communities(G, weight='weight', resolution=resolution)
            partition = {}
            for comm_id, nodes in enumerate(communities):
                for node in nodes:
                    partition[node] = comm_id
        except AttributeError:
            print("⚠️  Louvain not available. Install: pip install python-louvain")
            return np.zeros(n, dtype=np.int32)
    
    # Convert to array
    community_labels = np.array([partition.get(img_id, -1) for img_id in image_ids], dtype=np.int32)
    
    n_communities = len(set(community_labels)) - (1 if -1 in community_labels else 0)
    print(f"Found {n_communities} communities")
    
    # Compute modularity
    if edge_count > 0:
        try:
            modularity = nx.community.modularity(
                G, 
                [{img_id for img_id, c in partition.items() if c == comm} 
                 for comm in set(partition.values())]
            )
            print(f"Modularity: {modularity:.4f}")
        except:
            pass
    
    return community_labels


def find_common_tags(image_ids: List[str], metadata_dir: Path) -> List[str]:
    """Find tags that appear in >50% of cluster members."""
    tag_counts = Counter()
    loaded = 0
    
    for image_id in image_ids:
        meta_path = metadata_dir / f"{image_id}.json"
        if meta_path.exists():
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                    all_tags = []
                    if isinstance(meta.get('tags'), dict):
                        for tags in meta['tags'].values():
                            all_tags.extend(tags)
                    tag_counts.update(all_tags)
                    loaded += 1
            except:
                pass
    
    if loaded == 0:
        return []
    
    threshold = loaded * 0.5
    common = [tag for tag, count in tag_counts.items() if count >= threshold]
    
    return sorted(common, key=lambda t: -tag_counts[t])[:5]


def generate_cluster_metadata(
    image_ids: List[str],
    labels: np.ndarray,
    label_type: str = "cluster",
    metadata_dir: Optional[Path] = None,
) -> Dict[int, Dict]:
    """Generate descriptive metadata for each cluster/community."""
    cluster_info = {}
    
    for cluster_id in set(labels):
        if cluster_id == -1:
            cluster_info[-1] = {
                "name": "Unclustered",
                "description": f"Images that don't fit clearly into any {label_type}",
                "count": int((labels == -1).sum()),
            }
            continue
        
        member_indices = np.where(labels == cluster_id)[0]
        member_ids = [image_ids[i] for i in member_indices]
        
        name = f"{label_type.capitalize()} {cluster_id + 1}"
        
        cluster_info[int(cluster_id)] = {
            "name": name,
            "count": len(member_ids),
            "members": member_ids[:10],
        }
        
        if metadata_dir:
            common_tags = find_common_tags(member_ids, metadata_dir)
            if common_tags:
                cluster_info[int(cluster_id)]["common_tags"] = common_tags
                cluster_info[int(cluster_id)]["name"] = " & ".join(common_tags[:2])
    
    return cluster_info


@click.command()
@click.option('--gallery', '-g', type=click.Path(exists=True),
              help='Gallery processed directory (metadata/*.npy)')
@click.option('--embeddings', '-e', type=click.Path(exists=True),
              help='Directory containing .npy embedding files (alternative)')
@click.option('--output', '-o', default='./layout.json',
              help='Output JSON file')
@click.option('--algorithm', '-a', default='hdbscan',
              type=click.Choice(['hdbscan', 'louvain', 'both']),
              help='Clustering algorithm')
@click.option('--n-neighbors', default=15, type=int,
              help='UMAP n_neighbors parameter')
@click.option('--min-dist', default=0.1, type=float,
              help='UMAP min_dist parameter')
@click.option('--min-cluster-size', default=5, type=int,
              help='HDBSCAN min_cluster_size parameter')
@click.option('--louvain-threshold', default=0.65, type=float,
              help='Similarity threshold for Louvain graph edges')
@click.option('--louvain-resolution', default=1.0, type=float,
              help='Louvain resolution (higher = more communities)')
@click.option('--skip-umap', is_flag=True,
              help='Skip UMAP, use random positions')
def main(
    gallery: Optional[str],
    embeddings: Optional[str],
    output: str,
    algorithm: str,
    n_neighbors: int,
    min_dist: float,
    min_cluster_size: int,
    louvain_threshold: float,
    louvain_resolution: float,
    skip_umap: bool,
):
    """Compute 2D layout and clusters/communities from CLIP embeddings."""
    
    if not gallery and not embeddings:
        raise click.UsageError("Either --gallery or --embeddings is required")
    
    # Discover embeddings
    if gallery:
        gallery_path = Path(gallery)
        embedding_paths = discover_embeddings(gallery_path)
        metadata_path = gallery_path / "metadata"
        print(f"\n🧭 Processing gallery: {gallery_path}")
    else:
        embedding_paths = [(Path(f).stem, Path(f)) for f in Path(embeddings).glob("*.npy")]
        metadata_path = None
        print(f"\n🧭 Processing embeddings: {embeddings}")
    
    output_path = Path(output)
    
    print(f"   Algorithm: {algorithm}")
    print(f"   Output:    {output_path}")
    
    if not embedding_paths:
        print("\n❌ No embeddings found!")
        return
    
    # Load embeddings
    image_ids, embedding_matrix = load_all_embeddings(embedding_paths)
    n, d = embedding_matrix.shape
    print(f"\n✅ Loaded {n} embeddings ({d}-dimensional)")
    
    # Compute 2D layout
    if skip_umap:
        print("\n⏭️  Skipping UMAP, using random positions")
        coords = np.random.rand(n, 2) * 1000
        layout_algo = "random"
    elif not HAS_UMAP:
        print("\n⚠️  UMAP not installed, using random positions")
        print("   Install with: pip install umap-learn")
        coords = np.random.rand(n, 2) * 1000
        layout_algo = "random"
    else:
        coords = compute_umap_layout(
            embedding_matrix,
            n_neighbors=n_neighbors,
            min_dist=min_dist,
        )
        layout_algo = "umap"
    
    # Initialize labels
    cluster_labels = np.zeros(n, dtype=np.int32)
    cluster_probs = np.ones(n)
    community_labels = np.zeros(n, dtype=np.int32)
    
    # HDBSCAN clustering
    if algorithm in ('hdbscan', 'both'):
        if HAS_HDBSCAN:
            cluster_labels, cluster_probs = compute_hdbscan_clusters(
                embedding_matrix,
                min_cluster_size=min_cluster_size,
            )
        else:
            print("\n⚠️  HDBSCAN not installed: pip install hdbscan")
    
    # Louvain community detection
    if algorithm in ('louvain', 'both'):
        if HAS_NETWORKX:
            community_labels = compute_louvain_communities(
                image_ids,
                embedding_matrix,
                threshold=louvain_threshold,
                resolution=louvain_resolution,
            )
        else:
            print("\n⚠️  NetworkX not installed: pip install networkx python-louvain")
    
    # Generate metadata
    cluster_info = {}
    community_info = {}
    
    if algorithm in ('hdbscan', 'both'):
        cluster_info = generate_cluster_metadata(
            image_ids, cluster_labels, "cluster", 
            metadata_path if metadata_path and metadata_path.exists() else None
        )
    
    if algorithm in ('louvain', 'both'):
        community_info = generate_cluster_metadata(
            image_ids, community_labels, "community",
            metadata_path if metadata_path and metadata_path.exists() else None
        )
    
    # Build output
    nodes = [
        {
            "id": image_ids[i],
            "x": float(coords[i, 0]),
            "y": float(coords[i, 1]),
            "cluster": int(cluster_labels[i]),
            "community": int(community_labels[i]),
            "cluster_probability": float(cluster_probs[i]),
        }
        for i in range(n)
    ]
    
    result = {
        "version": "1.0",
        "algorithm": {
            "layout": layout_algo,
            "clustering": algorithm,
            "umap_params": {
                "n_neighbors": n_neighbors,
                "min_dist": min_dist,
                "metric": "cosine",
            } if layout_algo == "umap" else None,
            "hdbscan_params": {
                "min_cluster_size": min_cluster_size,
            } if algorithm in ('hdbscan', 'both') else None,
            "louvain_params": {
                "threshold": louvain_threshold,
                "resolution": louvain_resolution,
            } if algorithm in ('louvain', 'both') else None,
        },
        "stats": {
            "total_images": n,
            "n_clusters": len([c for c in cluster_info if c != -1]) if cluster_info else 0,
            "n_communities": len([c for c in community_info if c != -1]) if community_info else 0,
            "noise_count": int((cluster_labels == -1).sum()) if algorithm in ('hdbscan', 'both') else 0,
        },
        "clusters": cluster_info,
        "communities": community_info,
        "nodes": nodes,
    }
    
    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    
    print(f"\n✅ Saved to: {output_path}")
    if cluster_info:
        print(f"   {len([c for c in cluster_info if c != -1])} clusters (HDBSCAN)")
    if community_info:
        print(f"   {len([c for c in community_info if c != -1])} communities (Louvain)")


if __name__ == '__main__':
    main()
