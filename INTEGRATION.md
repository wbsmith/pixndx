# Integration Guide: Real Images & AWS Backend

This guide explains how to integrate your actual photos and metadata into the Gallery app.

## Your Metadata Format

The app is now configured to use your exact metadata structure:

```json
{
  "description": "A breathtaking panoramic view captures a vibrant sunset...",
  "tags": {
    "landscape": ["coastal", "sunset", "mountains", "hills"],
    "weather": ["clouds", "sunrays", "atmospheric", "dramatic"],
    "cityscape": ["towns", "infrastructure", "docks", "piers"]
  },
  "mood": "Serene, dramatic, peaceful, awe-inspiring",
  "main_subject": "Sunset over a coastal town",
  "main_colors": {
    "orange": "#FFA500",
    "dark_blue": "#000080"
  },
  "exif": {
    "SourceFile": "/home/tyler/pictures/edits/DSC_4808.jpg",
    "FileName": "DSC_4808.jpg",
    "Make": "NIKON CORPORATION",
    "Model": "NIKON D850",
    ...
  }
}
```

## Step 1: Load Your Metadata

Create a script to load your metadata files and generate the gallery data:

```typescript
// scripts/load-metadata.ts
import fs from 'fs';
import path from 'path';

interface YourMetadata {
  description: string;
  tags: Record<string, string[]>;
  mood: string;
  main_subject: string;
  main_colors: Record<string, string>;
  exif: Record<string, any>;
}

interface GalleryImage {
  id: string;
  filename: string;
  urls: {
    small: string;
    medium: string;
    full: string;
  };
  description: string;
  tags: Record<string, string[]>;
  mood: string;
  main_subject: string;
  main_colors: Record<string, string>;
  exif: Record<string, any>;
  embedding?: {
    clip: number[];
    description: number[];
  };
}

// Configure your paths
const METADATA_DIR = './data/metadata';
const OUTPUT_FILE = './src/data/galleryData.ts';
const IMAGE_BASE_URL = 'https://your-cloudfront-url.cloudfront.net';

async function loadMetadata() {
  const files = fs.readdirSync(METADATA_DIR).filter(f => f.endsWith('.json'));
  const images: GalleryImage[] = [];

  for (const file of files) {
    const raw: YourMetadata = JSON.parse(
      fs.readFileSync(path.join(METADATA_DIR, file), 'utf-8')
    );
    
    // Extract filename from exif or use file basename
    const filename = raw.exif?.FileName || path.basename(file, '.json') + '.jpg';
    const id = path.basename(file, '.json');
    
    const image: GalleryImage = {
      id,
      filename,
      urls: {
        small: `${IMAGE_BASE_URL}/small/${filename}`,
        medium: `${IMAGE_BASE_URL}/medium/${filename}`,
        full: `${IMAGE_BASE_URL}/full/${filename}`,
      },
      description: raw.description,
      tags: raw.tags,
      mood: raw.mood,
      main_subject: raw.main_subject,
      main_colors: raw.main_colors,
      exif: raw.exif,
    };

    images.push(image);
  }

  // Generate TypeScript file
  const output = `// Auto-generated from metadata - ${new Date().toISOString()}
import type { ImageMetadata } from '@/types/gallery';

export const galleryImages: ImageMetadata[] = ${JSON.stringify(images, null, 2)};

export const getAllTags = (): string[] => {
  const tags = new Set<string>();
  galleryImages.forEach((img) => {
    Object.values(img.tags).forEach((tagArray) => {
      tagArray.forEach((t) => tags.add(t));
    });
  });
  return Array.from(tags).sort();
};

export const getTagCategories = (): string[] => {
  const categories = new Set<string>();
  galleryImages.forEach((img) => {
    Object.keys(img.tags).forEach((cat) => categories.add(cat));
  });
  return Array.from(categories).sort();
};

export const getAllMoods = (): string[] => {
  const moods = new Set<string>();
  galleryImages.forEach((img) => {
    img.mood.split(/[,\\s]+/).forEach((m) => {
      const trimmed = m.trim().toLowerCase();
      if (trimmed) moods.add(trimmed);
    });
  });
  return Array.from(moods).sort();
};
`;

  fs.writeFileSync(OUTPUT_FILE, output);
  console.log(\`Loaded \${images.length} images\`);
}

loadMetadata();
```

Then update your store to import from the generated file:

```typescript
// In src/stores/galleryStore.ts, change:
import { mockImages } from '@/data/mockData';
// To:
import { galleryImages as mockImages } from '@/data/galleryData';
```

## Step 2: Generate Embeddings (Optional but Recommended)

For better semantic search, generate CLIP embeddings:

```python
# scripts/generate_embeddings.py
import torch
import clip
from PIL import Image
import json
import os
from pathlib import Path

device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

def generate_embedding(image_path: str) -> list:
    image = preprocess(Image.open(image_path)).unsqueeze(0).to(device)
    with torch.no_grad():
        embedding = model.encode_image(image)
    return embedding.cpu().numpy().flatten().tolist()

def generate_text_embedding(text: str) -> list:
    tokens = clip.tokenize([text], truncate=True).to(device)
    with torch.no_grad():
        embedding = model.encode_text(tokens)
    return embedding.cpu().numpy().flatten().tolist()

# Process all images
image_dir = Path("./data/images/medium")
metadata_dir = Path("./data/metadata")

for metadata_path in metadata_dir.glob("*.json"):
    with open(metadata_path) as f:
        metadata = json.load(f)
    
    # Get image path from exif or construct it
    filename = metadata.get('exif', {}).get('FileName', metadata_path.stem + '.jpg')
    img_path = image_dir / filename
    
    if img_path.exists():
        # Generate embeddings
        clip_embedding = generate_embedding(str(img_path))
        desc_embedding = generate_text_embedding(metadata.get('description', ''))
        
        metadata['embedding'] = {
            'clip': clip_embedding,
            'description': desc_embedding
        }
        
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"Processed: {filename}")
    else:
        print(f"Image not found: {img_path}")
```

## Step 3: AWS Infrastructure Setup

### S3 Bucket Configuration

```bash
# Create S3 bucket for images
aws s3 mb s3://your-gallery-images --region us-east-1

# Upload images (from your small/medium/full directories)
aws s3 sync ./data/images/small s3://your-gallery-images/small --acl public-read
aws s3 sync ./data/images/medium s3://your-gallery-images/medium --acl public-read
aws s3 sync ./data/images/full s3://your-gallery-images/full --acl public-read
```

### CloudFront Distribution

Create a CloudFront distribution pointing to your S3 bucket for fast global delivery.

## Step 4: Environment Configuration

Create `.env` file for local development:

```env
VITE_IMAGE_BASE_URL=https://your-distribution.cloudfront.net
```

Update your load script to use the environment variable:

```typescript
const IMAGE_BASE_URL = process.env.VITE_IMAGE_BASE_URL || '';
```

## Step 5: Deploy to AWS Amplify

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Initialize and deploy
amplify init
amplify add hosting
amplify publish
```

Or connect your Git repo directly in the AWS Amplify Console.

## Directory Structure

Your project should look like:

```
your-project/
├── data/
│   ├── images/
│   │   ├── small/          # ~200px thumbnails
│   │   │   ├── DSC_4808.jpg
│   │   │   └── ...
│   │   ├── medium/         # ~800px previews
│   │   │   ├── DSC_4808.jpg
│   │   │   └── ...
│   │   └── full/           # Original resolution
│   │       ├── DSC_4808.jpg
│   │       └── ...
│   └── metadata/
│       ├── DSC_4808.json   # Your AI-generated metadata
│       └── ...
├── src/
│   └── data/
│       └── galleryData.ts  # Generated from your metadata
└── ...
```

## Testing Locally

1. Install dependencies:
   ```bash
   cd photo-gallery-app
   npm install
   ```

2. Start dev server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3000

The app comes with mock data matching your format, so you can test immediately.
