#!/usr/bin/env python3
"""
Compute Similarity Edges from CLIP Embeddings

Efficiently computes pairwise cosine similarity for all image pairs,
outputting edges above a threshold for graph visualization.

Supports two directory structures:
1. Flat: embeddings/*.npy (legacy)
2. Your pipeline: metadata/*.npy alongside metadata/*.json

For large collections (>5000 images), uses FAISS for approximate 
nearest neighbor search to avoid O(n²) scaling.

Usage:
    # From gallery_processed directory (your pipeline structure)
    python compute_similarity.py --gallery ./gallery_processed --output ./edges.json
    
    # From separate embeddings directory
    python compute_similarity.py --embeddings ./embeddings --output ./edges.json
    
    # With options
    python compute_similarity.py --gallery ./gallery_processed -t 0.75 -m 30 -k 150
"""

import os
import json
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

import numpy as np
import click
from tqdm import tqdm

# Optional: FAISS for large-scale approximate search
try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False
    print("Note: FAISS not installed. Will use exact search (slower for large datasets).")
    print("      Install with: pip install faiss-cpu (or faiss-gpu for CUDA)")


@dataclass
class SimilarityEdge:
    source: str
    target: str
    weight: float


def load_embedding(npy_path: Path) -> Optional[np.ndarray]:
    """Load a single .npy embedding file."""
    try:
        emb = np.load(npy_path)
        # Handle different shapes: (512,) or (1, 512)
        if emb.ndim > 1:
            emb = emb.squeeze()
        return emb.astype(np.float32)
    except Exception as e:
        print(f"Error loading {npy_path}: {e}")
        return None


def discover_embeddings_gallery(gallery_dir: Path) -> List[Tuple[str, Path]]:
    """
    Discover embeddings from your gallery_processed structure.
    Structure: gallery_processed/metadata/*.npy (flat)
    """
    meta_dir = gallery_dir / "metadata"
    
    if not meta_dir.exists():
        print(f"Error: {meta_dir} not found")
        return []
    
    results = []
    for npy_path in meta_dir.glob("*.npy"):
        image_id = npy_path.stem
        results.append((image_id, npy_path))
    
    return sorted(results, key=lambda x: x[0])


def discover_embeddings_flat(embeddings_dir: Path) -> List[Tuple[str, Path]]:
    """
    Discover embeddings from flat directory.
    Structure: embeddings/*.npy
    """
    results = []
    for npy_path in embeddings_dir.glob("*.npy"):
        image_id = npy_path.stem
        results.append((image_id, npy_path))
    
    return sorted(results, key=lambda x: x[0])


def load_all_embeddings(
    embedding_paths: List[Tuple[str, Path]]
) -> Tuple[List[str], np.ndarray]:
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
    
    # Stack into matrix (n_images, embedding_dim)
    embedding_matrix = np.vstack(embeddings)
    
    # Normalize for cosine similarity (dot product of normalized vectors = cosine)
    norms = np.linalg.norm(embedding_matrix, axis=1, keepdims=True)
    embedding_matrix = embedding_matrix / (norms + 1e-8)
    
    return image_ids, embedding_matrix


def compute_edges_exact(
    image_ids: List[str],
    embeddings: np.ndarray,
    threshold: float = 0.7,
    max_edges_per_node: int = 50,
) -> List[SimilarityEdge]:
    """
    Compute all pairwise similarities using exact matrix multiplication.
    
    Suitable for datasets up to ~5000 images.
    """
    n = len(image_ids)
    
    # Compute full similarity matrix (n x n)
    # Since embeddings are normalized, this gives cosine similarity
    print(f"Computing {n}x{n} similarity matrix...")
    similarity_matrix = embeddings @ embeddings.T
    
    # Count edges per node for limiting
    edge_counts = np.zeros(n, dtype=np.int32)
    
    edges = []
    
    # Extract edges above threshold
    print("Extracting edges above threshold...")
    
    # Get upper triangle indices (avoid duplicates)
    for i in tqdm(range(n)):
        for j in range(i + 1, n):
            sim = similarity_matrix[i, j]
            
            if sim >= threshold:
                # Check edge limits
                if edge_counts[i] >= max_edges_per_node and edge_counts[j] >= max_edges_per_node:
                    continue
                
                edges.append(SimilarityEdge(
                    source=image_ids[i],
                    target=image_ids[j],
                    weight=float(sim),
                ))
                
                edge_counts[i] += 1
                edge_counts[j] += 1
    
    return edges


def compute_edges_faiss(
    image_ids: List[str],
    embeddings: np.ndarray,
    threshold: float = 0.7,
    max_edges_per_node: int = 50,
    k_neighbors: int = 100,
) -> List[SimilarityEdge]:
    """
    Compute approximate nearest neighbors using FAISS.
    
    Much faster for large datasets (>5000 images).
    Uses inner product search on normalized vectors (= cosine similarity).
    """
    n, d = embeddings.shape
    
    # Create FAISS index
    # IndexFlatIP = inner product (cosine for normalized vectors)
    if n > 50000:
        # Use IVF index for very large datasets
        nlist = int(np.sqrt(n))  # Number of clusters
        quantizer = faiss.IndexFlatIP(d)
        index = faiss.IndexIVFFlat(quantizer, d, nlist, faiss.METRIC_INNER_PRODUCT)
        index.train(embeddings)
        print(f"Using IVF index with {nlist} clusters")
    else:
        # Flat index for smaller datasets
        index = faiss.IndexFlatIP(d)
    
    index.add(embeddings)
    
    # Search for k nearest neighbors for each image
    print(f"Searching {k_neighbors} nearest neighbors for {n} images...")
    distances, indices = index.search(embeddings, k_neighbors)
    
    # Convert to edges
    seen = set()
    edge_counts = np.zeros(n, dtype=np.int32)
    edges = []
    
    for i in tqdm(range(n), desc="Building edges"):
        for k in range(k_neighbors):
            j = indices[i, k]
            sim = distances[i, k]
            
            if i == j:  # Skip self
                continue
            
            if sim < threshold:
                continue
            
            # Create canonical edge key to avoid duplicates
            edge_key = (min(i, j), max(i, j))
            if edge_key in seen:
                continue
            
            # Check edge limits
            if edge_counts[i] >= max_edges_per_node and edge_counts[j] >= max_edges_per_node:
                continue
            
            seen.add(edge_key)
            edges.append(SimilarityEdge(
                source=image_ids[i],
                target=image_ids[j],
                weight=float(sim),
            ))
            
            edge_counts[i] += 1
            edge_counts[j] += 1
    
    return edges


def compute_statistics(edges: List[SimilarityEdge]) -> Dict:
    """Compute statistics about the edge distribution."""
    if not edges:
        return {"count": 0}
    
    weights = [e.weight for e in edges]
    return {
        "count": len(edges),
        "min_weight": min(weights),
        "max_weight": max(weights),
        "mean_weight": sum(weights) / len(weights),
        "median_weight": sorted(weights)[len(weights) // 2],
    }


def chunk_edges(result: Dict, output_path: Path, chunk_size: int = 10000):
    """Split large edge files into chunks."""
    edges = result["edges"]
    n_chunks = (len(edges) + chunk_size - 1) // chunk_size
    
    for i in range(n_chunks):
        chunk_edges = edges[i * chunk_size:(i + 1) * chunk_size]
        chunk_result = {
            **result,
            "chunk": i + 1,
            "total_chunks": n_chunks,
            "edges": chunk_edges,
            "stats": {**result["stats"], "edges_in_chunk": len(chunk_edges)},
        }
        
        chunk_path = output_path.parent / f"{output_path.stem}_{i+1:03d}.json"
        with open(chunk_path, 'w') as f:
            json.dump(chunk_result, f, indent=2)
        print(f"   Saved chunk: {chunk_path}")
    
    # Save index file
    index_path = output_path.parent / f"{output_path.stem}_index.json"
    with open(index_path, 'w') as f:
        json.dump({
            "version": "1.0",
            "chunks": n_chunks,
            "chunk_pattern": f"{output_path.stem}_{{:03d}}.json",
            "stats": result["stats"],
        }, f, indent=2)
    print(f"   Saved index: {index_path}")


@click.command()
@click.option('--gallery', '-g', type=click.Path(exists=True),
              help='Gallery processed directory (metadata/*.npy)')
@click.option('--embeddings', '-e', type=click.Path(exists=True),
              help='Directory containing .npy embedding files (alternative to --gallery)')
@click.option('--output', '-o', default='./edges.json',
              help='Output JSON file for edges')
@click.option('--threshold', '-t', default=0.7, type=float,
              help='Minimum similarity threshold (0-1, default: 0.7)')
@click.option('--max-edges', '-m', default=50, type=int,
              help='Maximum edges per node (default: 50)')
@click.option('--use-faiss/--no-faiss', default=True,
              help='Use FAISS for approximate search (faster for large datasets)')
@click.option('--k-neighbors', '-k', default=100, type=int,
              help='Number of neighbors to search with FAISS (default: 100)')
@click.option('--compact', is_flag=True,
              help='Output compact JSON (no indentation)')
def main(
    gallery: Optional[str],
    embeddings: Optional[str],
    output: str,
    threshold: float,
    max_edges: int,
    use_faiss: bool,
    k_neighbors: int,
    compact: bool,
):
    """
    Compute similarity edges from CLIP embeddings.
    
    Examples:
    
        # Process your gallery_processed directory
        python compute_similarity.py -g ./gallery_processed -o ./edges.json
        
        # Use stricter threshold for sparser graph
        python compute_similarity.py -g ./gallery_processed -t 0.85 -m 20
        
        # Process embeddings from separate directory
        python compute_similarity.py -e ./embeddings -o ./edges.json
    """
    
    if not gallery and not embeddings:
        raise click.UsageError("Either --gallery or --embeddings is required")
    
    # Discover embeddings
    if gallery:
        gallery_path = Path(gallery)
        embedding_paths = discover_embeddings_gallery(gallery_path)
        print(f"\n📂 Processing gallery: {gallery_path}")
    else:
        embeddings_path = Path(embeddings)
        embedding_paths = discover_embeddings_flat(embeddings_path)
        print(f"\n📂 Processing embeddings: {embeddings_path}")
    
    output_path = Path(output)
    
    print(f"🔬 Settings:")
    print(f"   Threshold:  {threshold}")
    print(f"   Max edges:  {max_edges} per node")
    print(f"   FAISS:      {'enabled' if use_faiss and HAS_FAISS else 'disabled'}")
    
    if not embedding_paths:
        print("\n❌ No embeddings found!")
        return
    
    # Load embeddings
    image_ids, embedding_matrix = load_all_embeddings(embedding_paths)
    n, d = embedding_matrix.shape
    print(f"\n✅ Loaded {n} embeddings ({d}-dimensional)")
    
    # Compute edges
    if use_faiss and HAS_FAISS and n > 1000:
        print("\n🚀 Using FAISS approximate search")
        edges = compute_edges_faiss(
            image_ids, embedding_matrix, threshold, max_edges, k_neighbors
        )
    else:
        if n > 5000 and not (use_faiss and HAS_FAISS):
            print("\n⚠️  Large dataset without FAISS - this may be slow")
        print("\n📐 Using exact search")
        edges = compute_edges_exact(
            image_ids, embedding_matrix, threshold, max_edges
        )
    
    # Sort by weight (strongest first)
    edges.sort(key=lambda e: -e.weight)
    
    # Statistics
    stats = compute_statistics(edges)
    print(f"\n📊 Edge Statistics:")
    print(f"   Total edges: {stats['count']}")
    if stats['count'] > 0:
        print(f"   Weight range: {stats['min_weight']:.3f} - {stats['max_weight']:.3f}")
        print(f"   Mean weight:  {stats['mean_weight']:.3f}")
    
    # Build result
    result = {
        "version": "1.0",
        "threshold": threshold,
        "max_edges_per_node": max_edges,
        "stats": {
            "total_images": n,
            "embedding_dim": d,
            **stats,
        },
        "edges": [
            {
                "source": e.source,
                "target": e.target,
                "weight": round(e.weight, 4),
            }
            for e in edges
        ]
    }
    
    # Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Check file size
    json_str = json.dumps(result) if compact else json.dumps(result, indent=2)
    size_mb = len(json_str) / (1024 * 1024)
    
    if size_mb > 10:
        print(f"\n⚠️  Output is {size_mb:.1f}MB, splitting into chunks...")
        chunk_edges(result, output_path)
    else:
        with open(output_path, 'w') as f:
            f.write(json_str)
        print(f"\n✅ Saved to: {output_path} ({size_mb:.2f}MB)")
    
    print(f"\n💡 To use with the frontend:")
    print(f"   1. Copy {output_path} to your source directory")
    print(f"   2. Run: npx tsx scripts/generate-local-data.ts -s <gallery> --edges {output_path}")


if __name__ == '__main__':
    main()
