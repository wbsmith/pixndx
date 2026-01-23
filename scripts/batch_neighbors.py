#!/usr/bin/env python3
"""
Batch compute similarity neighbors for all images.

This script:
1. Loads all embeddings and metadata from S3
2. Computes full N×N similarity matrix (O(N²) but efficient via matrix ops)
3. For each image, extracts top neighbors (both CLIP and Composite)
4. Updates S3 metadata files
5. Updates DynamoDB records
6. Updates the CDN manifest

Run on GPU instance (or any instance with sufficient memory):
  python3 /mnt/models/scripts/batch_neighbors.py

Memory requirement: ~2GB for 3000 images (768-dim embeddings)
"""

import boto3
import json
import os
import sys
import time
from typing import Dict, List, Tuple, Optional
import numpy as np

# Configuration
STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_PATTERN = os.environ.get('DYNAMODB_TABLE_PATTERN', 'Image')

# Neighbor computation settings (match process_images.py)
SIMILARITY_THRESHOLD = 0.3
MAX_NEIGHBORS = 200
CLIP_WEIGHT = 0.6
META_WEIGHT = 0.4

# AWS clients
s3 = boto3.client('s3', region_name=AWS_REGION)
dynamodb = boto3.client('dynamodb', region_name=AWS_REGION)
dynamodb_resource = boto3.resource('dynamodb', region_name=AWS_REGION)

# DynamoDB table name cache
_dynamodb_table_name: Optional[str] = None


def get_image_table_name() -> str:
    """Discover the DynamoDB Image table name (cached)."""
    global _dynamodb_table_name
    if _dynamodb_table_name:
        return _dynamodb_table_name

    paginator = dynamodb.get_paginator('list_tables')
    for page in paginator.paginate():
        for table_name in page['TableNames']:
            if table_name.startswith('Image-') and '-NONE' in table_name:
                _dynamodb_table_name = table_name
                print(f"Found DynamoDB table: {table_name}")
                return table_name

    raise RuntimeError(f"Could not find DynamoDB table matching pattern '{DYNAMODB_TABLE_PATTERN}'")


# =============================================================================
# SIMILARITY COMPUTATION
# =============================================================================

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
            dist = (
                ((rgb1[0] - rgb2[0]) / 255) ** 2 +
                ((rgb1[1] - rgb2[1]) / 255) ** 2 +
                ((rgb1[2] - rgb2[2]) / 255) ** 2
            ) ** 0.5 / (3 ** 0.5)
            min_dist = min(min_dist, dist)
        total_min_dist += min_dist
        count += 1

    return 1.0 - (total_min_dist / count) if count > 0 else 0.0


def jaccard_similarity(a: List[str], b: List[str]) -> float:
    """Compute Jaccard similarity between two lists of strings."""
    set_a = set(s.lower() for s in a if s)
    set_b = set(s.lower() for s in b if s)
    if not set_a and not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def compute_metadata_similarity(meta1: Dict, meta2: Dict) -> float:
    """Compute metadata similarity between two images."""
    # Tag similarity
    tags1, tags2 = [], []
    for v in meta1.get('tags', {}).values():
        tags1.extend(v if isinstance(v, list) else [str(v)])
    for v in meta2.get('tags', {}).values():
        tags2.extend(v if isinstance(v, list) else [str(v)])
    tag_sim = jaccard_similarity(tags1, tags2)

    # Mood similarity
    mood1 = meta1.get('mood', '').lower().split()
    mood2 = meta2.get('mood', '').lower().split()
    mood_sim = jaccard_similarity(mood1, mood2)

    # Color similarity
    colors1 = list(meta1.get('main_colors', {}).values())
    colors2 = list(meta2.get('main_colors', {}).values())
    color_sim = color_similarity(colors1, colors2)

    return tag_sim * 0.4 + mood_sim * 0.3 + color_sim * 0.3


# =============================================================================
# DATA LOADING
# =============================================================================

def load_all_embeddings() -> Tuple[List[str], np.ndarray]:
    """Load all embeddings from S3. Returns (image_ids, embeddings_matrix)."""
    print("Loading embeddings from S3...")
    image_ids = []
    embeddings = []

    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix='embeddings/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if not key.endswith('.json'):
                continue

            image_id = key.replace('embeddings/', '').replace('.json', '')

            try:
                response = s3.get_object(Bucket=STORAGE_BUCKET, Key=key)
                data = json.loads(response['Body'].read())
                embedding = np.array(data['embedding'], dtype=np.float32)

                image_ids.append(image_id)
                embeddings.append(embedding)
            except Exception as e:
                print(f"  Warning: Could not load embedding for {image_id}: {e}")

    print(f"Loaded {len(image_ids)} embeddings")

    if not embeddings:
        return [], np.array([])

    # Stack into matrix (N x D)
    embeddings_matrix = np.vstack(embeddings)
    print(f"Embeddings matrix shape: {embeddings_matrix.shape}")

    return image_ids, embeddings_matrix


def load_all_metadata(image_ids: List[str]) -> List[Dict]:
    """Load all metadata from S3 for given image IDs."""
    print("Loading metadata from S3...")
    metadata_list = []

    for i, image_id in enumerate(image_ids):
        if (i + 1) % 500 == 0:
            print(f"  Loaded metadata for {i + 1}/{len(image_ids)} images")

        try:
            response = s3.get_object(Bucket=STORAGE_BUCKET, Key=f'metadata/{image_id}.json')
            metadata = json.loads(response['Body'].read())
            metadata_list.append(metadata)
        except Exception as e:
            # If metadata doesn't exist, use empty dict (image may have been processed differently)
            print(f"  Warning: No metadata for {image_id}: {e}")
            metadata_list.append({'id': image_id, 'tags': {}, 'mood': '', 'main_colors': {}})

    print(f"Loaded {len(metadata_list)} metadata records")
    return metadata_list


# =============================================================================
# NEIGHBOR COMPUTATION
# =============================================================================

def compute_clip_similarity_matrix(embeddings: np.ndarray) -> np.ndarray:
    """
    Compute full N×N cosine similarity matrix via matrix multiplication.

    This is O(N²) but highly optimized via numpy/BLAS.
    For 2280 images × 768 dims, this is ~4M operations, very fast.
    """
    print("Computing CLIP similarity matrix...")

    # Normalize embeddings (for cosine similarity)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / (norms + 1e-8)

    # Matrix multiplication: (N × D) @ (D × N) = (N × N)
    similarity_matrix = normalized @ normalized.T

    # Set diagonal to 0 (no self-similarity)
    np.fill_diagonal(similarity_matrix, 0)

    print(f"CLIP similarity matrix shape: {similarity_matrix.shape}")
    return similarity_matrix


def compute_metadata_similarity_matrix(metadata_list: List[Dict]) -> np.ndarray:
    """
    Compute N×N metadata similarity matrix.

    This is O(N²) and slower than CLIP (no matrix optimization possible).
    For 2280 images, this is ~2.6M comparisons.
    """
    n = len(metadata_list)
    print(f"Computing metadata similarity matrix ({n}×{n} = {n*n:,} comparisons)...")

    matrix = np.zeros((n, n), dtype=np.float32)

    start_time = time.time()
    comparisons = 0

    for i in range(n):
        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = comparisons / elapsed if elapsed > 0 else 0
            eta = (n * n / 2 - comparisons) / rate / 60 if rate > 0 else 0
            print(f"  Row {i + 1}/{n} ({rate:.0f} cmp/s, ETA: {eta:.1f} min)")

        for j in range(i + 1, n):  # Only compute upper triangle (symmetric)
            sim = compute_metadata_similarity(metadata_list[i], metadata_list[j])
            matrix[i, j] = sim
            matrix[j, i] = sim  # Mirror to lower triangle
            comparisons += 1

    print(f"Metadata similarity computed in {time.time() - start_time:.1f}s")
    return matrix


def extract_neighbors_for_image(
    idx: int,
    clip_row: np.ndarray,
    composite_row: np.ndarray,
    image_ids: List[str]
) -> List[Dict]:
    """Extract top neighbors for a single image from pre-computed similarity rows."""
    # Combine scores into list of (other_idx, clip_sim, composite_sim)
    scores = []
    for j, (clip_sim, comp_sim) in enumerate(zip(clip_row, composite_row)):
        if j == idx:
            continue
        if clip_sim >= SIMILARITY_THRESHOLD or comp_sim >= SIMILARITY_THRESHOLD:
            scores.append({
                'idx': j,
                'clipWeight': round(float(clip_sim), 4),
                'compositeWeight': round(float(comp_sim), 4),
            })

    # Sort by composite score descending
    scores.sort(key=lambda x: x['compositeWeight'], reverse=True)

    # Take top MAX_NEIGHBORS
    neighbors = []
    for s in scores[:MAX_NEIGHBORS]:
        neighbors.append({
            'id': image_ids[s['idx']],
            'clipWeight': s['clipWeight'],
            'compositeWeight': s['compositeWeight'],
        })

    return neighbors


# =============================================================================
# DATA UPDATES
# =============================================================================

def update_s3_metadata(image_id: str, neighbors: List[Dict], metadata: Dict) -> bool:
    """Update S3 metadata file with new neighbors."""
    try:
        metadata['clipNeighbors'] = neighbors
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=f'metadata/{image_id}.json',
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        return True
    except Exception as e:
        print(f"  Error updating S3 metadata for {image_id}: {e}")
        return False


def update_dynamodb(image_id: str, neighbors: List[Dict]) -> bool:
    """Update DynamoDB record with new neighbors."""
    try:
        table_name = get_image_table_name()
        table = dynamodb_resource.Table(table_name)

        # Convert floats to Decimal for DynamoDB
        from decimal import Decimal
        def convert_floats(obj):
            if isinstance(obj, float):
                return Decimal(str(obj))
            elif isinstance(obj, dict):
                return {k: convert_floats(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_floats(i) for i in obj]
            return obj

        table.update_item(
            Key={'id': image_id},
            UpdateExpression='SET clipNeighbors = :neighbors, updatedAt = :updated',
            ExpressionAttributeValues={
                ':neighbors': convert_floats(neighbors),
                ':updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
        )
        return True
    except Exception as e:
        print(f"  Error updating DynamoDB for {image_id}: {e}")
        return False


def update_cdn_manifest(image_ids: List[str], metadata_list: List[Dict]) -> bool:
    """Update the full CDN manifest with all images and their neighbors."""
    print("Updating CDN manifest...")
    manifest_key = 'manifest/images.json'

    try:
        images = []
        for image_id, metadata in zip(image_ids, metadata_list):
            entry = {
                'id': image_id,
                'filename': metadata.get('filename', f'{image_id}.jpg'),
                'urls': metadata.get('urls', {
                    'small': f'https://cdn.picgraf.com/images/small/{image_id}.jpg',
                    'medium': f'https://cdn.picgraf.com/images/medium/{image_id}.jpg',
                    'full': f'https://cdn.picgraf.com/images/full/{image_id}.jpg',
                }),
                'description': metadata.get('description', ''),
                'mood': metadata.get('mood', 'neutral'),
                'main_subject': metadata.get('main_subject', ''),
                'tags': metadata.get('tags', {}),
                'main_colors': metadata.get('main_colors', {}),
                'exif': metadata.get('exif', {}),
                'clipNeighbors': metadata.get('clipNeighbors', []),
                'avgRating': metadata.get('avgRating', 0),
                'ratingCount': metadata.get('ratingCount', 0),
            }
            images.append(entry)

        manifest = {
            'version': '2.0',
            'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'count': len(images),
            'images': images,
        }

        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=manifest_key,
            Body=json.dumps(manifest),
            ContentType='application/json',
            CacheControl='public, max-age=60',
        )
        print(f"Updated CDN manifest with {len(images)} images")
        return True

    except Exception as e:
        print(f"Error updating CDN manifest: {e}")
        return False


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 60)
    print("Batch Neighbor Computation")
    print("=" * 60)
    print(f"Bucket: {STORAGE_BUCKET}")
    print(f"Similarity threshold: {SIMILARITY_THRESHOLD}")
    print(f"Max neighbors: {MAX_NEIGHBORS}")
    print(f"Weights: CLIP={CLIP_WEIGHT}, Meta={META_WEIGHT}")
    print()

    start_time = time.time()

    # 1. Load all embeddings
    image_ids, embeddings = load_all_embeddings()
    if len(image_ids) == 0:
        print("No embeddings found!")
        return

    n = len(image_ids)
    print(f"\nProcessing {n} images...")

    # 2. Load all metadata
    metadata_list = load_all_metadata(image_ids)

    # 3. Compute CLIP similarity matrix (fast, O(N²) but vectorized)
    clip_sim_matrix = compute_clip_similarity_matrix(embeddings)

    # 4. Compute metadata similarity matrix (slower, O(N²) with loops)
    meta_sim_matrix = compute_metadata_similarity_matrix(metadata_list)

    # 5. Compute composite similarity matrix
    print("Computing composite similarity matrix...")
    composite_sim_matrix = clip_sim_matrix * CLIP_WEIGHT + meta_sim_matrix * META_WEIGHT

    # 6. Extract neighbors for each image and update storage
    print(f"\nExtracting neighbors and updating storage for {n} images...")
    s3_success = 0
    dynamo_success = 0

    for i, image_id in enumerate(image_ids):
        if (i + 1) % 100 == 0 or (i + 1) == n:
            elapsed = time.time() - start_time
            print(f"Progress: {i + 1}/{n} ({(i+1)/n*100:.1f}%) - {elapsed/60:.1f} min elapsed")

        # Extract neighbors
        neighbors = extract_neighbors_for_image(
            i,
            clip_sim_matrix[i],
            composite_sim_matrix[i],
            image_ids
        )

        # Update metadata in memory (for manifest)
        metadata_list[i]['clipNeighbors'] = neighbors

        # Update S3 metadata file
        if update_s3_metadata(image_id, neighbors, metadata_list[i]):
            s3_success += 1

        # Update DynamoDB
        if update_dynamodb(image_id, neighbors):
            dynamo_success += 1

    # 7. Update CDN manifest
    update_cdn_manifest(image_ids, metadata_list)

    # Summary
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print("Complete!")
    print("=" * 60)
    print(f"Total images: {n}")
    print(f"S3 metadata updates: {s3_success}/{n}")
    print(f"DynamoDB updates: {dynamo_success}/{n}")
    print(f"Total time: {elapsed/60:.1f} minutes")

    # Stats on neighbors
    neighbor_counts = [len(m.get('clipNeighbors', [])) for m in metadata_list]
    print(f"\nNeighbor statistics:")
    print(f"  Min neighbors: {min(neighbor_counts)}")
    print(f"  Max neighbors: {max(neighbor_counts)}")
    print(f"  Avg neighbors: {sum(neighbor_counts)/len(neighbor_counts):.1f}")


if __name__ == '__main__':
    main()
