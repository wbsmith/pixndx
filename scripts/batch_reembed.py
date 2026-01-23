#!/usr/bin/env python3
"""
Batch re-embed all images with clip-ViT-L-14 (768-dim).

This script:
1. Lists all images in S3 (images/medium/)
2. Downloads each image
3. Generates embedding with clip-ViT-L-14
4. Uploads to S3 (embeddings/{id}.json)

Run on GPU instance:
  python3 /mnt/models/scripts/batch_reembed.py
"""

import boto3
import json
import os
import sys
import time
from io import BytesIO
from PIL import Image
from sentence_transformers import SentenceTransformer

# Configuration
STORAGE_BUCKET = os.environ.get('STORAGE_BUCKET', 'amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# AWS clients
s3 = boto3.client('s3', region_name=AWS_REGION)

# Load CLIP model
print("Loading CLIP model (clip-ViT-L-14)...")
clip_model = SentenceTransformer('clip-ViT-L-14')
print(f"Model loaded. Embedding dimension: {clip_model.get_sentence_embedding_dimension()}")


def list_all_images():
    """List all images in the full/ folder."""
    images = []
    paginator = s3.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=STORAGE_BUCKET, Prefix='images/medium/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith(('.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG')):
                # Extract image ID from key (e.g., images/medium/WBS_001.jpg -> WBS_001)
                filename = key.split('/')[-1]
                image_id = os.path.splitext(filename)[0]
                images.append({'key': key, 'id': image_id})

    return images


def process_image(image_info):
    """Download image, generate embedding, upload to S3."""
    image_id = image_info['id']
    key = image_info['key']

    try:
        # Download image
        response = s3.get_object(Bucket=STORAGE_BUCKET, Key=key)
        image_data = response['Body'].read()
        image = Image.open(BytesIO(image_data))

        # Convert to RGB if necessary
        if image.mode in ('RGBA', 'P'):
            image = image.convert('RGB')

        # Generate embedding
        embedding = clip_model.encode(image)
        embedding_list = embedding.tolist()

        # Upload embedding
        embedding_key = f'embeddings/{image_id}.json'
        s3.put_object(
            Bucket=STORAGE_BUCKET,
            Key=embedding_key,
            Body=json.dumps({'id': image_id, 'embedding': embedding_list}),
            ContentType='application/json'
        )

        return True
    except Exception as e:
        print(f"  Error processing {image_id}: {e}")
        return False


def main():
    print(f"Bucket: {STORAGE_BUCKET}")
    print("Listing all images...")

    images = list_all_images()
    total = len(images)
    print(f"Found {total} images to process")

    if total == 0:
        print("No images found!")
        return

    # Process in batches with progress
    successful = 0
    failed = 0
    start_time = time.time()

    for i, image_info in enumerate(images):
        if process_image(image_info):
            successful += 1
        else:
            failed += 1

        # Progress update every 50 images
        if (i + 1) % 50 == 0 or (i + 1) == total:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed
            eta = (total - i - 1) / rate if rate > 0 else 0
            print(f"Progress: {i + 1}/{total} ({successful} ok, {failed} failed) - {rate:.1f} img/s - ETA: {eta/60:.1f} min")

    elapsed = time.time() - start_time
    print(f"\nComplete! Processed {total} images in {elapsed/60:.1f} minutes")
    print(f"  Successful: {successful}")
    print(f"  Failed: {failed}")


if __name__ == '__main__':
    main()
