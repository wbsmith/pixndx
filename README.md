# PixNdx Gallery

A semantic photo gallery with natural language search, similarity-based visualizations, and multiple creative layout modes including force-directed network graphs.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AWS AMPLIFY GEN 2                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│   │   React SPA     │    │   GraphQL API   │    │      S3 Storage         │  │
│   │   Vite + React  │◄──►│   + Lambda      │    │  images/ + metadata/    │  │
│   │   Tailwind CSS  │    │   Functions     │    │  + embeddings/          │  │
│   └─────────────────┘    └────────┬────────┘    └───────────┬─────────────┘  │
│                                   │                         │                │
│                                   ▼                         ▼                │
│                          ┌─────────────────┐       ┌─────────────────┐       │
│                          │   DynamoDB      │       │   Cognito       │       │
│                          │   (Image Data)  │       │   (Auth)        │       │
│                          └─────────────────┘       └─────────────────┘       │
│                                                                              │
│   Lambda Functions:                                                          │
│   ├── searchImages      - Semantic text search against metadata              │
│   ├── ingestImage       - Image upload, resize, and metadata storage         │
│   └── computeSimilarity - Pairwise similarity computation                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Features

### 1. Multiple Visualization Layouts

| Layout | Description |
|--------|-------------|
| **Grid** | Responsive masonry-style grid layout |
| **Network Graph** | D3 force-directed graph with similarity edges |
| **Color Wheel** | Radial arrangement by dominant hue |
| **Mood Spectrum** | Linear gradient from calm to energetic |
| **Cluster View** | K-means grouped islands by visual/semantic similarity |

### 2. Semantic Search

- Natural language queries: `"sunset over water"`, `"peaceful forest scenes"`
- Matches against tags, description, mood, main subject, and color names
- Phrase matching and multi-word scoring
- Real-time autocomplete suggestions from indexed metadata

### 3. Similarity Computation

Images are connected by precomputed similarity edges using:

- **CLIP embeddings** - Visual similarity from `.npy` vector files
- **Metadata similarity** - Tag jaccard, mood matching, color palette distance
- **Composite mode** - Weighted combination of all signals

Configurable threshold slider to show/hide edges above a similarity score.

### 4. Clustering Algorithms

Three clustering algorithms available in `src/lib/similarity/clustering.ts`:

- **K-Means** - Partition-based with k-means++ initialization
- **DBSCAN** - Density-based for discovering natural groupings
- **Hierarchical** - Agglomerative with single/complete/average linkage

### 5. Admin/Curation Mode

Toggle admin mode to review and organize your photo collection:

- **Rate images** - 0-5 star rating system
- **Mark status** - Keep, Archive, Delete, or Favorite
- **Batch operations** - Select multiple images for bulk actions
- **Undo/Redo** - Full history of curation decisions
- **Duplicate detection** - Find near-duplicate images via perceptual hashing
- **Export decisions** - Generate shell scripts to apply file operations

Curation decisions persist in browser storage (IndexedDB) and can be exported for processing.

---

## Architecture Improvements

For production deployment and advanced features, see **[ARCHITECTURE.md](./ARCHITECTURE.md)** which covers:

- Two-phase architecture (offline preprocessing + online viewing)
- Using `graphology` for graph data structures
- WebGL rendering with Sigma.js for large graphs
- HDBSCAN clustering and UMAP layout
- Perceptual hashing for duplicate detection
- OKLAB color space for perceptual color matching

---

## Directory Structure

```
pixndx/
├── preprocessing/                    # Python preprocessing pipeline
│   ├── requirements.txt              # Python dependencies
│   ├── find_duplicates.py            # Perceptual hashing for duplicates
│   ├── compute_similarity.py         # CLIP-based edge computation
│   └── cluster_layout.py             # UMAP + HDBSCAN clustering
│
├── amplify/                          # AWS Amplify Gen 2 backend
│   ├── backend.ts                    # Main backend definition
│   ├── auth/resource.ts              # Cognito authentication
│   ├── data/resource.ts              # GraphQL schema + queries
│   ├── storage/resource.ts           # S3 bucket configuration
│   └── functions/
│       ├── searchImages/             # Semantic search Lambda
│       ├── ingestImage/              # Image processing Lambda
│       └── computeSimilarity/        # Similarity computation Lambda
│
├── scripts/                          # CLI tools
│   ├── generate-local-data.ts        # Generate localImages.ts from processed_gallery
│   ├── ingest-images.ts              # Upload to S3 + populate DynamoDB
│   └── compute-similarity-matrix.ts  # Precompute CLIP-based edge weights
│
├── src/
│   ├── main.tsx                      # App entry point
│   ├── App.tsx                       # Root component with header/sidebar
│   ├── index.css                     # Tailwind + custom styles
│   │
│   ├── components/
│   │   ├── Admin/
│   │   │   ├── AdminModeToggle.tsx   # Toggle button for admin mode
│   │   │   ├── CurationToolbar.tsx   # Bottom toolbar with actions
│   │   │   └── ImageCurationOverlay.tsx  # Per-image status/rating overlay
│   │   ├── Auth/
│   │   │   └── AuthWrapper.tsx       # Cognito auth provider
│   │   ├── Gallery/
│   │   │   ├── GalleryView.tsx       # Layout switcher
│   │   │   ├── ImageCard.tsx         # Grid image card
│   │   │   ├── ImageModal.tsx        # Fullscreen image viewer
│   │   │   └── ProtectedImage.tsx    # Signed URL image loader
│   │   ├── Layouts/
│   │   │   ├── GridLayout.tsx        # Responsive grid
│   │   │   ├── NetworkGraph.tsx      # D3 force graph
│   │   │   ├── ColorWheel.tsx        # HSL-based radial layout
│   │   │   ├── MoodSpectrum.tsx      # Energy axis layout
│   │   │   ├── ClusterView.tsx       # K-means cluster bubbles
│   │   │   └── TimelineLayout.tsx    # Chronological view
│   │   ├── Search/
│   │   │   ├── SearchBar.tsx         # Query input
│   │   │   ├── FilterPanel.tsx       # Tag/mood/color filters
│   │   │   └── SearchSuggestions.tsx # Autocomplete dropdown
│   │   ├── UI/
│   │   │   ├── LayoutSelector.tsx    # Layout mode tabs
│   │   │   ├── SimilaritySlider.tsx  # Edge threshold control
│   │   │   ├── ImageRating.tsx       # Star rating component
│   │   │   └── LoadingStates.tsx     # Skeleton loaders
│   │   └── Visualization/
│   │       ├── ForceGraph.tsx        # Reusable D3 force component
│   │       ├── SimilarityEdges.tsx   # Edge rendering
│   │       └── ColorCluster.tsx      # Color-based grouping
│   │
│   ├── hooks/
│   │   ├── index.ts                  # Re-exports
│   │   ├── useSearch.ts              # Search state + debounced queries
│   │   ├── useGallery.ts             # Image selection, navigation, preload
│   │   ├── useLayout.ts              # Layout switching + config
│   │   └── useSimilarity.ts          # Edge computation + similar image lookup
│   │
│   ├── stores/
│   │   ├── galleryStore.ts           # Zustand global state
│   │   └── curationStore.ts          # Admin mode / curation decisions
│   │
│   ├── lib/
│   │   ├── api/client.ts             # Amplify API client
│   │   ├── colors/analysis.ts        # RGB↔HSL, color family detection
│   │   └── similarity/
│   │       ├── vectors.ts            # Cosine similarity, color distance
│   │       ├── clustering.ts         # K-means, DBSCAN, hierarchical
│   │       └── layouts.ts            # Position calculation helpers
│   │
│   ├── types/
│   │   └── gallery.ts                # TypeScript interfaces
│   │
│   └── data/
│       ├── localImages.ts            # Generated image + edge data
│       └── mockData.ts               # Fallback sample data
│
├── public/favicon.svg
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── amplify.yml                       # Amplify build settings
```

---

## Image Metadata Schema

Each image has a corresponding JSON file in `metadata/`:

```json
{
  "id": "sunset_beach_001",
  "filename": "sunset_beach.jpg",
  "description": "A breathtaking sunset casts golden and amber hues across gentle ocean waves, with silhouettes of distant sailboats on the horizon.",
  "mood": "serene, contemplative, romantic",
  "main_subject": "sunset over ocean",
  "tags": {
    "landscape": ["coastal", "sunset", "horizon"],
    "weather": ["clear sky", "golden hour"],
    "elements": ["waves", "sailboat", "reflection"]
  },
  "main_colors": {
    "golden_orange": "#E67E22",
    "deep_blue": "#2980B9",
    "amber": "#F39C12",
    "dark_navy": "#1A1A2E"
  },
  "exif": {
    "Make": "Sony",
    "Model": "ILCE-7M3",
    "FocalLength": "35mm",
    "FNumber": 8,
    "ExposureTime": "1/250",
    "ISO": 100,
    "DateTimeOriginal": "2024-03-15T18:45:00",
    "ImageWidth": 4000,
    "ImageHeight": 2667
  }
}
```

TypeScript interface in `src/types/gallery.ts`:

```typescript
interface ImageMetadata {
  id: string;
  filename: string;
  urls: { small: string; medium: string; full: string };
  description: string;
  mood: string;
  main_subject: string;
  tags: Record<string, string[]>;
  main_colors: Record<string, string>;
  exif: ExifData;
  embedding?: { clip: number[]; description: number[] };
  avgRating?: number;
  ratingCount?: number;
}
```

---

## Technology Stack

| Category | Technology |
|----------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **Styling** | Tailwind CSS, custom CSS variables |
| **Animation** | Framer Motion |
| **Visualization** | D3.js (force layouts, zoom/pan) |
| **State** | Zustand (global), TanStack Query (server) |
| **Icons** | Lucide React |
| **Backend** | AWS Amplify Gen 2 |
| **Database** | DynamoDB |
| **Storage** | S3 (images, metadata, embeddings) |
| **Auth** | Cognito |
| **Embeddings** | Pre-computed CLIP vectors (`.npy` files) |

---

## Local Development (No AWS Required)

Run the app locally with your own images before deploying to AWS.

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Generate local data from your processed images
npm run local:generate -- --source /path/to/processed_gallery

# 3. Serve your images (in another terminal)
cd /path/to/processed_gallery && npx serve -p 8080 --cors

# 4. Start the dev server
npm run dev
```

The app opens at `http://localhost:5173`.

### Expected Folder Structure

Your `processed_gallery/` folder should contain:

```
processed_gallery/
├── small/           # Thumbnails (~200px)
│   ├── image_001.jpg
│   └── ...
├── medium/          # Preview size (~800px)
│   ├── image_001.jpg
│   └── ...
├── full/            # Full resolution
│   ├── image_001.jpg
│   └── ...
├── metadata/        # JSON metadata files
│   ├── image_001.json
│   └── ...
└── embeddings/      # Optional CLIP vectors
    ├── image_001.npy
    └── ...
```

### Generate Local Data Options

```bash
npm run local:generate -- \
  --source ~/pictures/processed_gallery \
  --image-base-url http://localhost:8080 \
  --algorithm clip \           # or 'metadata' if no .npy files
  --edge-threshold 0.7 \       # similarity threshold for edges
  --max-edges-per-node 15 \    # limit connections per image
  --skip-edges                 # skip edge computation entirely
```

This generates `src/data/localImages.ts` containing:
- `localImages` - Array of `ImageMetadata` objects
- `precomputedEdges` - Array of `SimilarityEdge` objects

### Local Mode Features

When running `npm run dev`:
- Authentication is **bypassed** (no login required)
- Images load from your local HTTP server
- All layouts and features work
- A **DEV** badge appears in the header

To test with authentication locally:
```bash
VITE_USE_AUTH=true npm run dev
```

---

## Scripts Reference

### `npm run local:generate`

Generate `localImages.ts` from your processed gallery:

```bash
npm run local:generate -- --source ./processed_gallery [options]

Options:
  -s, --source <path>           Source directory (required)
  -u, --image-base-url <url>    Base URL for images (default: /images)
  -a, --algorithm <type>        'clip' or 'metadata' (default: clip)
  -t, --edge-threshold <n>      Similarity threshold (default: 0.7 clip, 0.25 metadata)
  -e, --max-edges-per-node <n>  Max edges per node (default: 15)
  -l, --limit <n>               Limit number of images
      --skip-edges              Skip edge computation
```

### `npm run similarity`

Precompute similarity edges from CLIP embeddings:

```bash
npm run similarity -- --source ./processed_gallery/metadata [options]

Options:
  -s, --source <path>      Source directory with .npy files (required)
  -o, --output <path>      Output JSON file (default: ./similarity-edges.json)
  -t, --threshold <n>      Similarity threshold 0-1 (default: 0.5)
  -m, --max-edges <n>      Max edges per node (default: 50)
      --include-metadata   Include metadata similarity in score
```

### `npm run ingest`

Upload images and metadata to AWS:

```bash
npm run ingest -- --source ./processed_gallery [options]

Options:
  -s, --source <path>     Source directory (required)
  -b, --bucket <name>     S3 bucket name (or S3_BUCKET_NAME env var)
  -t, --table <name>      DynamoDB table name (or DYNAMODB_TABLE_NAME env var)
  -r, --region <region>   AWS region (default: us-east-1)
      --dry-run           Show what would be done without making changes
      --skip-images       Skip uploading images
      --skip-metadata     Skip uploading metadata files
      --skip-database     Skip populating DynamoDB
  -c, --concurrency <n>   Parallel uploads (default: 10)
```

---

## Python Preprocessing Pipeline

For large collections, use the Python preprocessing pipeline for efficient edge computation.

### Directory Structure

The pipeline expects this structure (created by your image processing workflow):

```
gallery_processed/
├── full/           # Original images
├── medium/         # Resized images (1024px) for AI analysis
├── small/          # Thumbnails (300px) for gallery display
└── metadata/
    ├── *.json      # Image metadata (tags, mood, colors, etc.)
    ├── *.npy       # CLIP embeddings (512-dimensional)
    └── edges.json  # Precomputed similarity edges
```

### Setup

```bash
cd preprocessing
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### Full Pipeline (Recommended)

Run the complete pipeline with one command:

```bash
python run_pipeline.py --gallery ./gallery_processed

# With custom settings
python run_pipeline.py --gallery ./gallery_processed \
  --threshold 0.8 \
  --max-edges 25 \
  --find-duplicates

# Skip vectorization if embeddings already exist
python run_pipeline.py --gallery ./gallery_processed --skip-vectorize
```

### Individual Steps

#### 1. Generate CLIP Embeddings

```bash
python batch_vectorize.py ./gallery_processed

# Force CPU if no GPU available
python batch_vectorize.py ./gallery_processed --device cpu
```

This creates `.npy` files in `metadata/` for each image.

#### 2. Compute Similarity Edges (FAISS-accelerated)

```bash
python compute_similarity.py \
  --gallery ./gallery_processed \
  --output ./gallery_processed/metadata/edges.json \
  --threshold 0.7 \
  --max-edges 50

# Stricter threshold for sparser graph
python compute_similarity.py \
  --gallery ./gallery_processed \
  -t 0.85 -m 20
```

For 10,000+ images, FAISS uses approximate nearest neighbor search (O(n log n) instead of O(n²)).

#### 3. Find Duplicates (Optional)

```bash
python find_duplicates.py \
  --images ./gallery_processed/medium \
  --output ./gallery_processed/metadata/duplicates.json \
  --threshold 10
```

Uses perceptual hashing (pHash, dHash) to find near-identical images.

#### 4. Clustering & Layout (Optional)

```bash
python cluster_layout.py \
  --gallery ./gallery_processed \
  --output ./gallery_processed/metadata/clusters.json
```

Uses UMAP for 2D projection and HDBSCAN for density-based clustering.

### Generate Frontend Data

After preprocessing, generate the TypeScript data file:

```bash
npx tsx scripts/generate-local-data.ts \
  --source ./gallery_processed \
  --edges ./gallery_processed/metadata/edges.json
```

This creates `src/data/localImages.ts` with precomputed edges loaded from Python.

---

## AWS Deployment

### 1. Deploy Amplify Backend

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Start local sandbox (for development)
npm run amplify

# Deploy to AWS (creates real resources)
npx ampx deploy
```

### 2. Ingest Your Images

```bash
# After deployment, get your bucket and table names from Amplify outputs
npm run ingest -- \
  --source ./processed_gallery \
  --bucket <your-bucket-name> \
  --table <your-table-name>
```

### 3. Upload Similarity Edges

```bash
# Compute edges
npm run similarity -- --source ./processed_gallery/metadata --output ./edges.json

# Upload to S3
aws s3 cp ./edges.json s3://<your-bucket-name>/edges/similarity-edges.json
```

### 4. Deploy Frontend

Push to your connected Git branch, and Amplify will automatically build and deploy.

---

## Hooks API

### `useGallery()`

Core gallery state and navigation:

```typescript
const {
  images,            // All images
  filteredImages,    // Search-filtered images
  selectedImage,     // Currently selected
  openModal,         // (image) => void
  closeModal,        // () => void
  nextImage,         // () => void
  previousImage,     // () => void
  getImageById,      // (id) => ImageMetadata | undefined
} = useGallery();
```

### `useSearch()`

Search state and actions:

```typescript
const {
  query,             // Current search query
  setQuery,          // (text) => void (debounced)
  results,           // SearchResult[]
  isSearching,       // Loading state
  clearSearch,       // () => void
} = useSearch();
```

### `useSimilarity()`

Similarity configuration:

```typescript
const {
  mode,              // 'full' | 'colors' | 'mood' | 'tags' | 'composite'
  threshold,         // 0-1
  setThreshold,      // (n) => void
  edges,             // SimilarityEdge[]
  getSimilarImages,  // (imageId, limit) => ImageMetadata[]
} = useSimilarity();
```

### `useLayout()`

Layout switching:

```typescript
const {
  currentLayout,     // 'grid' | 'network' | 'colorWheel' | 'moodSpectrum' | 'cluster'
  setLayout,         // (type) => void
  availableLayouts,  // LayoutInfo[]
} = useLayout();
```

---

## Search Examples

| Query | What it matches |
|-------|-----------------|
| `"sunset over water"` | Description + main_subject containing phrase |
| `"coastal"` | Tag exact match |
| `"peaceful"` | Mood keyword |
| `"golden orange"` | Color name in main_colors keys |
| `"forest nature green"` | Multi-word scoring across all fields |
| `"warm golden tones"` | Color + mood combination |

---

## License

MIT
