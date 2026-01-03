#!/usr/bin/env python3
"""
Compute CLIP Neighbors Per Image

Computes the top-K nearest neighbors for each image based on CLIP embeddings,
storing results directly in each image's metadata JSON file.

This enables:
- Precomputation with loose threshold (store more neighbors)
- Runtime filtering with tighter threshold (show fewer edges)
- Per-image updates when new images are added

Usage:
    python compute_neighbors.py --gallery ./gallery_processed
    python compute_neighbors.py --gallery ./gallery_processed --threshold 0.5 --max-neighbors 100
    python compute_neighbors.py --gallery ./gallery_processed --update-only  # Only process new images
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import argparse

import numpy as np
from tqdm import tqdm

# Optional FAISS for large datasets
try:
    import faiss
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False


@dataclass
class Neighbor:
    id: str
    weight: float


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


def discover_images(gallery_dir: Path) -> List[Tuple[str, Path, Path]]:
    """
    Discover all images with both metadata and embeddings.
    Returns list of (image_id, json_path, npy_path).
    """
    meta_dir = gallery_dir / "metadata"
    
    if not meta_dir.exists():
        print(f"Error: {meta_dir} not found")
        return []
    
    results = []
    for json_path in meta_dir.glob("*.json"):
        image_id = json_path.stem
        npy_path = meta_dir / f"{image_id}.npy"
        
        if npy_path.exists():
            results.append((image_id, json_path, npy_path))
    
    return sorted(results, key=lambda x: x[0])


def compute_neighbors_exact(
    image_ids: List[str],
    embeddings: np.ndarray,
    threshold: float,
    max_neighbors: int,
) -> Dict[str, List[Neighbor]]:
    """
    Compute neighbors using exact cosine similarity.
    Good for datasets up to ~5000 images.
    """
    n = len(image_ids)
    
    # Normalize for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)
    
    # Compute full similarity matrix
    print(f"Computing {n}x{n} similarity matrix...")
    similarity_matrix = normalized @ normalized.T
    
    # Extract neighbors per image
    neighbors = {}
    
    for i in tqdm(range(n), desc="Extracting neighbors"):
        sims = similarity_matrix[i]
        
        # Get indices sorted by similarity (descending), excluding self
        sorted_indices = np.argsort(-sims)
        
        image_neighbors = []
        for j in sorted_indices:
            if j == i:
                continue
            if sims[j] < threshold:
                break  # Since sorted, no more will pass threshold
            if len(image_neighbors) >= max_neighbors:
                break
                
            image_neighbors.append(Neighbor(
                id=image_ids[j],
                weight=round(float(sims[j]), 4)
            ))
        
        neighbors[image_ids[i]] = image_neighbors
    
    return neighbors


def compute_neighbors_faiss(
    image_ids: List[str],
    embeddings: np.ndarray,
    threshold: float,
    max_neighbors: int,
    k_search: int = 200,
) -> Dict[str, List[Neighbor]]:
    """
    Compute neighbors using FAISS approximate nearest neighbor.
    Much faster for large datasets (10K+ images).
    """
    n, d = embeddings.shape
    
    # Normalize for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)
    
    # Create FAISS index
    print(f"Building FAISS index for {n} images...")
    
    if n > 50000:
        # Use IVF for very large datasets
        nlist = int(np.sqrt(n))
        quantizer = faiss.IndexFlatIP(d)
        index = faiss.IndexIVFFlat(quantizer, d, nlist, faiss.METRIC_INNER_PRODUCT)
        index.train(normalized)
    else:
        index = faiss.IndexFlatIP(d)
    
    index.add(normalized)
    
    # Search for k nearest neighbors
    print(f"Searching {k_search} neighbors per image...")
    distances, indices = index.search(normalized, k_search)
    
    # Extract neighbors per image
    neighbors = {}
    
    for i in tqdm(range(n), desc="Extracting neighbors"):
        image_neighbors = []
        
        for k in range(k_search):
            j = indices[i, k]
            sim = distances[i, k]
            
            if j == i:
                continue
            if sim < threshold:
                continue
            if len(image_neighbors) >= max_neighbors:
                break
            
            image_neighbors.append(Neighbor(
                id=image_ids[j],
                weight=round(float(sim), 4)
            ))
        
        neighbors[image_ids[i]] = image_neighbors
    
    return neighbors


def update_metadata_files(
    gallery_dir: Path,
    neighbors: Dict[str, List[Neighbor]],
    threshold: float,
    max_neighbors: int,
):
    """Update each image's JSON file with its neighbors."""
    meta_dir = gallery_dir / "metadata"
    updated = 0
    
    for image_id, image_neighbors in tqdm(neighbors.items(), desc="Updating metadata"):
        json_path = meta_dir / f"{image_id}.json"
        
        if not json_path.exists():
            continue
        
        try:
            with open(json_path, 'r') as f:
                metadata = json.load(f)
            
            # Add neighbors
            metadata['clipNeighbors'] = [
                {'id': n.id, 'weight': n.weight}
                for n in image_neighbors
            ]
            
            # Add computation metadata
            metadata['_neighborsComputed'] = {
                'threshold': threshold,
                'maxNeighbors': max_neighbors,
                'count': len(image_neighbors),
            }
            
            with open(json_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            updated += 1
            
        except Exception as e:
            print(f"Error updating {json_path}: {e}")
    
    return updated


def main():
    parser = argparse.ArgumentParser(
        description='Compute CLIP neighbors per image',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Compute neighbors for all images
    python compute_neighbors.py --gallery ./gallery_processed
    
    # With custom threshold and limit
    python compute_neighbors.py --gallery ./gallery_processed -t 0.5 -m 100
    
    # Only update images without neighbors
    python compute_neighbors.py --gallery ./gallery_processed --update-only
        """
    )
    
    parser.add_argument('--gallery', '-g', required=True,
                        help='Path to gallery_processed directory')
    parser.add_argument('--threshold', '-t', type=float, default=0.5,
                        help='Minimum similarity to store (default: 0.5)')
    parser.add_argument('--max-neighbors', '-m', type=int, default=100,
                        help='Maximum neighbors per image (default: 100)')
    parser.add_argument('--update-only', action='store_true',
                        help='Only process images without existing neighbors')
    parser.add_argument('--use-faiss', action='store_true', default=True,
                        help='Use FAISS for large datasets (default: auto)')
    
    args = parser.parse_args()
    
    gallery_path = Path(args.gallery)
    
    if not gallery_path.exists():
        print(f"Error: {gallery_path} not found")
        return
    
    print(f"\n📊 Computing CLIP Neighbors")
    print(f"   Gallery:        {gallery_path}")
    print(f"   Threshold:      {args.threshold}")
    print(f"   Max neighbors:  {args.max_neighbors}")
    
    # Discover images
    images = discover_images(gallery_path)
    print(f"\n✅ Found {len(images)} images with embeddings")
    
    if not images:
        return
    
    # Filter to only images needing update
    if args.update_only:
        filtered = []
        for image_id, json_path, npy_path in images:
            with open(json_path) as f:
                meta = json.load(f)
            if 'clipNeighbors' not in meta:
                filtered.append((image_id, json_path, npy_path))
        
        print(f"   {len(filtered)} images need neighbor computation")
        if not filtered:
            print("   All images already have neighbors!")
            return
        images = filtered
    
    # Load embeddings
    print("\nLoading embeddings...")
    image_ids = []
    embeddings = []
    
    for image_id, json_path, npy_path in tqdm(images, desc="Loading"):
        emb = load_embedding(npy_path)
        if emb is not None:
            image_ids.append(image_id)
            embeddings.append(emb)
    
    embeddings = np.vstack(embeddings)
    n, d = embeddings.shape
    print(f"✅ Loaded {n} embeddings ({d}-dimensional)")
    
    # Compute neighbors
    use_faiss = args.use_faiss and HAS_FAISS and n > 1000
    
    if use_faiss:
        print("\n🚀 Using FAISS approximate search")
        neighbors = compute_neighbors_faiss(
            image_ids, embeddings, 
            args.threshold, args.max_neighbors
        )
    else:
        if n > 5000 and not HAS_FAISS:
            print("\n⚠️  Large dataset without FAISS - this may be slow")
            print("   Install with: pip install faiss-cpu")
        print("\n📐 Using exact search")
        neighbors = compute_neighbors_exact(
            image_ids, embeddings,
            args.threshold, args.max_neighbors
        )
    
    # Statistics
    neighbor_counts = [len(v) for v in neighbors.values()]
    print(f"\n📊 Neighbor Statistics:")
    print(f"   Total images:    {len(neighbors)}")
    print(f"   Avg neighbors:   {sum(neighbor_counts) / len(neighbor_counts):.1f}")
    print(f"   Min neighbors:   {min(neighbor_counts)}")
    print(f"   Max neighbors:   {max(neighbor_counts)}")
    
    # Update metadata files
    print("\n📝 Updating metadata files...")
    updated = update_metadata_files(
        gallery_path, neighbors,
        args.threshold, args.max_neighbors
    )
    
    print(f"\n✅ Updated {updated} metadata files")
    print(f"\n💡 Next: Run generate-local-data.ts to update frontend data")


if __name__ == '__main__':
    main()

