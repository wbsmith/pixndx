import sys
import json
import numpy as np
from PIL import Image
from sentence_transformers import SentenceTransformer

# Load CLIP model (downloaded automatically on first run)
# 'clip-ViT-B-32' is standard, fast, and matches most search backends
model = SentenceTransformer('clip-ViT-B-32')

def generate_embedding(image_path, output_path):
    try:
        img = Image.open(image_path)
        # Generate embedding
        embedding = model.encode(img)
        # Save as standard .npy (numpy binary) for speed/efficiency
        np.save(output_path, embedding)
        print(f"Success: {output_path}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python vectorize.py <input_image> <output_npy>")
        sys.exit(1)
    
    generate_embedding(sys.argv[1], sys.argv[2])

