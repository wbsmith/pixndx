#!/usr/bin/env python3
"""
One-time migration script to populate DynamoDB from localImages.json

Usage:
    python scripts/migrate_to_dynamodb.py

This reads the existing localImages.json and writes each image record
to the DynamoDB Image table with all three URL sizes.
"""

import json
import boto3
import time
import sys
from pathlib import Path

# Configuration
AWS_REGION = 'us-east-1'
TABLE_NAME_PATTERN = 'Image'
LOCAL_IMAGES_PATH = Path(__file__).parent.parent / 'public' / 'localImages.json'

# Initialize DynamoDB
dynamodb = boto3.client('dynamodb', region_name=AWS_REGION)
dynamodb_resource = boto3.resource('dynamodb', region_name=AWS_REGION)


def find_image_table() -> str:
    """Find the DynamoDB Image table name."""
    paginator = dynamodb.get_paginator('list_tables')
    for page in paginator.paginate():
        for table_name in page['TableNames']:
            if '-Image-' in table_name:
                return table_name
    raise RuntimeError(f"Could not find DynamoDB table matching pattern '-Image-'")


def transform_record(img: dict) -> dict:
    """Transform localImages.json record to DynamoDB schema."""
    image_id = img.get('id', '')

    # Get URLs - handle both old format (urls object) and direct paths
    urls = img.get('urls', {})
    if isinstance(urls, dict):
        url_small = urls.get('small', f'images/small/{image_id}.jpg')
        url_medium = urls.get('medium', f'images/medium/{image_id}.jpg')
        url_full = urls.get('full', f'images/full/{image_id}.jpg')
    else:
        url_small = f'images/small/{image_id}.jpg'
        url_medium = f'images/medium/{image_id}.jpg'
        url_full = f'images/full/{image_id}.jpg'

    # Extract dominant color
    colors = img.get('main_colors', {})
    dominant_color = list(colors.values())[0] if colors else '#808080'

    # Build DynamoDB item
    item = {
        'id': image_id,
        'filename': img.get('filename', f'{image_id}.jpg'),
        'urlSmall': url_small,
        'urlMedium': url_medium,
        'urlFull': url_full,
        'description': img.get('description', ''),
        'mood': img.get('mood', 'neutral'),
        'mainSubject': img.get('main_subject', ''),
        'tags': img.get('tags', {}),
        'mainColors': img.get('main_colors', {}),
        'dominantColorHex': dominant_color,
        'exif': img.get('exif', {}),
        'clipNeighbors': img.get('clipNeighbors', []),
        'avgRating': img.get('avgRating', 0),
        'ratingCount': img.get('ratingCount', 0),
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        '__typename': 'Image',
    }

    # Remove None values
    return {k: v for k, v in item.items() if v is not None}


def migrate():
    """Run the migration."""
    # Find table
    print("Finding DynamoDB table...")
    table_name = find_image_table()
    print(f"  Found table: {table_name}")

    table = dynamodb_resource.Table(table_name)

    # Load local images
    print(f"Loading {LOCAL_IMAGES_PATH}...")
    with open(LOCAL_IMAGES_PATH) as f:
        data = json.load(f)

    images = data.get('images', [])
    print(f"  Found {len(images)} images")

    # Batch write to DynamoDB (25 items per batch)
    batch_size = 25
    total = len(images)
    written = 0
    errors = 0

    print(f"Writing to DynamoDB in batches of {batch_size}...")

    for i in range(0, total, batch_size):
        batch = images[i:i + batch_size]

        with table.batch_writer() as writer:
            for img in batch:
                try:
                    item = transform_record(img)
                    writer.put_item(Item=item)
                    written += 1
                except Exception as e:
                    print(f"  Error writing {img.get('id', 'unknown')}: {e}")
                    errors += 1

        # Progress update
        progress = min(i + batch_size, total)
        print(f"  Progress: {progress}/{total} ({100 * progress // total}%)")

        # Small delay to avoid throttling
        time.sleep(0.1)

    print(f"\nMigration complete!")
    print(f"  Written: {written}")
    print(f"  Errors: {errors}")


if __name__ == '__main__':
    migrate()
