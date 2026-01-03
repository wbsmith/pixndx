#!/usr/bin/env python3
"""
Batch CLIP Vectorization

Generates CLIP embeddings for all images that don't already have them.
Saves embeddings as .npy files in the metadata folder.

Supports two directory structures:
1. Nested: gallery/*/medium/*.jpg with gallery/*/metadata/*.npy
2. Flat: gallery/medium/*.jpg with gallery/metadata/*.npy (your current pipeline)

Usage:
    python batch_vectorize.py <processed_gallery_root>
    python batch_vectorize.py ./gallery_processed
    python batch_vectorize.py ./gallery_processed --device cpu
"""

import os
import sys
import argparse
import numpy as np
from PIL import Image
from tqdm import tqdm
import logging

# Suppress transformer warnings
logging.basicConfig(level=logging.ERROR)
try:
    from transformers import logging as hf_logging
    hf_logging.set_verbosity_error()
except ImportError:
    pass

from sentence_transformers import SentenceTransformer
import torch


def detect_device(preferred: str = 'auto') -> str:
    """Detect best available device."""
    if preferred == 'auto':
        if torch.cuda.is_available():
            return 'cuda'
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return 'mps'  # Apple Silicon
        return 'cpu'
    return preferred


def discover_tasks_flat(root_dir: str) -> list:
    """
    Discover images in flat structure:
    root_dir/medium/*.jpg -> root_dir/metadata/*.npy
    """
    tasks = []
    medium_dir = os.path.join(root_dir, 'medium')
    meta_dir = os.path.join(root_dir, 'metadata')
    
    if not os.path.exists(medium_dir):
        return tasks
    
    os.makedirs(meta_dir, exist_ok=True)
    
    for file in os.listdir(medium_dir):
        if file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            img_path = os.path.join(medium_dir, file)
            name_only = os.path.splitext(file)[0]
            npy_path = os.path.join(meta_dir, f"{name_only}.npy")
            
            if not os.path.exists(npy_path):
                tasks.append((img_path, npy_path))
    
    return tasks


def discover_tasks_nested(root_dir: str) -> list:
    """
    Discover images in nested structure:
    root_dir/*/medium/*.jpg -> root_dir/*/metadata/*.npy
    """
    tasks = []
    
    for subdir, dirs, files in os.walk(root_dir):
        if os.path.basename(subdir) == 'medium':
            # The metadata folder is parallel to 'medium'
            meta_dir = os.path.join(os.path.dirname(subdir), 'metadata')
            os.makedirs(meta_dir, exist_ok=True)
            
            for file in files:
                if file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    img_path = os.path.join(subdir, file)
                    name_only = os.path.splitext(file)[0]
                    npy_path = os.path.join(meta_dir, f"{name_only}.npy")
                    
                    if not os.path.exists(npy_path):
                        tasks.append((img_path, npy_path))
    
    return tasks


def batch_process(root_dir: str, device: str = 'auto', batch_size: int = 32):
    """Main processing function."""
    
    device = detect_device(device)
    print(f">>> Device: {device}")
    
    print(f">>> Loading CLIP Model (clip-ViT-B-32)...")
    model = SentenceTransformer('clip-ViT-B-32', device=device)
    
    # Discover work
    print(f">>> Scanning {root_dir} for missing vectors...")
    
    # Try flat structure first, then nested
    tasks = discover_tasks_flat(root_dir)
    structure = "flat"
    
    if not tasks:
        tasks = discover_tasks_nested(root_dir)
        structure = "nested"
    
    if not tasks:
        print(">>> No new images to vectorize.")
        return
    
    print(f">>> Found {len(tasks)} images ({structure} structure). Processing...")
    
    # Process with progress bar
    count = 0
    errors = 0
    
    for img_path, npy_path in tqdm(tasks, desc="Vectorizing"):
        try:
            image = Image.open(img_path).convert('RGB')
            embedding = model.encode(image)
            np.save(npy_path, embedding.astype(np.float32))
            count += 1
        except Exception as e:
            print(f"\n    [Error] Failed {img_path}: {e}")
            errors += 1
    
    print(f">>> Vectorization Complete.")
    print(f"    Saved: {count} embeddings")
    if errors:
        print(f"    Errors: {errors}")


def main():
    parser = argparse.ArgumentParser(
        description='Generate CLIP embeddings for gallery images',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python batch_vectorize.py ./gallery_processed
    python batch_vectorize.py ./gallery_processed --device cuda
    python batch_vectorize.py ./gallery_processed --device cpu
        """
    )
    parser.add_argument('root_dir', help='Root directory of processed gallery')
    parser.add_argument('--device', '-d', default='auto',
                        choices=['auto', 'cuda', 'mps', 'cpu'],
                        help='Device to use (default: auto-detect)')
    parser.add_argument('--batch-size', '-b', type=int, default=32,
                        help='Batch size for processing (default: 32)')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.root_dir):
        print(f"Error: {args.root_dir} not found")
        sys.exit(1)
    
    batch_process(args.root_dir, args.device, args.batch_size)


if __name__ == "__main__":
    main()
