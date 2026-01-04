#!/usr/bin/env python3
"""
Compute CLIP and Composite Neighbors Per Image

Computes the top-K nearest neighbors for each image based on:
1. CLIP embeddings (clipWeight) - cosine similarity in embedding space
2. Composite score (compositeWeight) - blend of CLIP + metadata similarity

This enables fast frontend edge filtering without runtime computation.

Usage:
    python compute_neighbors.py --gallery ./gallery_processed
    python compute_neighbors.py --gallery ./gallery_processed --threshold 0.3 --max-neighbors 200
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any
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
    clipWeight: float
    compositeWeight: float


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


def load_metadata(json_path: Path) -> Optional[Dict[str, Any]]:
    """Load image metadata JSON."""
    try:
        with open(json_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {json_path}: {e}")
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
        # Skip edges files
        if json_path.stem.startswith('edges'):
            continue
            
        image_id = json_path.stem
        npy_path = meta_dir / f"{image_id}.npy"
        
        if npy_path.exists():
            results.append((image_id, json_path, npy_path))
    
    return sorted(results, key=lambda x: x[0])


# =============================================================================
# METADATA SIMILARITY FUNCTIONS
# =============================================================================

def jaccard_similarity(a: List[str], b: List[str]) -> float:
    """Compute Jaccard similarity between two lists of strings."""
    set_a = set(s.lower() for s in a if s)
    set_b = set(s.lower() for s in b if s)
    
    if not set_a and not set_b:
        return 0.0
    
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    
    return intersection / union if union > 0 else 0.0


def hex_to_rgb(hex_str: str) -> Optional[Tuple[int, int, int]]:
    """Convert hex color to RGB tuple."""
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        return None
    try:
        return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def color_similarity(colors1: List[str], colors2: List[str]) -> float:
    """Compute color palette similarity."""
    if not colors1 or not colors2:
        return 0.0
    
    total_min_dist = 0.0
    count = 0
    
    for hex1 in colors1:
        rgb1 = hex_to_rgb(hex1)
        if not rgb1:
            continue
        
        min_dist = 1.0
        for hex2 in colors2:
            rgb2 = hex_to_rgb(hex2)
            if not rgb2:
                continue
            
            # Euclidean distance in RGB space, normalized
            dist = (
                ((rgb1[0] - rgb2[0]) / 255) ** 2 +
                ((rgb1[1] - rgb2[1]) / 255) ** 2 +
                ((rgb1[2] - rgb2[2]) / 255) ** 2
            ) ** 0.5 / (3 ** 0.5)
            
            min_dist = min(min_dist, dist)
        
        total_min_dist += min_dist
        count += 1
    
    return 1.0 - (total_min_dist / count) if count > 0 else 0.0


def compute_metadata_similarity(meta1: Dict, meta2: Dict) -> float:
    """
    Compute metadata similarity between two images.
    Returns weighted average of tag, mood, and color similarity.
    """
    # Tag similarity
    tags1 = []
    tags2 = []
    
    if 'tags' in meta1:
        for v in meta1['tags'].values():
            if isinstance(v, list):
                tags1.extend(v)
            else:
                tags1.append(str(v))
    
    if 'tags' in meta2:
        for v in meta2['tags'].values():
            if isinstance(v, list):
                tags2.extend(v)
            else:
                tags2.append(str(v))
    
    tag_sim = jaccard_similarity(tags1, tags2)
    
    # Mood similarity
    mood1 = meta1.get('mood', '').lower().split()
    mood2 = meta2.get('mood', '').lower().split()
    mood_sim = jaccard_similarity(mood1, mood2)
    
    # Color similarity
    colors1 = list(meta1.get('main_colors', {}).values())
    colors2 = list(meta2.get('main_colors', {}).values())
    color_sim = color_similarity(colors1, colors2)
    
    # Weighted average (matching frontend weights)
    return tag_sim * 0.4 + mood_sim * 0.3 + color_sim * 0.3


# =============================================================================
# NEIGHBOR COMPUTATION
# =============================================================================

def compute_neighbors_with_composite(
    image_ids: List[str],
    embeddings: np.ndarray,
    metadata_list: List[Dict],
    threshold: float,
    max_neighbors: int,
    clip_weight: float = 0.6,
    meta_weight: float = 0.4,
) -> Dict[str, List[Neighbor]]:
    """
    Compute neighbors with both CLIP and composite weights.
    """
    n = len(image_ids)
    
    # Create id -> index mapping
    id_to_idx = {id_: i for i, id_ in enumerate(image_ids)}
    
    # Normalize embeddings for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)
    
    # Compute full similarity matrix
    print(f"Computing {n}x{n} CLIP similarity matrix...")
    clip_sim_matrix = normalized @ normalized.T
    
    # Extract neighbors per image with both weights
    neighbors = {}
    
    for i in tqdm(range(n), desc="Computing neighbors"):
        clip_sims = clip_sim_matrix[i]
        
        # Get indices sorted by CLIP similarity (descending), excluding self
        sorted_indices = np.argsort(-clip_sims)
        
        image_neighbors = []
        for j in sorted_indices:
            if j == i:
                continue
            
            clip_sim = float(clip_sims[j])
            
            # Skip if CLIP similarity is too low (even perfect metadata can't save it)
            if clip_sim < threshold - meta_weight:
                break
            
            if len(image_neighbors) >= max_neighbors:
                break
            
            # Compute metadata similarity
            meta_sim = compute_metadata_similarity(
                metadata_list[i], 
                metadata_list[j]
            )
            
            # Compute composite score
            composite_sim = clip_sim * clip_weight + meta_sim * meta_weight
            
            # Only include if passes threshold (either weight)
            min_weight = min(clip_sim, composite_sim)
            if min_weight < threshold:
                continue
            
            image_neighbors.append(Neighbor(
                id=image_ids[j],
                clipWeight=round(clip_sim, 4),
                compositeWeight=round(composite_sim, 4)
            ))
        
        neighbors[image_ids[i]] = image_neighbors
    
    return neighbors


def compute_neighbors_faiss_with_composite(
    image_ids: List[str],
    embeddings: np.ndarray,
    metadata_list: List[Dict],
    threshold: float,
    max_neighbors: int,
    k_search: int = 300,
    clip_weight: float = 0.6,
    meta_weight: float = 0.4,
) -> Dict[str, List[Neighbor]]:
    """
    Compute neighbors using FAISS with composite weights.
    Much faster for large datasets.
    """
    n, d = embeddings.shape
    
    # Create id -> index mapping
    id_to_idx = {id_: i for i, id_ in enumerate(image_ids)}
    
    # Normalize for cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)
    
    # Create FAISS index
    print(f"Building FAISS index for {n} images...")
    
    if n > 50000:
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
    
    # Extract neighbors with composite weights
    neighbors = {}
    
    for i in tqdm(range(n), desc="Computing composite weights"):
        image_neighbors = []
        
        for k in range(k_search):
            j = int(indices[i, k])
            clip_sim = float(distances[i, k])
            
            if j == i:
                continue
            if clip_sim < threshold - meta_weight:
                continue
            if len(image_neighbors) >= max_neighbors:
                break
            
            # Compute metadata similarity
            meta_sim = compute_metadata_similarity(
                metadata_list[i],
                metadata_list[j]
            )
            
            # Compute composite score
            composite_sim = clip_sim * clip_weight + meta_sim * meta_weight
            
            # Include if passes threshold
            if clip_sim >= threshold or composite_sim >= threshold:
                image_neighbors.append(Neighbor(
                    id=image_ids[j],
                    clipWeight=round(clip_sim, 4),
                    compositeWeight=round(composite_sim, 4)
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
            
            # Add neighbors with both weights
            metadata['clipNeighbors'] = [
                {
                    'id': n.id,
                    'clipWeight': n.clipWeight,
                    'compositeWeight': n.compositeWeight
                }
                for n in image_neighbors
            ]
            
            # Add computation metadata
            metadata['_neighborsComputed'] = {
                'threshold': threshold,
                'maxNeighbors': max_neighbors,
                'count': len(image_neighbors),
                'hasComposite': True,
            }
            
            with open(json_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            updated += 1
            
        except Exception as e:
            print(f"Error updating {json_path}: {e}")
    
    return updated


def main():
    parser = argparse.ArgumentParser(
        description='Compute CLIP + Composite neighbors per image',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Compute neighbors for all images
    python compute_neighbors.py --gallery ./gallery_processed
    
    # With custom threshold and limit
    python compute_neighbors.py --gallery ./gallery_processed -t 0.3 -m 200
        """
    )
    
    parser.add_argument('--gallery', '-g', required=True,
                        help='Path to gallery_processed directory')
    parser.add_argument('--threshold', '-t', type=float, default=0.3,
                        help='Minimum similarity to store (default: 0.3)')
    parser.add_argument('--max-neighbors', '-m', type=int, default=200,
                        help='Maximum neighbors per image (default: 200)')
    parser.add_argument('--clip-weight', type=float, default=0.6,
                        help='Weight for CLIP in composite (default: 0.6)')
    parser.add_argument('--meta-weight', type=float, default=0.4,
                        help='Weight for metadata in composite (default: 0.4)')
    
    args = parser.parse_args()
    
    gallery_path = Path(args.gallery)
    
    if not gallery_path.exists():
        print(f"Error: {gallery_path} not found")
        return
    
    print(f"\n📊 Computing CLIP + Composite Neighbors")
    print(f"   Gallery:        {gallery_path}")
    print(f"   Threshold:      {args.threshold}")
    print(f"   Max neighbors:  {args.max_neighbors}")
    print(f"   CLIP weight:    {args.clip_weight}")
    print(f"   Meta weight:    {args.meta_weight}")
    
    # Discover images
    images = discover_images(gallery_path)
    print(f"\n✅ Found {len(images)} images with embeddings")
    
    if not images:
        return
    
    # Load embeddings and metadata
    print("\nLoading embeddings and metadata...")
    image_ids = []
    embeddings = []
    metadata_list = []
    
    for image_id, json_path, npy_path in tqdm(images, desc="Loading"):
        emb = load_embedding(npy_path)
        meta = load_metadata(json_path)
        
        if emb is not None and meta is not None:
            image_ids.append(image_id)
            embeddings.append(emb)
            metadata_list.append(meta)
    
    embeddings = np.vstack(embeddings)
    n, d = embeddings.shape
    print(f"✅ Loaded {n} embeddings ({d}-dimensional) with metadata")
    
    # Compute neighbors
    use_faiss = HAS_FAISS and n > 1000
    
    if use_faiss:
        print("\n🚀 Using FAISS approximate search")
        neighbors = compute_neighbors_faiss_with_composite(
            image_ids, embeddings, metadata_list,
            args.threshold, args.max_neighbors,
            clip_weight=args.clip_weight,
            meta_weight=args.meta_weight
        )
    else:
        if n > 3000 and not HAS_FAISS:
            print("\n⚠️  Large dataset without FAISS - this may be slow")
            print("   Install with: pip install faiss-cpu")
        print("\n📐 Using exact search")
        neighbors = compute_neighbors_with_composite(
            image_ids, embeddings, metadata_list,
            args.threshold, args.max_neighbors,
            clip_weight=args.clip_weight,
            meta_weight=args.meta_weight
        )
    
    # Statistics
    neighbor_counts = [len(v) for v in neighbors.values()]
    clip_weights = []
    composite_weights = []
    for ns in neighbors.values():
        for n in ns:
            clip_weights.append(n.clipWeight)
            composite_weights.append(n.compositeWeight)
    
    print(f"\n📊 Neighbor Statistics:")
    print(f"   Total images:       {len(neighbors)}")
    print(f"   Avg neighbors:      {sum(neighbor_counts) / len(neighbor_counts):.1f}")
    print(f"   Min neighbors:      {min(neighbor_counts)}")
    print(f"   Max neighbors:      {max(neighbor_counts)}")
    if clip_weights:
        print(f"   CLIP weight range:  {min(clip_weights):.3f} - {max(clip_weights):.3f}")
        print(f"   Comp weight range:  {min(composite_weights):.3f} - {max(composite_weights):.3f}")
    
    # Update metadata files
    print("\n📝 Updating metadata files...")
    updated = update_metadata_files(
        gallery_path, neighbors,
        args.threshold, args.max_neighbors
    )
    
    print(f"\n✅ Updated {updated} metadata files with clipWeight + compositeWeight")
    print(f"\n💡 Next: Run generate-local-data.ts to update frontend data")


if __name__ == '__main__':
    main()
