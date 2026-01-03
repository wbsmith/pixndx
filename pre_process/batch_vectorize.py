import os
import sys
import numpy as np
from PIL import Image
from sentence_transformers import SentenceTransformer
import logging

# --- 1. Suppress Warnings ---
# This kills the "Using a slow image processor" spam
logging.basicConfig(level=logging.ERROR)
from transformers import logging as hf_logging
hf_logging.set_verbosity_error()

def batch_process(root_dir):
    print(f">>> Loading CLIP Model (One-time setup)...")
    # Using 'device' to ensure it hits your RTX 5090
    model = SentenceTransformer('clip-ViT-B-32', device='cuda')
    
    tasks = []
    
    # --- 2. Scan for work ---
    print(f">>> Scanning {root_dir} for missing vectors...")
    for subdir, dirs, files in os.walk(root_dir):
        # We only care about the 'medium' folders we created
        if os.path.basename(subdir) == 'medium':
            # The metadata folder is always parallel to 'medium'
            meta_dir = os.path.join(os.path.dirname(subdir), 'metadata')
            if not os.path.exists(meta_dir):
                continue
                
            for file in files:
                if file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    # Source Image
                    img_path = os.path.join(subdir, file)
                    
                    # Target NPY (Same name, inside metadata folder)
                    name_only = os.path.splitext(file)[0]
                    npy_path = os.path.join(meta_dir, f"{name_only}.npy")
                    
                    if not os.path.exists(npy_path):
                        tasks.append((img_path, npy_path))

    if not tasks:
        print(">>> No new images to vectorize.")
        return

    print(f">>> Found {len(tasks)} images to vectorize. Processing...")

    # --- 3. Process in Batch ---
    # We do this one by one in the loop to manage memory easily, 
    # but since the model is already loaded, it will take ~0.05s per image.
    
    count = 0
    for img_path, npy_path in tasks:
        try:
            image = Image.open(img_path)
            embedding = model.encode(image)
            np.save(npy_path, embedding)
            count += 1
            if count % 10 == 0:
                print(f"    Processed {count}/{len(tasks)}...")
        except Exception as e:
            print(f"    [Error] Failed {img_path}: {e}")

    print(f">>> Vectorization Complete. Saved {count} embeddings.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python batch_vectorize.py <processed_gallery_root>")
        sys.exit(1)
    
    batch_process(sys.argv[1])

