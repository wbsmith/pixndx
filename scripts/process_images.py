#!/usr/bin/env python3
"""
PicGraf GPU Image Processor

Polls SQS queue for image processing jobs, then:
1. Resizes images to small (200px), medium (1024px), full
2. Generates CLIP embeddings
3. Generates metadata with Gemma 3 via Ollama
4. Recomputes similarity neighbors for all images
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

# AWS clients
sqs = boto3.client('sqs', region_name=AWS_REGION)
s3 = boto3.client('s3', region_name=AWS_REGION)

# Load CLIP model (downloads on first use, ~2GB)
print("Loading CLIP model...")
clip_model = SentenceTransformer('clip-ViT-L-14')
print("CLIP model loaded")


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
        # Read image as base64 for Ollama
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
        metadata = json.loads(result.get('response', '{}'))
        return metadata

    except Exception as e:
        print(f"Ollama error: {e}")
        return {
            "description": "Image processing failed",
            "main_subject": "Unknown",
            "mood": "neutral",
            "tags": {},
            "main_colors": {"gray": "#808080"}
        }


def process_image(message_body: str) -> bool:
    """Process a single image from the queue."""

    data = json.loads(message_body)
    image_id = data['imageId']
    source_key = data['sourceKey']
    original_key = data.get('originalKey', source_key)

    print(f"Processing image: {image_id}")

    try:
        # Download image from S3
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=source_key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data))

        # Convert to RGB if necessary (handles PNG with alpha, etc.)
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')

        # Save original temporarily for Ollama
        temp_path = f'/tmp/{image_id}_original.jpg'
        image.save(temp_path, 'JPEG', quality=95)

        # Resize and upload different sizes
        sizes = {
            'small': 200,
            'medium': 1024,
            'full': None  # Keep original size
        }

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
        embedding = clip_model.encode(image).tolist()

        # Generate metadata with Gemma 3
        print("  Generating metadata with Ollama...")
        ai_metadata = generate_metadata_with_ollama(temp_path)

        # Build full metadata object
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
            'clipNeighbors': [],  # Will be computed in batch later
        }

        # Upload metadata
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=f'metadata/{image_id}.json',
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        print(f"  Uploaded metadata/{image_id}.json")

        # Upload embedding
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=f'embeddings/{image_id}.json',
            Body=json.dumps({'id': image_id, 'embedding': embedding}),
            ContentType='application/json'
        )
        print(f"  Uploaded embeddings/{image_id}.json")

        # Delete from processing queue
        s3.delete_object(Bucket=STORAGE_BUCKET, Key=source_key)
        print(f"  Deleted {source_key}")

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
                WaitTimeSeconds=20,  # Long polling
                VisibilityTimeout=900,  # 15 min to process
            )

            if 'Messages' in response:
                idle_time = 0  # Reset idle counter

                for msg in response['Messages']:
                    success = process_image(msg['Body'])

                    if success:
                        # Delete message from queue
                        sqs.delete_message(
                            QueueUrl=SQS_QUEUE_URL,
                            ReceiptHandle=msg['ReceiptHandle']
                        )
                    # On failure, message will return to queue after visibility timeout
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
