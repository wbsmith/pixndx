#!/usr/bin/env python3
"""
Find Duplicate Images using Perceptual Hashing

Uses multiple hash types (pHash, dHash, average hash) to robustly
identify near-duplicate images.

Usage:
    python find_duplicates.py --input ./processed_gallery/full --output ./duplicates.json
    python find_duplicates.py --input ./photos --threshold 10 --output ./dupes.json
"""

import os
import json
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple

import click
from PIL import Image
import imagehash
from tqdm import tqdm


@dataclass
class ImageHash:
    """Container for multiple hash types of an image."""
    image_id: str
    phash: str       # Perceptual hash
    dhash: str       # Difference hash
    ahash: str       # Average hash
    whash: str       # Wavelet hash
    
    def distance_to(self, other: 'ImageHash') -> Dict[str, int]:
        """Compute Hamming distance for each hash type."""
        return {
            'phash': imagehash.hex_to_hash(self.phash) - imagehash.hex_to_hash(other.phash),
            'dhash': imagehash.hex_to_hash(self.dhash) - imagehash.hex_to_hash(other.dhash),
            'ahash': imagehash.hex_to_hash(self.ahash) - imagehash.hex_to_hash(other.ahash),
            'whash': imagehash.hex_to_hash(self.whash) - imagehash.hex_to_hash(other.whash),
        }
    
    def is_duplicate_of(self, other: 'ImageHash', threshold: int = 8) -> bool:
        """
        Check if two images are duplicates.
        Uses voting across hash types - at least 2 must agree.
        """
        distances = self.distance_to(other)
        votes = sum(1 for d in distances.values() if d <= threshold)
        return votes >= 2


@dataclass
class DuplicateGroup:
    """A group of duplicate images."""
    master_id: str           # Recommended image to keep
    duplicate_ids: List[str] # Other duplicates
    similarity: float        # Average similarity score
    hash_distances: Dict[str, int]  # Distances for debugging


def compute_image_hash(image_path: Path) -> Optional[ImageHash]:
    """Compute all hash types for a single image."""
    try:
        img = Image.open(image_path)
        # Convert to RGB if necessary
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        return ImageHash(
            image_id=image_path.stem,
            phash=str(imagehash.phash(img)),
            dhash=str(imagehash.dhash(img)),
            ahash=str(imagehash.average_hash(img)),
            whash=str(imagehash.whash(img)),
        )
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None


def compute_hashes_parallel(
    image_dir: Path,
    extensions: Tuple[str, ...] = ('.jpg', '.jpeg', '.png', '.webp'),
    max_workers: int = 8
) -> Dict[str, ImageHash]:
    """Compute hashes for all images in parallel."""
    image_files = []
    for ext in extensions:
        image_files.extend(image_dir.glob(f'*{ext}'))
        image_files.extend(image_dir.glob(f'*{ext.upper()}'))
    
    hashes = {}
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(compute_image_hash, path): path 
            for path in image_files
        }
        
        for future in tqdm(as_completed(futures), total=len(futures), desc="Computing hashes"):
            result = future.result()
            if result:
                hashes[result.image_id] = result
    
    return hashes


def find_duplicate_groups(
    hashes: Dict[str, ImageHash],
    threshold: int = 8
) -> List[DuplicateGroup]:
    """
    Find groups of duplicate images.
    
    Uses Union-Find algorithm to group duplicates efficiently.
    """
    image_ids = list(hashes.keys())
    n = len(image_ids)
    
    # Union-Find data structure
    parent = {id: id for id in image_ids}
    rank = {id: 0 for id in image_ids}
    
    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]
    
    def union(x, y):
        px, py = find(x), find(y)
        if px == py:
            return
        if rank[px] < rank[py]:
            px, py = py, px
        parent[py] = px
        if rank[px] == rank[py]:
            rank[px] += 1
    
    # Find all pairs of duplicates
    print(f"Comparing {n * (n-1) // 2} pairs...")
    duplicate_pairs = []
    
    for i in tqdm(range(n), desc="Finding duplicates"):
        hash_i = hashes[image_ids[i]]
        for j in range(i + 1, n):
            hash_j = hashes[image_ids[j]]
            if hash_i.is_duplicate_of(hash_j, threshold):
                union(image_ids[i], image_ids[j])
                duplicate_pairs.append((image_ids[i], image_ids[j]))
    
    # Group by root
    groups_dict = defaultdict(list)
    for id in image_ids:
        root = find(id)
        groups_dict[root].append(id)
    
    # Filter to groups with > 1 member and build result
    result = []
    for root, members in groups_dict.items():
        if len(members) > 1:
            # Choose master based on some heuristic (e.g., alphabetically first)
            members_sorted = sorted(members)
            master = members_sorted[0]
            duplicates = members_sorted[1:]
            
            # Compute average distance within group
            total_dist = 0
            count = 0
            for i, m1 in enumerate(members):
                for m2 in members[i+1:]:
                    distances = hashes[m1].distance_to(hashes[m2])
                    total_dist += sum(distances.values()) / len(distances)
                    count += 1
            
            avg_dist = total_dist / count if count > 0 else 0
            similarity = 1.0 - (avg_dist / 64)  # Normalize to 0-1
            
            result.append(DuplicateGroup(
                master_id=master,
                duplicate_ids=duplicates,
                similarity=round(similarity, 3),
                hash_distances={}  # Could add representative distances
            ))
    
    return result


def choose_best_master(group: DuplicateGroup, metadata_dir: Optional[Path] = None) -> str:
    """
    Choose the best image from a duplicate group to be the master.
    
    Criteria (in order):
    1. Higher resolution
    2. Smaller file size (less compression)
    3. Better metadata (more tags, description)
    4. Alphabetically first (fallback)
    """
    # For now, just return the current master
    # In production, you'd read metadata and compare
    return group.master_id


@click.command()
@click.option('--input', '-i', 'input_dir', required=True, type=click.Path(exists=True),
              help='Directory containing images')
@click.option('--output', '-o', 'output_file', default='./duplicates.json',
              help='Output JSON file')
@click.option('--threshold', '-t', default=8, type=int,
              help='Hamming distance threshold (0=identical, 64=completely different)')
@click.option('--workers', '-w', default=8, type=int,
              help='Number of parallel workers for hashing')
@click.option('--save-hashes', is_flag=True,
              help='Also save computed hashes to a separate file')
def main(input_dir: str, output_file: str, threshold: int, workers: int, save_hashes: bool):
    """Find duplicate images using perceptual hashing."""
    
    input_path = Path(input_dir)
    output_path = Path(output_file)
    
    print(f"\n📸 Finding duplicates in: {input_path}")
    print(f"   Threshold: {threshold} (lower = stricter)")
    
    # Step 1: Compute hashes
    hashes = compute_hashes_parallel(input_path, max_workers=workers)
    print(f"\n✅ Computed hashes for {len(hashes)} images")
    
    if save_hashes:
        hashes_file = output_path.parent / f"{output_path.stem}_hashes.json"
        with open(hashes_file, 'w') as f:
            json.dump({id: asdict(h) for id, h in hashes.items()}, f, indent=2)
        print(f"   Saved hashes to: {hashes_file}")
    
    # Step 2: Find duplicate groups
    groups = find_duplicate_groups(hashes, threshold)
    
    if not groups:
        print("\n🎉 No duplicates found!")
        # Still write empty file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump({"groups": [], "stats": {"total_images": len(hashes), "duplicate_groups": 0}}, f, indent=2)
        return
    
    # Stats
    total_duplicates = sum(len(g.duplicate_ids) for g in groups)
    print(f"\n⚠️  Found {len(groups)} duplicate groups ({total_duplicates} duplicates)")
    
    # Step 3: Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    result = {
        "version": "1.0",
        "threshold": threshold,
        "stats": {
            "total_images": len(hashes),
            "duplicate_groups": len(groups),
            "total_duplicates": total_duplicates,
            "unique_images": len(hashes) - total_duplicates,
        },
        "groups": [
            {
                "master_id": g.master_id,
                "duplicate_ids": g.duplicate_ids,
                "similarity": g.similarity,
                "count": len(g.duplicate_ids) + 1,
            }
            for g in sorted(groups, key=lambda g: -len(g.duplicate_ids))
        ]
    }
    
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    
    print(f"\n✅ Saved to: {output_path}")
    
    # Print summary of largest groups
    print("\n📋 Largest duplicate groups:")
    for g in result["groups"][:10]:
        print(f"   {g['master_id']}: {g['count']} copies (similarity: {g['similarity']:.1%})")


if __name__ == '__main__':
    main()


