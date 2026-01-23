#!/usr/bin/env python3
"""
PicGraf GPU Image Processor

Polls SQS queue for image processing jobs, then:
1. Resizes images to small (200px), medium (1024px), full
2. Generates CLIP embeddings
3. Generates metadata with Gemma 3 via Ollama
4. Incrementally updates similarity neighbors (O(N) not O(N²))
5. Uploads results to S3
6. Auto-terminates after 10 min idle

Environment variables:
- STORAGE_BUCKET: S3 bucket for images
- SQS_QUEUE_URL: Queue for processing jobs
- AWS_REGION: AWS region
- MODELS_BUCKET: S3 bucket for model configs (optional)
"""

import boto3
import json
import os
import sys
import time
import requests
from decimal import Decimal
from io import BytesIO
from typing import Dict, List, Any, Tuple, Optional
from dataclasses import dataclass
from PIL import Image
from sentence_transformers import SentenceTransformer
import numpy as np

# Configuration
STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET')
SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma3:27b-it-qat')  # Vision model, 4-bit QAT
IDLE_TIMEOUT_SECONDS = int(os.environ.get('IDLE_TIMEOUT', '600'))  # 10 min default

# EFS cache paths (persists across instance restarts)
EFS_MOUNT = os.environ.get('EFS_MOUNT', '/mnt/models')
EFS_CACHE_DIR = os.path.join(EFS_MOUNT, 'cache')
EFS_EMBEDDINGS_DIR = os.path.join(EFS_CACHE_DIR, 'embeddings')
EFS_METADATA_DIR = os.path.join(EFS_CACHE_DIR, 'metadata')

# AppSync configuration (for real-time subscriptions)
APPSYNC_ENDPOINT = os.environ.get('APPSYNC_ENDPOINT')
APPSYNC_API_KEY = os.environ.get('APPSYNC_API_KEY')

# Neighbor computation settings
SIMILARITY_THRESHOLD = 0.3
MAX_NEIGHBORS = 200
CLIP_WEIGHT = 0.6
META_WEIGHT = 0.4

# AWS clients
sqs = boto3.client('sqs', region_name=AWS_REGION)
s3 = boto3.client('s3', region_name=AWS_REGION)

# Load CLIP model at startup (GPU - g5 instances have 24GB VRAM)
print("Loading CLIP model...")
clip_model = SentenceTransformer('clip-ViT-L-14')  # 768-dim, runs on GPU
print("CLIP model loaded")


# =============================================================================
# IMAGE PROCESSING
# =============================================================================

def resize_image(image: Image.Image, max_dim: int | None) -> Image.Image:
    """Resize image to fit within max_dim while preserving aspect ratio."""
    if max_dim is None:
        return image.copy()
    img = image.copy()
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    return img


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

EXAMPLE OUTPUT:
{
  "description": "A vibrant image captures a brown pelican in mid-flight against a pale blue sky. The pelican's wings are fully extended, showcasing the dark brown and black feathers. The bird's long beak is visible as it soars gracefully. The overall composition emphasizes the pelican's movement and its connection to the open sky.",
  "main_subject": "Brown pelican in flight",
  "mood": "Serene and majestic",
  "tags": {
    "subject": ["bird", "pelican", "wildlife"],
    "environment": ["sky", "outdoors", "daytime"],
    "style": ["wildlife photography", "action shot", "natural lighting"],
    "mood": ["peaceful", "graceful", "free"],
    "colors": ["brown", "blue", "earth tones"]
  },
  "main_colors": {
    "brown": "#8B4513",
    "sky_blue": "#ADD8E6",
    "dark_brown": "#5C4033"
  }
}

Provide 3-5 main colors with accurate hex codes. Use descriptive color names (e.g., "sky_blue" not just "blue").
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
# SIMILARITY COMPUTATION (O(N) incremental)
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


def ensure_cache_dirs():
    """Create EFS cache directories if they don't exist."""
    os.makedirs(EFS_EMBEDDINGS_DIR, exist_ok=True)
    os.makedirs(EFS_METADATA_DIR, exist_ok=True)


def save_to_cache(image_id: str, embedding: np.ndarray, metadata: Dict):
    """Save embedding and metadata to EFS cache."""
    ensure_cache_dirs()
    # Save embedding as numpy binary (faster than JSON)
    np.save(os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy'), embedding)
    # Save metadata as JSON
    with open(os.path.join(EFS_METADATA_DIR, f'{image_id}.json'), 'w') as f:
        json.dump(metadata, f)


def load_from_cache(image_id: str) -> Tuple[Optional[np.ndarray], Optional[Dict]]:
    """Load embedding and metadata from EFS cache."""
    emb_path = os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy')
    meta_path = os.path.join(EFS_METADATA_DIR, f'{image_id}.json')

    embedding = None
    metadata = None

    if os.path.exists(emb_path):
        embedding = np.load(emb_path)
    if os.path.exists(meta_path):
        with open(meta_path, 'r') as f:
            metadata = json.load(f)

    return embedding, metadata


def sync_cache_from_s3():
    """Sync EFS cache with S3, downloading any missing items."""
    ensure_cache_dirs()

    # Get list of cached embeddings
    cached_ids = set()
    if os.path.exists(EFS_EMBEDDINGS_DIR):
        cached_ids = {f.replace('.npy', '') for f in os.listdir(EFS_EMBEDDINGS_DIR) if f.endswith('.npy')}

    # List S3 embeddings and find missing ones
    s3_ids = set()
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix='embeddings/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith('.json'):
                s3_ids.add(key.replace('embeddings/', '').replace('.json', ''))

    missing_ids = s3_ids - cached_ids
    if missing_ids:
        print(f"  Syncing {len(missing_ids)} embeddings from S3 to EFS cache...")
        for i, image_id in enumerate(missing_ids):
            try:
                # Download embedding
                emb_response = s3.get_object(Bucket=STORAGE_BUCKET, Key=f'embeddings/{image_id}.json')
                emb_data = json.loads(emb_response['Body'].read())
                embedding = np.array(emb_data['embedding'], dtype=np.float32)

                # Download metadata
                meta_response = s3.get_object(Bucket=STORAGE_BUCKET, Key=f'metadata/{image_id}.json')
                metadata = json.loads(meta_response['Body'].read())

                # Save to cache
                save_to_cache(image_id, embedding, metadata)

                if (i + 1) % 100 == 0:
                    print(f"    Synced {i + 1}/{len(missing_ids)}")
            except Exception as e:
                print(f"    Warning: Could not sync {image_id}: {e}")

    # Remove stale cache entries (deleted from S3)
    stale_ids = cached_ids - s3_ids
    if stale_ids:
        print(f"  Removing {len(stale_ids)} stale cache entries...")
        for image_id in stale_ids:
            try:
                os.remove(os.path.join(EFS_EMBEDDINGS_DIR, f'{image_id}.npy'))
                os.remove(os.path.join(EFS_METADATA_DIR, f'{image_id}.json'))
            except:
                pass

    return s3_ids


def load_all_embeddings() -> Tuple[List[str], List[np.ndarray], List[Dict]]:
    """Load all embeddings and metadata from EFS cache (syncing from S3 if needed)."""
    image_ids = []
    embeddings = []
    metadata_list = []

    # Sync cache with S3 first
    print("  Loading embeddings from EFS cache...")
    valid_ids = sync_cache_from_s3()

    # Load from cache (much faster than S3)
    for image_id in valid_ids:
        embedding, metadata = load_from_cache(image_id)
        if embedding is not None and metadata is not None:
            image_ids.append(image_id)
            embeddings.append(embedding)
            metadata_list.append(metadata)

    print(f"  Loaded {len(image_ids)} embeddings from cache")
    return image_ids, embeddings, metadata_list


def compute_incremental_neighbors(
    new_id: str,
    new_embedding: np.ndarray,
    new_metadata: Dict,
    existing_ids: List[str],
    existing_embeddings: List[np.ndarray],
    existing_metadata: List[Dict],
) -> Tuple[List[Dict], Dict[str, List[Dict]]]:
    """
    Compute neighbors for a new image and find existing images that need updating.

    Returns:
        - new_neighbors: List of neighbors for the new image
        - updates: Dict mapping existing image IDs to their updated neighbor lists
    """
    if not existing_ids:
        return [], {}

    # Normalize new embedding
    new_emb_norm = new_embedding / (np.linalg.norm(new_embedding) + 1e-8)

    # Stack existing embeddings and normalize
    existing_stack = np.vstack(existing_embeddings)
    norms = np.linalg.norm(existing_stack, axis=1, keepdims=True)
    existing_norm = existing_stack / (norms + 1e-8)

    # Compute CLIP similarities (O(N) dot products)
    clip_sims = existing_norm @ new_emb_norm

    # Compute composite scores for each existing image
    scores = []
    for i, (img_id, clip_sim) in enumerate(zip(existing_ids, clip_sims)):
        meta_sim = compute_metadata_similarity(new_metadata, existing_metadata[i])
        composite = float(clip_sim) * CLIP_WEIGHT + meta_sim * META_WEIGHT
        scores.append({
            'id': img_id,
            'idx': i,
            'clipWeight': round(float(clip_sim), 4),
            'compositeWeight': round(composite, 4),
        })

    # Sort by composite score descending
    scores.sort(key=lambda x: x['compositeWeight'], reverse=True)

    # New image's neighbors (top N above threshold)
    new_neighbors = []
    for s in scores:
        if len(new_neighbors) >= MAX_NEIGHBORS:
            break
        if s['clipWeight'] >= SIMILARITY_THRESHOLD or s['compositeWeight'] >= SIMILARITY_THRESHOLD:
            new_neighbors.append({
                'id': s['id'],
                'clipWeight': s['clipWeight'],
                'compositeWeight': s['compositeWeight'],
            })

    # Check which existing images should have new image as neighbor
    updates = {}
    for s in scores:
        if s['clipWeight'] < SIMILARITY_THRESHOLD and s['compositeWeight'] < SIMILARITY_THRESHOLD:
            continue

        existing_id = s['id']
        existing_meta = existing_metadata[s['idx']]
        current_neighbors = existing_meta.get('clipNeighbors', [])

        # Check if new image qualifies as a neighbor
        new_neighbor_entry = {
            'id': new_id,
            'clipWeight': s['clipWeight'],
            'compositeWeight': s['compositeWeight'],
        }

        # Find insertion point (maintain sorted order by compositeWeight)
        insert_idx = 0
        for i, n in enumerate(current_neighbors):
            if s['compositeWeight'] > n.get('compositeWeight', 0):
                insert_idx = i
                break
            insert_idx = i + 1

        # Only update if new image makes it into top MAX_NEIGHBORS
        if insert_idx < MAX_NEIGHBORS:
            updated_neighbors = current_neighbors[:insert_idx] + [new_neighbor_entry] + current_neighbors[insert_idx:]
            updated_neighbors = updated_neighbors[:MAX_NEIGHBORS]  # Trim to max
            updates[existing_id] = updated_neighbors

    return new_neighbors, updates


def update_existing_metadata(image_id: str, new_neighbors: List[Dict]):
    """Update an existing image's metadata with new neighbors in S3, DynamoDB, and EFS cache."""
    # Update S3 metadata file
    key = f'metadata/{image_id}.json'
    try:
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=key)
        metadata = json.loads(response['Body'].read())
        metadata['clipNeighbors'] = new_neighbors
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        # Update EFS cache
        meta_cache_path = os.path.join(EFS_METADATA_DIR, f'{image_id}.json')
        if os.path.exists(os.path.dirname(meta_cache_path)):
            with open(meta_cache_path, 'w') as f:
                json.dump(metadata, f)
    except Exception as e:
        print(f"  Warning: Could not update S3 metadata for {image_id}: {e}")

    # Update DynamoDB record (convert floats to Decimal)
    try:
        table_name = get_image_table_name()
        table = dynamodb_resource.Table(table_name)
        table.update_item(
            Key={'id': image_id},
            UpdateExpression='SET clipNeighbors = :neighbors, updatedAt = :updated',
            ExpressionAttributeValues={
                ':neighbors': convert_floats_to_decimal(new_neighbors),
                ':updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
        )
        return True
    except Exception as e:
        print(f"  Warning: Could not update DynamoDB for {image_id}: {e}")
        return False


# =============================================================================
# DYNAMODB STORAGE
# =============================================================================

DYNAMODB_TABLE_PATTERN = os.environ.get('DYNAMODB_TABLE_PATTERN', 'Image')
_dynamodb_table_name: Optional[str] = None
dynamodb = boto3.client('dynamodb', region_name=AWS_REGION)
dynamodb_resource = boto3.resource('dynamodb', region_name=AWS_REGION)


def get_image_table_name() -> str:
    """Discover the DynamoDB Image table name (cached)."""
    global _dynamodb_table_name
    if _dynamodb_table_name:
        return _dynamodb_table_name

    # List tables and find one matching the pattern
    paginator = dynamodb.get_paginator('list_tables')
    for page in paginator.paginate():
        for table_name in page['TableNames']:
            # Match tables like "Image-xxxxx-NONE" (Amplify Gen 2 format)
            if table_name.startswith('Image-') and '-NONE' in table_name:
                _dynamodb_table_name = table_name
                print(f"  Found DynamoDB table: {table_name}")
                return table_name

    raise RuntimeError(f"Could not find DynamoDB table matching pattern '{DYNAMODB_TABLE_PATTERN}'")


def update_cdn_manifest(metadata: Dict):
    """Update the CDN manifest with the new image (incremental update)."""
    print("  Updating CDN manifest...")
    manifest_key = 'manifest/images.json'

    try:
        # Try to load existing manifest
        try:
            response = s3.get_object(Bucket=STORAGE_BUCKET, Key=manifest_key)
            manifest = json.loads(response['Body'].read())
            images = manifest.get('images', [])
        except Exception:
            # Manifest doesn't exist yet or error reading, start fresh
            images = []

        # Transform metadata to manifest format (matches frontend ImageMetadata)
        new_entry = {
            'id': metadata['id'],
            'filename': metadata['filename'],
            'urls': metadata['urls'],
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

        # Check if image already exists (update) or is new (append)
        existing_idx = next((i for i, img in enumerate(images) if img['id'] == metadata['id']), None)
        if existing_idx is not None:
            images[existing_idx] = new_entry
        else:
            images.append(new_entry)

        # Write updated manifest
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
            CacheControl='public, max-age=60',  # Short cache for near-real-time updates
        )
        print(f"  Updated CDN manifest: {len(images)} images")

    except Exception as e:
        print(f"  Warning: Could not update CDN manifest: {e}")
        # Don't fail the whole process if manifest update fails


def convert_floats_to_decimal(obj):
    """Recursively convert floats to Decimal for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(i) for i in obj]
    return obj


def create_image_via_appsync(metadata: Dict):
    """Create image via AppSync GraphQL mutation (triggers real-time subscriptions)."""
    print("  Creating image via AppSync...")

    if not APPSYNC_ENDPOINT or not APPSYNC_API_KEY:
        print("  Warning: AppSync not configured, falling back to DynamoDB")
        return write_to_dynamodb_fallback(metadata)

    # Extract first color as dominant
    colors = metadata.get('main_colors', {})
    dominant_color = list(colors.values())[0] if colors else '#808080'

    # GraphQL mutation for creating an image
    mutation = """
    mutation CreateImage($input: CreateImageInput!) {
        createImage(input: $input) {
            id
            filename
        }
    }
    """

    # Build input matching the Amplify schema
    variables = {
        "input": {
            "id": metadata['id'],
            "filename": metadata['filename'],
            "urlSmall": metadata['urls']['small'],
            "urlMedium": metadata['urls']['medium'],
            "urlFull": metadata['urls']['full'],
            "description": metadata.get('description', ''),
            "mood": metadata.get('mood', 'neutral'),
            "mainSubject": metadata.get('main_subject', ''),
            "tags": json.dumps(metadata.get('tags', {})),
            "mainColors": json.dumps(metadata.get('main_colors', {})),
            "dominantColorHex": dominant_color,
            "exif": json.dumps(metadata.get('exif', {})),
            "clipNeighbors": json.dumps(metadata.get('clipNeighbors', [])),
            "avgRating": 0,
            "ratingCount": 0,
        }
    }

    try:
        response = requests.post(
            APPSYNC_ENDPOINT,
            json={"query": mutation, "variables": variables},
            headers={
                "Content-Type": "application/json",
                "x-api-key": APPSYNC_API_KEY,
            },
            timeout=30
        )
        response.raise_for_status()
        result = response.json()

        if 'errors' in result:
            print(f"  AppSync errors: {result['errors']}")
            raise RuntimeError(f"AppSync mutation failed: {result['errors']}")

        print(f"  Created via AppSync: {metadata['id']}")
        return True

    except Exception as e:
        print(f"  Error creating via AppSync: {e}")
        import traceback
        traceback.print_exc()
        raise


def write_to_dynamodb_fallback(metadata: Dict):
    """Fallback: Write image metadata directly to DynamoDB (no subscription trigger)."""
    print("  Writing to DynamoDB (fallback)...")

    try:
        table_name = get_image_table_name()
        table = dynamodb_resource.Table(table_name)

        # Extract first color as dominant
        colors = metadata.get('main_colors', {})
        dominant_color = list(colors.values())[0] if colors else '#808080'

        # Build DynamoDB item (matches Amplify schema)
        item = {
            'id': metadata['id'],
            'filename': metadata['filename'],
            'urlSmall': metadata['urls']['small'],
            'urlMedium': metadata['urls']['medium'],
            'urlFull': metadata['urls']['full'],
            'description': metadata.get('description', ''),
            'mood': metadata.get('mood', 'neutral'),
            'mainSubject': metadata.get('main_subject', ''),
            'tags': metadata.get('tags', {}),
            'mainColors': metadata.get('main_colors', {}),
            'dominantColorHex': dominant_color,
            'exif': metadata.get('exif', {}),
            'clipNeighbors': convert_floats_to_decimal(metadata.get('clipNeighbors', [])),
            'avgRating': Decimal('0'),
            'ratingCount': Decimal('0'),
            'createdAt': metadata.get('createdAt', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
            'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            '__typename': 'Image',
        }

        # Remove None values (DynamoDB doesn't like them)
        item = {k: v for k, v in item.items() if v is not None}

        table.put_item(Item=item)
        print(f"  Saved to DynamoDB: {metadata['id']}")

    except Exception as e:
        print(f"  Error writing to DynamoDB: {e}")
        import traceback
        traceback.print_exc()
        raise


# =============================================================================
# MAIN PROCESSING
# =============================================================================

def process_image(message_body: str) -> bool:
    """Process a single image from the queue."""
    data = json.loads(message_body)
    image_id = data['imageId']  # Now the original filename (without extension)
    source_key = data['sourceKey']
    # Original filename with extension for display
    original_filename = f"{image_id}.jpg"

    print(f"Processing image: {image_id}")
    print(f"  Original filename: {original_filename}")
    print(f"  Source key: {source_key}")
    print(f"  Bucket: {STORAGE_BUCKET}")

    try:
        # Download image from S3
        print(f"  Attempting to download from s3://{STORAGE_BUCKET}/{source_key}")
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=source_key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data))

        # Convert to RGB if necessary
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')

        # Resize and upload different sizes
        sizes = {'small': 200, 'medium': 1024, 'full': None}
        medium_image = None
        for size_name, max_dim in sizes.items():
            resized = resize_image(image, max_dim)
            if size_name == 'medium':
                medium_image = resized  # Save for Ollama
            buf = BytesIO()
            resized.save(buf, format='JPEG', quality=85 if size_name != 'full' else 92)
            buf.seek(0)
            s3.put_object(
                Bucket=STORAGE_BUCKET,
                Key=f'images/{size_name}/{image_id}.jpg',
                Body=buf.getvalue(),
                ContentType='image/jpeg'
            )
            print(f"  Uploaded images/{size_name}/{image_id}.jpg")

        # Save medium image temporarily for Ollama (1024px is sufficient for LLM analysis)
        temp_path = f'/tmp/{image_id}_medium.jpg'
        medium_image.save(temp_path, 'JPEG', quality=90)

        # Generate CLIP embedding (use medium 1024px - CLIP resizes to 224x224 anyway)
        print("  Generating CLIP embedding...")
        embedding = clip_model.encode(medium_image)
        embedding_list = embedding.tolist()

        # Generate metadata with Gemma 3 27B (vision model)
        print("  Generating metadata with Ollama...")
        ai_metadata = generate_metadata_with_ollama(temp_path)

        # Build metadata object (neighbors computed next)
        # Use CDN URLs (CloudFront serves images with signed cookies)
        CDN_BASE = 'https://cdn.picgraf.com'
        metadata = {
            'id': image_id,
            'filename': original_filename,  # Preserve original filename
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
            'exif': {
                'ImageWidth': image.width,
                'ImageHeight': image.height,
            },
            'clipNeighbors': [],  # Filled in below
        }

        # Upload embedding to S3 (needed for neighbor computation)
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=f'embeddings/{image_id}.json',
            Body=json.dumps({'id': image_id, 'embedding': embedding_list}),
            ContentType='application/json'
        )
        print(f"  Uploaded embeddings/{image_id}.json")

        # Compute neighbors incrementally
        print("  Computing similarity neighbors...")
        existing_ids, existing_embeddings, existing_metadata = load_all_embeddings()

        # Exclude the new image from existing (it was just uploaded)
        filtered = [(i, e, m) for i, e, m in zip(existing_ids, existing_embeddings, existing_metadata) if i != image_id]
        if filtered:
            existing_ids, existing_embeddings, existing_metadata = zip(*filtered)
            existing_ids, existing_embeddings, existing_metadata = list(existing_ids), list(existing_embeddings), list(existing_metadata)
        else:
            existing_ids, existing_embeddings, existing_metadata = [], [], []

        new_neighbors, updates = compute_incremental_neighbors(
            image_id, embedding, metadata,
            existing_ids, existing_embeddings, existing_metadata
        )

        print(f"  Found {len(new_neighbors)} neighbors for new image")
        print(f"  Updating {len(updates)} existing images")

        # Update metadata with neighbors
        metadata['clipNeighbors'] = new_neighbors
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=f'metadata/{image_id}.json',
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        print(f"  Uploaded metadata/{image_id}.json")

        # Save to EFS cache (with final metadata including neighbors)
        save_to_cache(image_id, embedding, metadata)
        print(f"  Cached to EFS")

        # Update existing images that now have new image as neighbor
        for existing_id, new_neighbor_list in updates.items():
            if update_existing_metadata(existing_id, new_neighbor_list):
                print(f"  Updated neighbors for {existing_id}")

        # Delete from processing queue
        s3.delete_object(Bucket=STORAGE_BUCKET, Key=source_key)

        # Create via AppSync (triggers real-time subscriptions)
        create_image_via_appsync(metadata)

        # Update CDN manifest for fast initial load
        update_cdn_manifest(metadata)

        # Clean up temp file
        os.remove(temp_path)

        print(f"Completed processing: {image_id}")
        return True

    except Exception as e:
        print(f"Error processing {image_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Main processing loop."""
    if not STORAGE_BUCKET or not SQS_QUEUE_URL:
        print("ERROR: STORAGE_BUCKET and SQS_QUEUE_URL must be set")
        sys.exit(1)

    print(f"Starting processor")
    print(f"  Storage bucket: {STORAGE_BUCKET}")
    print(f"  SQS queue: {SQS_QUEUE_URL}")
    print(f"  Ollama model: {OLLAMA_MODEL}")
    print(f"  Idle timeout: {IDLE_TIMEOUT_SECONDS}s")

    idle_time = 0

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
                    success = process_image(msg['Body'])
                    if success:
                        sqs.delete_message(
                            QueueUrl=SQS_QUEUE_URL,
                            ReceiptHandle=msg['ReceiptHandle']
                        )
            else:
                idle_time += 20
                print(f"No messages, idle for {idle_time}s / {IDLE_TIMEOUT_SECONDS}s")

        except Exception as e:
            print(f"Queue polling error: {e}")
            time.sleep(5)

    print("Idle timeout reached, shutting down...")
    os.system('sudo shutdown -h now')


if __name__ == '__main__':
    main()
