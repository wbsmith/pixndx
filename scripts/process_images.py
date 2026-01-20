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
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'gemma3:27b')
IDLE_TIMEOUT_SECONDS = int(os.environ.get('IDLE_TIMEOUT', '600'))  # 10 min default

# Neighbor computation settings
SIMILARITY_THRESHOLD = 0.3
MAX_NEIGHBORS = 200
CLIP_WEIGHT = 0.6
META_WEIGHT = 0.4

# AWS clients
sqs = boto3.client('sqs', region_name=AWS_REGION)
s3 = boto3.client('s3', region_name=AWS_REGION)

# Load CLIP model (downloads on first use, ~2GB)
print("Loading CLIP model...")
clip_model = SentenceTransformer('clip-ViT-L-14')
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
    """Generate image metadata using Gemma 3 via Ollama."""
    prompt = """Analyze this image and provide a JSON response with:
{
  "description": "A detailed 2-3 sentence description of the image",
  "main_subject": "The primary subject in 2-5 words",
  "mood": "One word describing the mood (e.g., peaceful, dramatic, joyful)",
  "tags": {
    "category1": ["tag1", "tag2"],
    "category2": ["tag3", "tag4"]
  },
  "main_colors": {
    "color_name": "#hexcode"
  }
}

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


def load_all_embeddings() -> Tuple[List[str], List[np.ndarray], List[Dict]]:
    """Load all existing embeddings and metadata from S3."""
    image_ids = []
    embeddings = []
    metadata_list = []

    # List all embedding files
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix='embeddings/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if not key.endswith('.json'):
                continue

            image_id = key.replace('embeddings/', '').replace('.json', '')

            try:
                # Load embedding
                emb_response = s3.get_object(Bucket=STORAGE_BUCKET, Key=key)
                emb_data = json.loads(emb_response['Body'].read())
                embedding = np.array(emb_data['embedding'], dtype=np.float32)

                # Load metadata
                meta_key = f'metadata/{image_id}.json'
                meta_response = s3.get_object(Bucket=STORAGE_BUCKET, Key=meta_key)
                metadata = json.loads(meta_response['Body'].read())

                image_ids.append(image_id)
                embeddings.append(embedding)
                metadata_list.append(metadata)
            except Exception as e:
                print(f"  Warning: Could not load {image_id}: {e}")

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
    """Update an existing image's metadata with new neighbors in S3 and DynamoDB."""
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
    except Exception as e:
        print(f"  Warning: Could not update S3 metadata for {image_id}: {e}")

    # Update DynamoDB record
    try:
        table_name = get_image_table_name()
        table = dynamodb_resource.Table(table_name)
        table.update_item(
            Key={'id': image_id},
            UpdateExpression='SET clipNeighbors = :neighbors, updatedAt = :updated',
            ExpressionAttributeValues={
                ':neighbors': new_neighbors,
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
            if DYNAMODB_TABLE_PATTERN in table_name and 'Image' in table_name:
                # Prefer tables that look like Amplify-generated ones
                if '-Image-' in table_name:
                    _dynamodb_table_name = table_name
                    print(f"  Found DynamoDB table: {table_name}")
                    return table_name

    raise RuntimeError(f"Could not find DynamoDB table matching pattern '{DYNAMODB_TABLE_PATTERN}'")


def write_to_dynamodb(metadata: Dict):
    """Write image metadata to DynamoDB."""
    print("  Writing to DynamoDB...")

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
            'clipNeighbors': metadata.get('clipNeighbors', []),
            'avgRating': 0,
            'ratingCount': 0,
            'createdAt': metadata.get('createdAt', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
            'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            # Amplify requires these for authorization
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
        # Re-raise so the message goes to DLQ if this keeps failing
        raise


# =============================================================================
# MAIN PROCESSING
# =============================================================================

def process_image(message_body: str) -> bool:
    """Process a single image from the queue."""
    data = json.loads(message_body)
    image_id = data['imageId']
    source_key = data['sourceKey']

    print(f"Processing image: {image_id}")

    try:
        # Download image from S3
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=source_key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data))

        # Convert to RGB if necessary
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')

        # Save original temporarily for Ollama
        temp_path = f'/tmp/{image_id}_original.jpg'
        image.save(temp_path, 'JPEG', quality=95)

        # Resize and upload different sizes
        sizes = {'small': 200, 'medium': 1024, 'full': None}
        for size_name, max_dim in sizes.items():
            resized = resize_image(image, max_dim)
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

        # Generate CLIP embedding
        print("  Generating CLIP embedding...")
        embedding = clip_model.encode(image)
        embedding_list = embedding.tolist()

        # Generate metadata with Gemma 3
        print("  Generating metadata with Ollama...")
        ai_metadata = generate_metadata_with_ollama(temp_path)

        # Build metadata object (neighbors computed next)
        metadata = {
            'id': image_id,
            'filename': f'{image_id}.jpg',
            'urls': {
                'small': f'images/small/{image_id}.jpg',
                'medium': f'images/medium/{image_id}.jpg',
                'full': f'images/full/{image_id}.jpg',
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

        # Upload embedding first (needed for neighbor computation)
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

        # Update existing images that now have new image as neighbor
        for existing_id, new_neighbor_list in updates.items():
            if update_existing_metadata(existing_id, new_neighbor_list):
                print(f"  Updated neighbors for {existing_id}")

        # Delete from processing queue
        s3.delete_object(Bucket=STORAGE_BUCKET, Key=source_key)

        # Write to DynamoDB for the gallery
        write_to_dynamodb(metadata)

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
