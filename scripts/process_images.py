#!/usr/bin/env python3
"""
PicGraf GPU Image Processor (v2 - Simplified Architecture)

EFS is the source of truth for all processing data.
S3 holds only: images, manifest, and backups.

Flow:
1. Restore EFS from S3 backup if empty
2. Process images from SQS queue
3. When idle: generate manifest, backup EFS, shutdown

Environment variables:
- STORAGE_BUCKET: S3 bucket for images
- SQS_QUEUE_URL: Queue for processing jobs
- AWS_REGION: AWS region
- EFS_MOUNT: EFS mount point (default: /mnt/models)
"""

import boto3
import json
import os
import subprocess
import sys
import time
import tarfile
import requests
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
from PIL import Image
from PIL.ExifTags import TAGS
from sentence_transformers import SentenceTransformer
import numpy as np

# =============================================================================
# CONFIGURATION
# =============================================================================

STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET')
SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma3:27b-it-qat')
IDLE_TIMEOUT_SECONDS = int(os.environ.get('IDLE_TIMEOUT', '120'))  # 2 min idle before shutdown

# EFS paths (source of truth for all processing data)
# Note: neighbors are stored IN metadata JSON, not in a separate directory
EFS_MOUNT = os.environ.get('EFS_MOUNT', '/mnt/models')
EFS_CACHE_DIR = os.path.join(EFS_MOUNT, 'cache')
EFS_EMBEDDINGS_DIR = os.path.join(EFS_CACHE_DIR, 'embeddings')
EFS_METADATA_DIR = os.path.join(EFS_CACHE_DIR, 'metadata')

# CDN base URL for image URLs in manifest
CDN_BASE = 'https://cdn.picgraf.com'

# Neighbor computation settings
SIMILARITY_THRESHOLD = 0.3
MAX_NEIGHBORS = 200
CLIP_WEIGHT = 0.6
META_WEIGHT = 0.4

# AWS clients
sqs = boto3.client('sqs', region_name=AWS_REGION)
s3 = boto3.client('s3', region_name=AWS_REGION)
events = boto3.client('events', region_name=AWS_REGION)

# Get EC2 instance ID for event metadata
try:
    import urllib.request
    INSTANCE_ID = urllib.request.urlopen(
        'http://169.254.169.254/latest/meta-data/instance-id',
        timeout=2
    ).read().decode('utf-8')
except:
    INSTANCE_ID = 'local'

# Track images processed this session (for manifest update)
processed_this_session: List[str] = []

# =============================================================================
# EVENT EMISSION (EventBridge)
# =============================================================================

# Processing state for coordination
class ProcessingState:
    STARTING = 'INSTANCE_STARTING'
    EFS_MOUNTED = 'EFS_MOUNTED'
    MODELS_LOADED = 'MODELS_LOADED'
    READY = 'INSTANCE_READY'
    PROCESSING = 'PROCESSING_STARTED'
    IMAGE_COMPLETE = 'IMAGE_COMPLETE'
    IDLE = 'INSTANCE_IDLE'
    BACKUP_STARTED = 'BACKUP_STARTED'
    BACKUP_COMPLETE = 'BACKUP_COMPLETE'
    MANIFEST_UPDATED = 'MANIFEST_UPDATED'
    SHUTTING_DOWN = 'INSTANCE_SHUTTING_DOWN'
    ERROR = 'ERROR'

current_state = ProcessingState.STARTING


def emit_event(event_type: str, data: Dict = None):
    """Emit an event to EventBridge for monitoring and coordination."""
    global current_state
    current_state = event_type

    detail = {
        'instanceId': INSTANCE_ID,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'state': event_type,
        **(data or {})
    }

    try:
        events.put_events(Entries=[{
            'Source': 'picgraf.gpu-processor',
            'DetailType': event_type,
            'Detail': json.dumps(detail),
            'EventBusName': 'default'
        }])
        print(f"[EVENT] {event_type}: {json.dumps(data) if data else ''}")
    except Exception as e:
        print(f"[EVENT] Failed to emit {event_type}: {e}")

# =============================================================================
# EFS DIRECTORY SETUP
# =============================================================================

def ensure_efs_dirs():
    """Create EFS data directories if they don't exist."""
    for dir_path in [EFS_EMBEDDINGS_DIR, EFS_METADATA_DIR]:
        os.makedirs(dir_path, exist_ok=True)


def is_efs_empty() -> bool:
    """Check if EFS data directory is empty (needs restore from S3)."""
    if not os.path.exists(EFS_EMBEDDINGS_DIR):
        return True
    return len(os.listdir(EFS_EMBEDDINGS_DIR)) == 0


# =============================================================================
# EFS BACKUP / RESTORE
# =============================================================================

def restore_efs_from_s3():
    """Restore EFS data from S3 backup if EFS is empty."""
    if not is_efs_empty():
        print("EFS has data, skipping restore")
        return

    print("EFS is empty, restoring from S3 backup...")
    ensure_efs_dirs()

    backups = [
        ('backups/embeddings.tar.gz', EFS_CACHE_DIR),
        ('backups/metadata.tar.gz', EFS_CACHE_DIR),
    ]

    for s3_key, extract_to in backups:
        try:
            print(f"  Downloading {s3_key}...")
            local_path = f'/tmp/{os.path.basename(s3_key)}'
            s3.download_file(STORAGE_BUCKET, s3_key, local_path)

            print(f"  Extracting to {extract_to}...")
            with tarfile.open(local_path, 'r:gz') as tar:
                tar.extractall(extract_to)

            os.remove(local_path)
            print(f"  Restored {s3_key}")
        except s3.exceptions.NoSuchKey:
            print(f"  No backup found: {s3_key} (starting fresh)")
        except Exception as e:
            print(f"  Warning: Could not restore {s3_key}: {e}")

    # Count restored files
    emb_count = len(list(Path(EFS_EMBEDDINGS_DIR).glob('*.npy'))) if os.path.exists(EFS_EMBEDDINGS_DIR) else 0
    meta_count = len(list(Path(EFS_METADATA_DIR).glob('*.json'))) if os.path.exists(EFS_METADATA_DIR) else 0
    print(f"Restored {emb_count} embeddings, {meta_count} metadata files")


def backup_efs_to_s3():
    """Backup EFS data to S3 before shutdown."""
    print("Backing up EFS to S3...")

    backups = [
        (EFS_EMBEDDINGS_DIR, 'embeddings', 'backups/embeddings.tar.gz'),
        (EFS_METADATA_DIR, 'metadata', 'backups/metadata.tar.gz'),
    ]

    for source_dir, archive_name, s3_key in backups:
        if not os.path.exists(source_dir) or not os.listdir(source_dir):
            print(f"  Skipping {archive_name} (empty)")
            continue

        try:
            local_path = f'/tmp/{archive_name}.tar.gz'

            print(f"  Compressing {archive_name}...")
            with tarfile.open(local_path, 'w:gz') as tar:
                tar.add(source_dir, arcname=archive_name)

            file_size = os.path.getsize(local_path) / (1024 * 1024)
            print(f"  Uploading {s3_key} ({file_size:.1f} MB)...")
            s3.upload_file(local_path, STORAGE_BUCKET, s3_key)

            # Verify upload
            s3.head_object(Bucket=STORAGE_BUCKET, Key=s3_key)
            print(f"  Verified {s3_key}")

            os.remove(local_path)
        except Exception as e:
            print(f"  ERROR backing up {archive_name}: {e}")
            raise  # Don't shutdown if backup fails

    print("EFS backup complete")


# =============================================================================
# EFS DATA ACCESS
# =============================================================================

def save_embedding(image_id: str, embedding: np.ndarray):
    """Save embedding to EFS."""
    ensure_efs_dirs()
    np.save(os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy'), embedding)


def load_embedding(image_id: str) -> Optional[np.ndarray]:
    """Load embedding from EFS."""
    path = os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy')
    if os.path.exists(path):
        return np.load(path)
    return None


def save_metadata(image_id: str, metadata: Dict):
    """Save metadata to EFS."""
    ensure_efs_dirs()
    with open(os.path.join(EFS_METADATA_DIR, f'{image_id}.json'), 'w') as f:
        json.dump(metadata, f, indent=2)


def load_metadata(image_id: str) -> Optional[Dict]:
    """Load metadata from EFS."""
    path = os.path.join(EFS_METADATA_DIR, f'{image_id}.json')
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return None


def save_neighbors(image_id: str, clip_neighbors: List[Dict], composite_neighbors: List[Dict]):
    """Save neighbors to metadata JSON (neighbors are embedded in metadata, not separate)."""
    metadata = load_metadata(image_id)
    if metadata is None:
        print(f"  Warning: No metadata for {image_id}, cannot save neighbors")
        return
    metadata['clipNeighbors'] = clip_neighbors
    metadata['compositeNeighbors'] = composite_neighbors
    save_metadata(image_id, metadata)


def load_neighbors(image_id: str) -> Tuple[List[Dict], List[Dict]]:
    """Load neighbors from metadata JSON. Returns (clipNeighbors, compositeNeighbors)."""
    metadata = load_metadata(image_id)
    if metadata:
        return metadata.get('clipNeighbors', []), metadata.get('compositeNeighbors', [])
    return [], []


def list_all_image_ids() -> List[str]:
    """List all image IDs in EFS (based on embeddings)."""
    if not os.path.exists(EFS_EMBEDDINGS_DIR):
        return []
    return [f.replace('.npy', '') for f in os.listdir(EFS_EMBEDDINGS_DIR) if f.endswith('.npy')]


def load_all_embeddings() -> Dict[str, np.ndarray]:
    """Load all embeddings from EFS into memory."""
    embeddings = {}
    for image_id in list_all_image_ids():
        emb = load_embedding(image_id)
        if emb is not None:
            embeddings[image_id] = emb
    return embeddings


# =============================================================================
# EFS/S3 SYNC
# =============================================================================

def sync_efs_with_s3():
    """Remove EFS data for images that no longer exist in S3.

    S3 images/small/ is the source of truth for what images exist.
    Cleans up orphaned metadata/embeddings/neighbors from EFS.
    """
    print("Syncing EFS with S3...")

    # Get image IDs from S3 (images/small/)
    s3_image_ids = set()
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix='images/small/'):
        for obj in page.get('Contents', []):
            # Extract ID from key like 'images/small/WBS_1234.jpg'
            filename = obj['Key'].split('/')[-1]
            image_id = os.path.splitext(filename)[0]
            s3_image_ids.add(image_id)

    print(f"  S3 has {len(s3_image_ids)} images")

    # Get image IDs from EFS
    efs_image_ids = set(list_all_image_ids())
    print(f"  EFS has {len(efs_image_ids)} embeddings")

    # Find orphaned (in EFS but not in S3)
    orphaned = efs_image_ids - s3_image_ids

    if not orphaned:
        print("  No orphaned images found")
        return 0

    print(f"  Found {len(orphaned)} orphaned images, cleaning up...")

    for image_id in orphaned:
        # Delete embedding
        emb_path = os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy')
        if os.path.exists(emb_path):
            os.remove(emb_path)

        # Delete metadata (neighbors are embedded in metadata, so this removes both)
        meta_path = os.path.join(EFS_METADATA_DIR, f'{image_id}.json')
        if os.path.exists(meta_path):
            os.remove(meta_path)

        print(f"    Removed: {image_id}")

    print(f"  Cleaned up {len(orphaned)} orphaned images")
    return len(orphaned)


# =============================================================================
# MANIFEST GENERATION
# =============================================================================

def generate_manifest_from_efs():
    """Generate complete manifest from EFS data and upload to S3."""
    # First sync EFS with S3 to remove orphaned data
    sync_efs_with_s3()

    print("Generating manifest from EFS...")

    images = []
    image_ids = list_all_image_ids()

    for image_id in image_ids:
        metadata = load_metadata(image_id)
        if not metadata:
            print(f"  Warning: No metadata for {image_id}, skipping")
            continue

        clip_neighbors, composite_neighbors = load_neighbors(image_id)

        # Build manifest entry
        images.append({
            'id': image_id,
            'filename': metadata.get('filename', f'{image_id}.jpg'),
            'urls': metadata.get('urls', {
                'small': f'{CDN_BASE}/images/small/{image_id}.jpg',
                'medium': f'{CDN_BASE}/images/medium/{image_id}.jpg',
                'full': f'{CDN_BASE}/images/full/{image_id}.jpg',
            }),
            'description': metadata.get('description', ''),
            'mood': metadata.get('mood', 'neutral'),
            'main_subject': metadata.get('main_subject', ''),
            'tags': metadata.get('tags', {}),
            'main_colors': metadata.get('main_colors', {}),
            'exif': metadata.get('exif', {}),
            'clipNeighbors': clip_neighbors,
            'compositeNeighbors': composite_neighbors,
            'avgRating': metadata.get('avgRating', 0),
            'ratingCount': metadata.get('ratingCount', 0),
        })

    manifest = {
        'version': '3.0',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'count': len(images),
        'images': images,
    }

    # Upload to S3
    s3.put_object(
        Bucket=STORAGE_BUCKET,
        Key='manifest/images.json',
        Body=json.dumps(manifest),
        ContentType='application/json',
        CacheControl='public, max-age=60',
    )

    print(f"Manifest uploaded: {len(images)} images")

    # Notify frontend via AppSync subscription
    notify_manifest_updated(len(images))

    return len(images)


def notify_manifest_updated(image_count: int):
    """Create a ManifestUpdate record to trigger frontend subscription."""
    appsync_endpoint = os.environ.get('APPSYNC_ENDPOINT')
    appsync_api_key = os.environ.get('APPSYNC_API_KEY')

    if not appsync_endpoint or not appsync_api_key:
        print("  AppSync not configured, skipping manifest notification")
        return

    # TTL: 1 day from now (for auto-cleanup)
    ttl = int(time.time()) + 86400

    mutation = """
    mutation CreateManifestUpdate($input: CreateManifestUpdateInput!) {
        createManifestUpdate(input: $input) {
            id
            version
            imageCount
        }
    }
    """

    variables = {
        "input": {
            "version": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "imageCount": image_count,
            "processedCount": len(processed_this_session),
            "instanceId": INSTANCE_ID,
            "ttl": ttl,
        }
    }

    try:
        response = requests.post(
            appsync_endpoint,
            json={"query": mutation, "variables": variables},
            headers={
                "Content-Type": "application/json",
                "x-api-key": appsync_api_key,
            },
            timeout=10
        )

        if response.ok:
            result = response.json()
            if 'errors' in result:
                print(f"  AppSync error: {result['errors']}")
            else:
                print(f"  Manifest update notification sent")
        else:
            print(f"  AppSync request failed: {response.status_code}")
    except Exception as e:
        print(f"  Failed to notify AppSync: {e}")


# =============================================================================
# IMAGE PROCESSING HELPERS
# =============================================================================

def resize_image(image: Image.Image, max_dim: int | None) -> Image.Image:
    """Resize image to fit within max_dim while preserving aspect ratio."""
    if max_dim is None:
        return image.copy()
    img = image.copy()
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    return img


def extract_exif_data(image: Image.Image) -> Dict[str, Any]:
    """Extract EXIF data from image."""
    exif_data = {
        'ImageWidth': image.width,
        'ImageHeight': image.height,
    }

    try:
        raw_exif = image._getexif()
        if not raw_exif:
            return exif_data

        exif_dict = {}
        for tag_id, value in raw_exif.items():
            tag_name = TAGS.get(tag_id, str(tag_id))
            exif_dict[tag_name] = value

        if 'Make' in exif_dict:
            exif_data['Make'] = str(exif_dict['Make']).strip()
        if 'Model' in exif_dict:
            exif_data['Model'] = str(exif_dict['Model']).strip()

        if 'DateTimeOriginal' in exif_dict:
            exif_data['DateTimeOriginal'] = str(exif_dict['DateTimeOriginal'])
        elif 'DateTime' in exif_dict:
            exif_data['DateTimeOriginal'] = str(exif_dict['DateTime'])

        if 'ExposureTime' in exif_dict:
            exp = exif_dict['ExposureTime']
            if hasattr(exp, 'numerator') and hasattr(exp, 'denominator'):
                exif_data['ExposureTime'] = exp.numerator / exp.denominator if exp.denominator else float(exp.numerator)
            else:
                exif_data['ExposureTime'] = float(exp) if exp else None

        if 'FNumber' in exif_dict:
            f = exif_dict['FNumber']
            if hasattr(f, 'numerator') and hasattr(f, 'denominator'):
                exif_data['FNumber'] = f.numerator / f.denominator if f.denominator else float(f.numerator)
            else:
                exif_data['FNumber'] = float(f) if f else None

        if 'FocalLength' in exif_dict:
            fl = exif_dict['FocalLength']
            if hasattr(fl, 'numerator') and hasattr(fl, 'denominator'):
                exif_data['FocalLength'] = fl.numerator / fl.denominator if fl.denominator else float(fl.numerator)
            else:
                exif_data['FocalLength'] = float(fl) if fl else None

        if 'ISOSpeedRatings' in exif_dict:
            iso = exif_dict['ISOSpeedRatings']
            if isinstance(iso, (list, tuple)):
                iso = iso[0]
            exif_data['ISO'] = int(iso)

        if 'LensModel' in exif_dict:
            exif_data['LensModel'] = str(exif_dict['LensModel']).strip()

    except Exception as e:
        print(f"  Warning: Could not extract EXIF: {e}")

    return exif_data


def generate_metadata_with_ollama(image_path: str) -> dict:
    """Generate image metadata using Gemma via Ollama."""
    prompt = """Analyze this photograph and provide a detailed JSON response.

REQUIRED FORMAT:
{
  "description": "A detailed 3-5 sentence description capturing the scene, composition, lighting, and notable details. Be specific and evocative.",
  "main_subject": "The primary subject in 2-5 words",
  "mood": "The emotional tone (e.g., serene and majestic, dramatic and intense, peaceful and contemplative)",
  "tags": {
    "subject": ["primary subject tags"],
    "environment": ["setting, location, time of day"],
    "style": ["composition, lighting, photographic style"],
    "mood": ["emotional qualities"],
    "colors": ["dominant color descriptions"]
  },
  "main_colors": {
    "color_name": "#hexcode",
    "another_color": "#hexcode"
  }
}

Provide 3-5 main colors with accurate hex codes. Use descriptive color names.
Respond ONLY with valid JSON, no other text."""

    try:
        import base64
        with open(image_path, 'rb') as f:
            image_b64 = base64.b64encode(f.read()).decode('utf-8')

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "images": [image_b64],
                "stream": False,
                "format": "json",
            },
            timeout=120
        )
        response.raise_for_status()
        result = response.json()
        return json.loads(result.get('response', '{}'))
    except Exception as e:
        print(f"Ollama error: {e}")
        return {
            "description": "Image processing failed",
            "main_subject": "Unknown",
            "mood": "neutral",
            "tags": {},
            "main_colors": {"gray": "#808080"}
        }


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
    tags1, tags2 = [], []
    for v in meta1.get('tags', {}).values():
        tags1.extend(v if isinstance(v, list) else [str(v)])
    for v in meta2.get('tags', {}).values():
        tags2.extend(v if isinstance(v, list) else [str(v)])
    tag_sim = jaccard_similarity(tags1, tags2)

    mood1 = meta1.get('mood', '').lower().split()
    mood2 = meta2.get('mood', '').lower().split()
    mood_sim = jaccard_similarity(mood1, mood2)

    colors1 = list(meta1.get('main_colors', {}).values())
    colors2 = list(meta2.get('main_colors', {}).values())
    color_sim = color_similarity(colors1, colors2)

    return tag_sim * 0.4 + mood_sim * 0.3 + color_sim * 0.3


def update_neighbors_for_new_image(new_id: str, new_embedding: np.ndarray, new_metadata: Dict):
    """
    Compute neighbors for new image and update existing images' neighbors if needed.

    This is O(N) where N is total images - we compute similarity once per existing image.
    """
    # Load all existing data
    all_embeddings = load_all_embeddings()

    # Remove new image if it somehow exists already
    all_embeddings.pop(new_id, None)

    if not all_embeddings:
        # First image, no neighbors
        save_neighbors(new_id, [], [])
        return

    # Normalize new embedding
    new_emb_norm = new_embedding / (np.linalg.norm(new_embedding) + 1e-8)

    # Compute similarities to all existing images
    scores = []  # List of (id, clip_score, composite_score)

    for existing_id, existing_emb in all_embeddings.items():
        # CLIP similarity (cosine)
        existing_norm = existing_emb / (np.linalg.norm(existing_emb) + 1e-8)
        clip_sim = float(np.dot(new_emb_norm, existing_norm))

        # Metadata similarity
        existing_meta = load_metadata(existing_id) or {}
        meta_sim = compute_metadata_similarity(new_metadata, existing_meta)

        # Composite score
        composite_sim = clip_sim * CLIP_WEIGHT + meta_sim * META_WEIGHT

        scores.append({
            'id': existing_id,
            'clipWeight': round(clip_sim, 4),
            'compositeWeight': round(composite_sim, 4),
        })

    # Sort by composite score for new image's neighbors
    scores_by_composite = sorted(scores, key=lambda x: -x['compositeWeight'])
    scores_by_clip = sorted(scores, key=lambda x: -x['clipWeight'])

    # New image's neighbors (top N above threshold)
    new_clip_neighbors = [
        {'id': s['id'], 'clipWeight': s['clipWeight'], 'compositeWeight': s['compositeWeight']}
        for s in scores_by_clip[:MAX_NEIGHBORS]
        if s['clipWeight'] >= SIMILARITY_THRESHOLD
    ]

    new_composite_neighbors = [
        {'id': s['id'], 'clipWeight': s['clipWeight'], 'compositeWeight': s['compositeWeight']}
        for s in scores_by_composite[:MAX_NEIGHBORS]
        if s['compositeWeight'] >= SIMILARITY_THRESHOLD
    ]

    save_neighbors(new_id, new_clip_neighbors, new_composite_neighbors)
    print(f"  New image has {len(new_clip_neighbors)} CLIP neighbors, {len(new_composite_neighbors)} composite neighbors")

    # Update existing images' neighbors if new image qualifies
    updates_made = 0
    for score in scores:
        if score['clipWeight'] < SIMILARITY_THRESHOLD and score['compositeWeight'] < SIMILARITY_THRESHOLD:
            continue

        existing_id = score['id']
        clip_neighbors, composite_neighbors = load_neighbors(existing_id)

        # Check if new image should be added to CLIP neighbors
        clip_updated = False
        if len(clip_neighbors) < MAX_NEIGHBORS or score['clipWeight'] > clip_neighbors[-1].get('clipWeight', 0):
            new_entry = {'id': new_id, 'clipWeight': score['clipWeight'], 'compositeWeight': score['compositeWeight']}
            clip_neighbors.append(new_entry)
            clip_neighbors.sort(key=lambda x: -x.get('clipWeight', 0))
            clip_neighbors = clip_neighbors[:MAX_NEIGHBORS]
            clip_updated = True

        # Check if new image should be added to composite neighbors
        composite_updated = False
        if len(composite_neighbors) < MAX_NEIGHBORS or score['compositeWeight'] > composite_neighbors[-1].get('compositeWeight', 0):
            new_entry = {'id': new_id, 'clipWeight': score['clipWeight'], 'compositeWeight': score['compositeWeight']}
            composite_neighbors.append(new_entry)
            composite_neighbors.sort(key=lambda x: -x.get('compositeWeight', 0))
            composite_neighbors = composite_neighbors[:MAX_NEIGHBORS]
            composite_updated = True

        if clip_updated or composite_updated:
            save_neighbors(existing_id, clip_neighbors, composite_neighbors)
            updates_made += 1

    print(f"  Updated neighbors for {updates_made} existing images")


# =============================================================================
# MAIN IMAGE PROCESSING
# =============================================================================

# Load CLIP model at startup
print("Loading CLIP model...")
clip_model = SentenceTransformer('clip-ViT-L-14')
print("CLIP model loaded")
emit_event(ProcessingState.MODELS_LOADED, {'model': 'clip-ViT-L-14'})


def process_image(message_body: str) -> bool:
    """Process a single image from the queue."""
    data = json.loads(message_body)
    image_id = data['imageId']
    source_key = data['sourceKey']
    original_filename = f"{image_id}.jpg"

    print(f"\nProcessing: {image_id}")

    try:
        # 1. Download image from S3
        print("  Downloading from S3...")
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=source_key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data))

        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')

        # 2. Resize and upload to S3 (only place images go)
        print("  Resizing and uploading...")
        sizes = {'small': 200, 'medium': 1024, 'full': None}
        medium_image = None

        for size_name, max_dim in sizes.items():
            resized = resize_image(image, max_dim)
            if size_name == 'medium':
                medium_image = resized

            buf = BytesIO()
            resized.save(buf, format='JPEG', quality=85 if size_name != 'full' else 92)
            buf.seek(0)

            s3.put_object(
                Bucket=STORAGE_BUCKET,
                Key=f'images/{size_name}/{image_id}.jpg',
                Body=buf.getvalue(),
                ContentType='image/jpeg'
            )
        print("  Images uploaded to S3")

        # 3. Generate CLIP embedding → EFS
        print("  Generating CLIP embedding...")
        embedding = clip_model.encode(medium_image)
        save_embedding(image_id, embedding)

        # 4. Generate metadata with Gemma → EFS
        print("  Generating metadata with Gemma...")
        temp_path = f'/tmp/{image_id}_medium.jpg'
        medium_image.save(temp_path, 'JPEG', quality=90)
        ai_metadata = generate_metadata_with_ollama(temp_path)
        os.remove(temp_path)

        # 5. Extract EXIF
        print("  Extracting EXIF...")
        exif_data = extract_exif_data(image)

        # 6. Build and save metadata to EFS
        metadata = {
            'id': image_id,
            'filename': original_filename,
            'urls': {
                'small': f'{CDN_BASE}/images/small/{image_id}.jpg',
                'medium': f'{CDN_BASE}/images/medium/{image_id}.jpg',
                'full': f'{CDN_BASE}/images/full/{image_id}.jpg',
            },
            'description': ai_metadata.get('description', ''),
            'main_subject': ai_metadata.get('main_subject', ''),
            'mood': ai_metadata.get('mood', 'neutral'),
            'tags': ai_metadata.get('tags', {}),
            'main_colors': ai_metadata.get('main_colors', {}),
            'exif': exif_data,
            'avgRating': 0,
            'ratingCount': 0,
            'processedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        save_metadata(image_id, metadata)

        # 7. Compute and save neighbors (updates existing images too)
        print("  Computing neighbors...")
        update_neighbors_for_new_image(image_id, embedding, metadata)

        # 8. Delete from processing queue
        s3.delete_object(Bucket=STORAGE_BUCKET, Key=source_key)

        # Track for session
        processed_this_session.append(image_id)

        print(f"  Completed: {image_id}")
        return True

    except Exception as e:
        print(f"  ERROR processing {image_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


# =============================================================================
# MAIN LOOP
# =============================================================================

def main():
    """Main processing loop."""
    if not STORAGE_BUCKET or not SQS_QUEUE_URL:
        print("ERROR: STORAGE_BUCKET and SQS_QUEUE_URL must be set")
        sys.exit(1)

    emit_event(ProcessingState.STARTING, {'bucket': STORAGE_BUCKET})

    print("=" * 60)
    print("PicGraf GPU Processor v2")
    print("=" * 60)
    print(f"Storage bucket: {STORAGE_BUCKET}")
    print(f"SQS queue: {SQS_QUEUE_URL}")
    print(f"EFS mount: {EFS_MOUNT}")
    print(f"Idle timeout: {IDLE_TIMEOUT_SECONDS}s")
    print()

    # Restore EFS from S3 if needed
    restore_efs_from_s3()

    # Ensure directories exist
    ensure_efs_dirs()
    emit_event(ProcessingState.EFS_MOUNTED, {'existingImages': len(list_all_image_ids())})

    print(f"EFS has {len(list_all_image_ids())} existing images")
    print()

    # Note: MODELS_LOADED event is emitted after CLIP loads (see module level)
    emit_event(ProcessingState.READY, {'queueUrl': SQS_QUEUE_URL})

    idle_time = 0
    queue_depth = 0

    while idle_time < IDLE_TIMEOUT_SECONDS:
        try:
            response = sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,
                VisibilityTimeout=900,
            )

            if 'Messages' in response:
                idle_time = 0
                for msg in response['Messages']:
                    # Get approximate queue depth for monitoring
                    try:
                        attrs = sqs.get_queue_attributes(
                            QueueUrl=SQS_QUEUE_URL,
                            AttributeNames=['ApproximateNumberOfMessages']
                        )
                        queue_depth = int(attrs['Attributes'].get('ApproximateNumberOfMessages', 0))
                    except:
                        queue_depth = 0

                    msg_data = json.loads(msg['Body'])
                    emit_event(ProcessingState.PROCESSING, {
                        'imageId': msg_data.get('imageId'),
                        'queueDepth': queue_depth
                    })

                    success = process_image(msg['Body'])
                    if success:
                        sqs.delete_message(
                            QueueUrl=SQS_QUEUE_URL,
                            ReceiptHandle=msg['ReceiptHandle']
                        )
                        emit_event(ProcessingState.IMAGE_COMPLETE, {
                            'imageId': msg_data.get('imageId'),
                            'totalProcessed': len(processed_this_session)
                        })
                    else:
                        emit_event(ProcessingState.ERROR, {
                            'imageId': msg_data.get('imageId'),
                            'stage': 'processing'
                        })
            else:
                idle_time += 20
                emit_event(ProcessingState.IDLE, {
                    'idleSeconds': idle_time,
                    'timeoutSeconds': IDLE_TIMEOUT_SECONDS
                })
                print(f"No messages, idle {idle_time}s / {IDLE_TIMEOUT_SECONDS}s")

        except Exception as e:
            emit_event(ProcessingState.ERROR, {'stage': 'queue', 'message': str(e)})
            print(f"Queue error: {e}")
            time.sleep(5)

    # Session complete - but first check for any last-minute messages
    # This prevents race conditions where uploads arrive during finalization
    print()
    print("=" * 60)
    print("Idle timeout reached, checking for final messages...")
    print("=" * 60)

    # Final check: drain any messages that arrived during idle period
    final_check_count = 0
    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=5,  # Short wait for final check
                VisibilityTimeout=900,
            )

            if 'Messages' not in response:
                break  # Queue is empty, safe to proceed

            final_check_count += 1
            print(f"  Found message during final check #{final_check_count}")

            for msg in response['Messages']:
                msg_data = json.loads(msg['Body'])
                emit_event(ProcessingState.PROCESSING, {
                    'imageId': msg_data.get('imageId'),
                    'finalCheck': True
                })

                success = process_image(msg['Body'])
                if success:
                    sqs.delete_message(
                        QueueUrl=SQS_QUEUE_URL,
                        ReceiptHandle=msg['ReceiptHandle']
                    )
                    emit_event(ProcessingState.IMAGE_COMPLETE, {
                        'imageId': msg_data.get('imageId'),
                        'totalProcessed': len(processed_this_session)
                    })

        except Exception as e:
            print(f"  Final check error: {e}")
            break

    if final_check_count > 0:
        print(f"  Processed {final_check_count} additional images during final check")

    print()
    print("=" * 60)
    print("Finalizing session...")
    print("=" * 60)

    if processed_this_session:
        print(f"Processed {len(processed_this_session)} images this session")

    # Generate manifest from EFS
    emit_event(ProcessingState.MANIFEST_UPDATED, {'processing': True})
    image_count = generate_manifest_from_efs()
    emit_event(ProcessingState.MANIFEST_UPDATED, {'count': image_count, 'processing': False})

    # Backup EFS to S3
    emit_event(ProcessingState.BACKUP_STARTED)
    try:
        backup_efs_to_s3()
        emit_event(ProcessingState.BACKUP_COMPLETE)
    except Exception as e:
        emit_event(ProcessingState.ERROR, {'stage': 'backup', 'message': str(e)})
        raise

    # FINAL safety check: if messages arrived during backup, don't shutdown
    # Instead, loop back to processing (rare but possible)
    try:
        attrs = sqs.get_queue_attributes(
            QueueUrl=SQS_QUEUE_URL,
            AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
        )
        visible = int(attrs['Attributes'].get('ApproximateNumberOfMessages', 0))
        in_flight = int(attrs['Attributes'].get('ApproximateNumberOfMessagesNotVisible', 0))

        if visible > 0:
            print(f"WARNING: {visible} messages in queue after backup!")
            print("Restarting processing loop instead of shutting down...")
            emit_event(ProcessingState.READY, {'reason': 'messages_after_backup', 'count': visible})
            # Recursive call to main() - will process remaining messages
            # This is safe because we've already backed up
            main()
            return
    except Exception as e:
        print(f"  Could not check final queue state: {e}")

    print()
    emit_event(ProcessingState.SHUTTING_DOWN, {'totalProcessed': len(processed_this_session)})

    # Set ASG desired capacity to 0 BEFORE shutdown
    # This ensures new uploads will trigger a new instance start
    asg_name = os.environ.get('ASG_NAME')
    if asg_name:
        try:
            autoscaling = boto3.client('autoscaling', region_name=AWS_REGION)
            autoscaling.set_desired_capacity(
                AutoScalingGroupName=asg_name,
                DesiredCapacity=0,
            )
            print(f"Set ASG {asg_name} desired capacity to 0")
        except Exception as e:
            print(f"Warning: Could not set ASG capacity: {e}")

    print("Shutting down...")
    os.system('sudo shutdown -h now')


if __name__ == '__main__':
    main()
