# Nebula Gallery - AI-Powered Photo Gallery

A semantic photo gallery with natural language search and creative network graph visualizations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS AMPLIFY                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   React SPA     │    │   API Gateway   │    │      CloudFront         │  │
│  │   + Vite        │◄──►│   + Lambda      │    │   (Image CDN)           │  │
│  └─────────────────┘    └────────┬────────┘    └───────────┬─────────────┘  │
│                                  │                         │                 │
│                                  ▼                         ▼                 │
│                         ┌─────────────────┐       ┌─────────────────┐       │
│                         │   OpenSearch    │       │       S3        │       │
│                         │   Serverless    │       │  (Image Store)  │       │
│                         │  (Vector + KNN) │       │                 │       │
│                         └─────────────────┘       └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
photo-gallery-app/
├── README.md
├── INTEGRATION.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── amplify.yml
├── index.html
├── public/
│   └── favicon.svg
├── amplify/
│   ├── backend.ts                          # Main backend definition
│   ├── auth/
│   │   └── resource.ts                     # Cognito authentication
│   ├── data/
│   │   └── resource.ts                     # GraphQL API schema
│   ├── storage/
│   │   └── resource.ts                     # S3 storage configuration
│   └── functions/
│       ├── searchImages/
│       │   ├── resource.ts                 # Lambda definition
│       │   └── handler.ts                  # Semantic search handler
│       ├── ingestImage/
│       │   ├── resource.ts                 # Lambda definition
│       │   └── handler.ts                  # Image processing handler
│       └── computeSimilarity/
│           ├── resource.ts                 # Lambda definition
│           └── handler.ts                  # Similarity computation handler
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── types/
    │   └── gallery.ts
    ├── hooks/
    │   ├── index.ts                        # Hook exports
    │   ├── useSearch.ts                    # Search state and autocomplete
    │   ├── useGallery.ts                   # Gallery state and navigation
    │   ├── useLayout.ts                    # Layout selection and config
    │   └── useSimilarity.ts                # Similarity computations
    ├── stores/
    │   └── galleryStore.ts
    ├── data/
    │   └── mockData.ts
    ├── lib/
    │   ├── similarity/
    │   │   ├── vectors.ts                  # Vector operations
    │   │   ├── clustering.ts               # K-means, DBSCAN, hierarchical
    │   │   └── layouts.ts                  # Layout algorithms
    │   ├── colors/
    │   │   └── analysis.ts                 # Color space conversions
    │   └── api/
    │       └── client.ts                   # API client
    └── components/
        ├── Gallery/
        │   ├── GalleryView.tsx
        │   ├── ImageCard.tsx
        │   └── ImageModal.tsx
        ├── Search/
        │   ├── SearchBar.tsx
        │   ├── FilterPanel.tsx              # Attribute filters UI
        │   └── SearchSuggestions.tsx        # Search autocomplete
        ├── Layouts/
        │   ├── GridLayout.tsx
        │   ├── NetworkGraph.tsx
        │   ├── ColorWheel.tsx
        │   ├── MoodSpectrum.tsx
        │   ├── ClusterView.tsx
        │   └── TimelineLayout.tsx           # Temporal layout view
        ├── Visualization/
        │   ├── ForceGraph.tsx               # Reusable D3 force component
        │   ├── SimilarityEdges.tsx          # Edge visualization
        │   └── ColorCluster.tsx             # Color clustering visualization
        └── UI/
            ├── LayoutSelector.tsx
            ├── SimilaritySlider.tsx
            └── LoadingStates.tsx            # Loading UI states
```

## Image Metadata Schema

Each image has a corresponding JSON file in `metadata/`:

```json
{
  "id": "img_001",
  "filename": "sunset_beach.jpg",
  "description": {
    "short": "Golden sunset over ocean waves",
    "long": "A breathtaking sunset casts golden and amber hues across gentle ocean waves, with silhouettes of distant sailboats on the horizon. The wet sand reflects the sky's colors creating a mirror effect.",
    "mood": "serene, contemplative, romantic"
  },
  "tags": {
    "primary": ["sunset", "beach", "ocean"],
    "secondary": ["waves", "sailboat", "reflection"],
    "abstract": ["tranquility", "nature", "golden hour"]
  },
  "colors": {
    "dominant": "#E67E22",
    "palette": ["#E67E22", "#2980B9", "#F39C12", "#1A1A2E", "#ECF0F1"],
    "mood_colors": {
      "warm": 0.7,
      "cool": 0.3,
      "saturation": 0.65,
      "brightness": 0.55
    }
  },
  "embedding": {
    "clip": [0.123, -0.456, ...],  // 512-dim CLIP embedding
    "description": [0.789, ...]    // Text embedding of description
  },
  "exif": {
    "camera": "Sony A7III",
    "lens": "24-70mm f/2.8",
    "focal_length": "35mm",
    "aperture": "f/8",
    "shutter_speed": "1/250",
    "iso": 100,
    "date_taken": "2024-03-15T18:45:00Z",
    "location": {
      "lat": 34.0195,
      "lng": -118.4912,
      "place": "Santa Monica Beach, CA"
    }
  },
  "dimensions": {
    "width": 4000,
    "height": 2667,
    "aspect_ratio": 1.5
  }
}
```

## Key Features

### 1. Natural Language Search
- Uses vector embeddings to match queries like "city at sunset" or "birds on water"
- Combines semantic search with attribute filtering
- Real-time suggestions based on existing tags and descriptions

### 2. Visualization Layouts

| Layout | Description | Similarity Basis |
|--------|-------------|------------------|
| **Network Graph** | Force-directed graph with edges based on similarity | Full CLIP embeddings |
| **Color Wheel** | Radial layout grouped by dominant color hue | Color palette analysis |
| **Mood Spectrum** | Linear gradient from calm to energetic | Mood descriptors |
| **Cluster View** | Grouped islands by tag categories | Tag hierarchy |
| **Timeline** | Temporal arrangement with visual connections | Date + visual similarity |

### 3. Similarity Computation

```typescript
// Compute similarity between images using different attributes
type SimilarityMode = 
  | 'full'        // Full CLIP embedding cosine similarity
  | 'colors'      // Color palette distance
  | 'mood'        // Mood embedding similarity  
  | 'tags'        // Jaccard similarity of tags
  | 'description' // Description embedding similarity
  | 'composite';  // Weighted combination

interface SimilarityConfig {
  mode: SimilarityMode;
  threshold: number;     // Min similarity to show edge
  weights?: {            // For composite mode
    visual: number;
    semantic: number;
    color: number;
    mood: number;
  };
}
```

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Visualization**: D3.js for force layouts, custom graph components
- **State**: Zustand for global state, TanStack Query for server state
- **Backend**: AWS Amplify Gen 2 (DynamoDB + Lambda + S3)
- **Storage**: S3 for images and metadata
- **Embeddings**: Pre-computed CLIP embeddings (.npy files)
- **Similarity**: Pre-computed edge matrix for fast graph rendering

## Scripts

### Ingest Images

Upload your processed images to S3 and populate DynamoDB:

```bash
# Dry run (see what would happen)
npm run ingest:dry -- --source ./processed_gallery

# Full upload
npm run ingest -- --source ./processed_gallery \
  --bucket your-bucket-name \
  --table your-table-name

# Skip certain steps
npm run ingest -- --source ./processed_gallery --skip-database
npm run ingest -- --source ./processed_gallery --skip-images
```

### Compute Similarity Matrix

Pre-compute similarity edges from your CLIP embeddings:

```bash
# Basic usage
npm run similarity -- --source ./processed_gallery/metadata

# Custom threshold and output
npm run similarity -- \
  --source ./processed_gallery/metadata \
  --output ./similarity-edges.json \
  --threshold 0.6 \
  --max-edges 30

# Include metadata (tags, mood, colors) in similarity score
npm run similarity -- \
  --source ./processed_gallery/metadata \
  --include-metadata
```

The similarity script:
- Parses your .npy CLIP embeddings
- Computes cosine similarity for all pairs (~3.1M for 2500 images)
- Outputs edges above threshold to JSON
- Automatically chunks large outputs into multiple files

## Local Development (No AWS Required)

You can run the app locally with your actual images before deploying to AWS.

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Generate local data from your images
npm run local:generate -- --source /path/to/processed_gallery

# 3. Serve your images (in another terminal)
cd /path/to/processed_gallery && npx serve -p 8080 --cors

# 4. Start the app (runs on port 5173)
npm run dev
```

### Detailed Setup

**Step 1: Generate local data**

```bash
# Point to your processed_gallery folder
npm run local:generate -- \
  --source ~/pictures/processed_gallery \
  --image-base-url http://localhost:8080

# This creates src/data/localImages.ts
```

**Step 2: Update the store to use local data**

Edit `src/stores/galleryStore.ts`:
```typescript
// Change this line:
import { mockImages } from '@/data/mockData';
// To:
import { localImages } from '@/data/localImages';

// And in the store:
images: localImages,  // instead of mockImages
```

**Step 3: Serve your images**

Option A - Simple HTTP server:
```bash
cd ~/pictures/processed_gallery
npx serve -p 8080 --cors
```

Option B - Symlink to public folder:
```bash
ln -s ~/pictures/processed_gallery ./public/images
# Then use --image-base-url /images when generating
```

**Step 4: Run the app**

```bash
npm run dev
# Opens http://localhost:5173
```

### Changing the Port

```bash
# Use a different port
npm run dev -- --port 4000

# Or edit vite.config.ts
```

### Local Mode Features

In local dev mode (`npm run dev`):
- Authentication is **bypassed** (no login required)
- Images load from your local server
- All layouts and features work
- A "DEV" badge appears in the header

To test with authentication locally, set:
```bash
VITE_USE_AUTH=true npm run dev
```

## Production Deployment

```bash
# Install dependencies
npm install

# Start Amplify sandbox (local AWS emulation)
npm run amplify

# Deploy to Amplify (creates real AWS resources)
npx ampx deploy
```

### Deployment Workflow

1. **Pre-process images locally** (your existing pipeline)
2. **Compute similarity matrix**: `npm run similarity -- --source ./processed_gallery/metadata`
3. **Deploy Amplify backend**: `npx ampx deploy`
4. **Ingest images**: `npm run ingest -- --source ./processed_gallery --bucket <bucket> --table <table>`
5. **Upload similarity edges** to S3
6. **Deploy frontend**: Push to your connected Git branch

## Search Examples

- `"city at sunset"` → Semantic search on description embeddings
- `"images with blue and green"` → Color palette query
- `"peaceful nature scenes"` → Mood + tag combination
- `"birds"` → Direct tag matching
- `"warm golden tones"` → Color mood analysis
