# PixNdx Gallery - Architecture Improvements

## Executive Summary

This document outlines improvements to transform PixNdx Gallery from a working prototype into a production-worthy system with:
- Robust similarity computation using proper vector libraries
- Scalable graph rendering with level-of-detail
- Admin/curation mode for photo management (rate, archive, delete)
- Clear separation between offline preprocessing and online viewing
- Local-first workflow before AWS deployment

---

## Current State Analysis

### What Works Well ✅
- Clean React/TypeScript architecture
- Zustand for state management (simple, effective)
- D3 force layout fundamentals
- Multiple visualization modes
- Precomputed edges approach (right idea)

### Areas for Improvement 🔧

| Component | Current State | Issue |
|-----------|--------------|-------|
| **Similarity** | Custom cosine/jaccard | Fine, but not using CLIP vectors at runtime |
| **Clustering** | Custom K-means/DBSCAN | Reinventing wheel, edge cases not handled |
| **Graph Layout** | Basic D3 force | No LOD, struggles with >500 nodes |
| **Edge Filtering** | Hard-coded limits | Should be dynamic based on viewport/zoom |
| **Color Analysis** | Custom RGB→HSL | Missing perceptual color spaces (LAB, OKLAB) |
| **Admin Mode** | None | No curation workflow |
| **Persistence** | None | Decisions lost on refresh |

---

## Architecture Overview

### Two-Phase Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 1: OFFLINE PREPROCESSING                        │
│                        (Python + Node CLI Tools)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Raw Images                                                                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Image Processing Pipeline                        │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │    │
│  │  │ Resize   │  │ CLIP     │  │ Color    │  │ Perceptual Hash      │ │    │
│  │  │ (sharp)  │  │ Embed    │  │ Extract  │  │ (duplicate detect)   │ │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘ │    │
│  │       │             │             │                   │             │    │
│  │       ▼             ▼             ▼                   ▼             │    │
│  │  small/medium/   embeddings/   metadata/          duplicates.json   │    │
│  │  full/             .npy          .json                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Similarity Matrix Computation                    │    │
│  │                                                                      │    │
│  │   CLIP Embeddings ──────┐                                           │    │
│  │                         │    ┌────────────────────┐                 │    │
│  │   Metadata Features ────┼───►│  Pairwise Cosine   │                 │    │
│  │                         │    │  (NumPy/FAISS)     │                 │    │
│  │   Color Palettes ───────┘    └─────────┬──────────┘                 │    │
│  │                                        │                            │    │
│  │                                        ▼                            │    │
│  │                              edges.json (filtered by threshold)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Layout Precomputation (Optional)                 │    │
│  │                                                                      │    │
│  │   Run ForceAtlas2 or UMAP to get initial 2D positions               │    │
│  │   Compute cluster assignments (HDBSCAN)                             │    │
│  │   Generate layout.json with {id, x, y, cluster}                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│   Output: processed_gallery/                                                 │
│     ├── small/, medium/, full/                                              │
│     ├── metadata/*.json                                                      │
│     ├── embeddings/*.npy                                                     │
│     ├── edges.json                                                          │
│     ├── layout.json                                                         │
│     └── duplicates.json                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 2: ONLINE VIEWING                               │
│                        (React SPA)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                         Data Loading                               │     │
│   │   - Load localImages.ts (generated from metadata/*.json)          │     │
│   │   - Load precomputedEdges (from edges.json)                       │     │
│   │   - Load layout positions (from layout.json, optional)            │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                     │                                        │
│                                     ▼                                        │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                      Graph Data Structure                          │     │
│   │            (graphology - proper graph library)                     │     │
│   │                                                                    │     │
│   │   - Nodes: images with positions, metadata, cluster ID            │     │
│   │   - Edges: similarity weights, filtered by threshold              │     │
│   │   - Efficient neighbor lookups, degree calculations               │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                     │                                        │
│                                     ▼                                        │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐     │
│   │  Viewer Mode     │  │  Admin Mode      │  │  Layout Engine       │     │
│   │                  │  │  (curation)      │  │                      │     │
│   │  - Browse        │  │  - Rate images   │  │  - Grid (CSS)        │     │
│   │  - Search        │  │  - Mark delete   │  │  - Network (D3/Sigma)│     │
│   │  - Filter        │  │  - Find dupes    │  │  - Color wheel       │     │
│   │  - Similar       │  │  - Batch select  │  │  - Cluster view      │     │
│   │                  │  │  - Export        │  │  - UMAP projection   │     │
│   └──────────────────┘  └──────────────────┘  └──────────────────────┘     │
│                                     │                                        │
│                                     ▼                                        │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │                     Local Persistence                              │     │
│   │              (IndexedDB via Dexie.js)                             │     │
│   │                                                                    │     │
│   │   - User ratings per image                                        │     │
│   │   - Curation decisions (keep/archive/delete)                      │     │
│   │   - Session state (current view, selections)                      │     │
│   │   - Undo history                                                  │     │
│   └───────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Improvements

### 1. Similarity Computation (Offline)

**Current Problem**: Custom cosine similarity works, but CLIP vectors aren't used at runtime.

**Solution**: Move all heavy computation offline, use optimized libraries.

```python
# preprocessing/compute_similarity.py
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import faiss  # For approximate nearest neighbor at scale

def compute_clip_similarity_matrix(embeddings: np.ndarray, threshold: float = 0.7):
    """
    Compute pairwise cosine similarity using NumPy (fast).
    For >10k images, use FAISS approximate search.
    """
    n = len(embeddings)
    
    if n > 10000:
        # Use FAISS for approximate nearest neighbors
        index = faiss.IndexFlatIP(embeddings.shape[1])  # Inner product = cosine for normalized
        faiss.normalize_L2(embeddings)
        index.add(embeddings)
        
        # Search for k nearest neighbors
        k = 50
        distances, indices = index.search(embeddings, k)
        
        edges = []
        for i in range(n):
            for j, (dist, idx) in enumerate(zip(distances[i], indices[i])):
                if idx > i and dist >= threshold:  # Avoid duplicates
                    edges.append({
                        "source": image_ids[i],
                        "target": image_ids[idx],
                        "weight": float(dist)
                    })
        return edges
    else:
        # Direct computation for smaller sets
        similarity_matrix = cosine_similarity(embeddings)
        # ... extract edges above threshold
```

**Why FAISS?**
- Handles millions of vectors efficiently
- Approximate search is O(log n) vs O(n²)
- GPU-accelerated options available

### 2. Graph Library (Online)

**Current Problem**: Using raw D3 force simulation with manual node/edge arrays.

**Solution**: Use `graphology` - a robust graph library.

```typescript
// src/lib/graph/imageGraph.ts
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import louvain from 'graphology-communities-louvain';

export function createImageGraph(
  images: ImageMetadata[],
  edges: SimilarityEdge[]
): Graph {
  const graph = new Graph({ type: 'undirected' });
  
  // Add nodes with attributes
  images.forEach(img => {
    graph.addNode(img.id, {
      image: img,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      size: 10,
      color: getDominantColor(img),
    });
  });
  
  // Add edges
  edges.forEach(edge => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.addEdge(edge.source, edge.target, {
        weight: edge.weight,
      });
    }
  });
  
  return graph;
}

// Compute communities (clusters) efficiently
export function computeCommunities(graph: Graph): Map<string, number> {
  return louvain(graph, { resolution: 1.0 });
}

// Run ForceAtlas2 layout (better than basic force-directed)
export function runLayout(graph: Graph, iterations: number = 100): void {
  forceAtlas2.assign(graph, {
    iterations,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      strongGravityMode: true,
      barnesHutOptimize: graph.order > 500,  // Use Barnes-Hut for large graphs
    },
  });
}
```

**Why graphology?**
- Proper graph data structure with O(1) lookups
- Algorithms: communities, centrality, shortest paths
- Layout algorithms: ForceAtlas2, circular, random
- Renderers: Sigma.js for WebGL

### 3. Large Graph Rendering

**Current Problem**: D3 SVG struggles with >500 nodes.

**Solution**: Use Sigma.js (WebGL) with level-of-detail.

```typescript
// src/components/Layouts/NetworkGraphSigma.tsx
import Sigma from 'sigma';
import { useEffect, useRef } from 'react';

export function NetworkGraphSigma({ graph }: { graph: Graph }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Create Sigma renderer
    sigmaRef.current = new Sigma(graph, containerRef.current, {
      renderLabels: false,
      renderEdgeLabels: false,
      // Level of detail: hide edges when zoomed out
      minEdgeThickness: 0.5,
      // Node reducer: show thumbnails at high zoom, dots at low zoom
      nodeReducer: (node, data) => {
        const camera = sigmaRef.current?.getCamera();
        const ratio = camera?.ratio || 1;
        
        if (ratio < 0.3) {
          // Zoomed in: show image thumbnails
          return { ...data, type: 'image', image: data.image.urls.small };
        } else {
          // Zoomed out: show colored circles
          return { ...data, type: 'circle' };
        }
      },
    });
    
    return () => sigmaRef.current?.kill();
  }, [graph]);
  
  return <div ref={containerRef} className="w-full h-full" />;
}
```

**Level-of-Detail Strategy**:
| Zoom Level | Nodes | Edges | Labels |
|------------|-------|-------|--------|
| Far (overview) | Colored dots | Top 10% by weight | None |
| Medium | Thumbnails | Top 50% | Cluster labels |
| Close | Full images | All visible | Image titles |

### 4. Clustering Improvements

**Current Problem**: Custom K-means/DBSCAN implementations.

**Solution**: Use established libraries.

```typescript
// For frontend clustering (small datasets)
import { kmeans } from 'ml-kmeans';
import DBSCAN from 'dbscanjs';

// Better: use HDBSCAN offline (Python) and load cluster assignments
// HDBSCAN handles varying densities better than DBSCAN
```

```python
# preprocessing/cluster_images.py
import hdbscan
import umap

def cluster_images(embeddings: np.ndarray):
    """
    1. Reduce dimensionality with UMAP (for viz and clustering)
    2. Cluster with HDBSCAN (density-based, no k required)
    """
    # Reduce to 2D for visualization
    reducer = umap.UMAP(
        n_components=2,
        metric='cosine',
        min_dist=0.1,
        n_neighbors=15,
    )
    coords_2d = reducer.fit_transform(embeddings)
    
    # Cluster in high-dimensional space
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=5,
        metric='euclidean',
        cluster_selection_epsilon=0.1,
    )
    labels = clusterer.fit_predict(embeddings)
    
    return {
        'positions': coords_2d.tolist(),  # [[x, y], ...]
        'clusters': labels.tolist(),       # [0, 1, 0, -1, 2, ...]
        'probabilities': clusterer.probabilities_.tolist(),
    }
```

### 5. Color Analysis

**Current Problem**: RGB/HSL only, missing perceptual color spaces.

**Solution**: Use OKLAB for perceptually uniform color distance.

```typescript
// src/lib/colors/oklab.ts
// OKLAB is superior for color similarity - designed for human perception

interface OKLAB { L: number; a: number; b: number; }

export function rgbToOklab(r: number, g: number, b: number): OKLAB {
  // Convert sRGB to linear RGB
  const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  
  // Linear RGB to LMS
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  
  // LMS to OKLAB
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

export function oklabDistance(c1: OKLAB, c2: OKLAB): number {
  // Euclidean distance in OKLAB space = perceptual difference
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}
```

### 6. Admin/Curation Mode

This is the big new feature. Here's the design:

```typescript
// src/types/curation.ts
export type CurationStatus = 
  | 'unreviewed'
  | 'keep'
  | 'archive'    // Move to archive folder
  | 'delete'     // Mark for deletion
  | 'favorite';  // Best of the best

export interface CurationDecision {
  imageId: string;
  status: CurationStatus;
  rating: number;        // 0-5 stars
  notes?: string;
  reviewedAt: Date;
}

export interface DuplicateGroup {
  masterId: string;      // The one to keep
  duplicateIds: string[]; // Others to delete/archive
  similarity: number;
}
```

```typescript
// src/stores/curationStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Dexie from 'dexie';

// Use IndexedDB for persistence across sessions
class CurationDatabase extends Dexie {
  decisions!: Dexie.Table<CurationDecision, string>;
  
  constructor() {
    super('PixNdxCuration');
    this.version(1).stores({
      decisions: 'imageId, status, rating, reviewedAt',
    });
  }
}

const db = new CurationDatabase();

interface CurationStore {
  // Mode
  isAdminMode: boolean;
  toggleAdminMode: () => void;
  
  // Decisions
  decisions: Map<string, CurationDecision>;
  setDecision: (imageId: string, decision: Partial<CurationDecision>) => void;
  
  // Batch operations
  selectedImages: Set<string>;
  toggleSelection: (imageId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  batchSetStatus: (status: CurationStatus) => void;
  
  // Undo/Redo
  undoStack: CurationDecision[][];
  redoStack: CurationDecision[][];
  undo: () => void;
  redo: () => void;
  
  // Duplicates
  duplicateGroups: DuplicateGroup[];
  loadDuplicates: () => Promise<void>;
  
  // Export
  exportDecisions: () => Promise<string>;  // JSON
  exportScript: () => Promise<string>;     // Shell script to move/delete files
}
```

```typescript
// src/components/Admin/CurationToolbar.tsx
export function CurationToolbar() {
  const { 
    isAdminMode, 
    selectedImages, 
    batchSetStatus,
    undo,
    redo,
    undoStack,
    redoStack,
  } = useCurationStore();
  
  if (!isAdminMode) return null;
  
  const count = selectedImages.size;
  
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-nebula-900/95 border-t border-nebula-700 p-4">
      <div className="flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-nebula-300">
            {count} image{count !== 1 ? 's' : ''} selected
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            onClick={undo} 
            disabled={undoStack.length === 0}
          >
            <Undo size={18} />
          </Button>
          <Button 
            variant="ghost" 
            onClick={redo}
            disabled={redoStack.length === 0}
          >
            <Redo size={18} />
          </Button>
          
          <div className="w-px h-6 bg-nebula-700 mx-2" />
          
          <Button 
            variant="success"
            onClick={() => batchSetStatus('keep')}
            disabled={count === 0}
          >
            <Check size={18} /> Keep
          </Button>
          <Button 
            variant="warning"
            onClick={() => batchSetStatus('archive')}
            disabled={count === 0}
          >
            <Archive size={18} /> Archive
          </Button>
          <Button 
            variant="danger"
            onClick={() => batchSetStatus('delete')}
            disabled={count === 0}
          >
            <Trash size={18} /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### 7. Duplicate Detection

**Offline**: Use perceptual hashing (pHash) to find near-duplicates.

```python
# preprocessing/find_duplicates.py
import imagehash
from PIL import Image
from collections import defaultdict

def find_duplicates(image_dir: str, threshold: int = 8):
    """
    Find duplicate/near-duplicate images using perceptual hashing.
    
    threshold: Hamming distance threshold (8 = similar, 0 = identical)
    """
    hashes = {}
    for img_path in image_dir.glob("*.jpg"):
        img = Image.open(img_path)
        # Use multiple hash types for robustness
        phash = imagehash.phash(img)
        dhash = imagehash.dhash(img)
        hashes[img_path.stem] = (phash, dhash)
    
    duplicates = defaultdict(list)
    image_ids = list(hashes.keys())
    
    for i, id1 in enumerate(image_ids):
        for id2 in image_ids[i+1:]:
            p1, d1 = hashes[id1]
            p2, d2 = hashes[id2]
            
            # Check both hash types
            p_dist = p1 - p2
            d_dist = d1 - d2
            
            if p_dist <= threshold and d_dist <= threshold:
                # Find existing group or create new
                found = False
                for master, dupes in duplicates.items():
                    if id1 == master or id1 in dupes:
                        dupes.append(id2)
                        found = True
                        break
                    if id2 == master or id2 in dupes:
                        dupes.append(id1)
                        found = True
                        break
                
                if not found:
                    duplicates[id1].append(id2)
    
    return dict(duplicates)
```

**Online UI**:

```typescript
// src/components/Admin/DuplicateReview.tsx
export function DuplicateReview() {
  const { duplicateGroups, setDecision } = useCurationStore();
  const [currentGroup, setCurrentGroup] = useState(0);
  
  if (duplicateGroups.length === 0) {
    return <div>No duplicates found!</div>;
  }
  
  const group = duplicateGroups[currentGroup];
  const allImages = [group.masterId, ...group.duplicateIds];
  
  return (
    <div className="p-4">
      <h2>Duplicate Group {currentGroup + 1} of {duplicateGroups.length}</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {allImages.map((imageId, index) => (
          <div key={imageId} className="relative">
            <ImageCard imageId={imageId} />
            
            {index === 0 && (
              <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded">
                Master
              </div>
            )}
            
            <div className="mt-2 flex gap-2">
              <Button 
                onClick={() => setDecision(imageId, { status: 'keep' })}
                size="sm"
              >
                Keep
              </Button>
              <Button 
                onClick={() => setDecision(imageId, { status: 'delete' })}
                variant="danger"
                size="sm"
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 flex justify-between">
        <Button 
          onClick={() => setCurrentGroup(g => Math.max(0, g - 1))}
          disabled={currentGroup === 0}
        >
          Previous
        </Button>
        <Button
          onClick={() => setCurrentGroup(g => Math.min(duplicateGroups.length - 1, g + 1))}
          disabled={currentGroup === duplicateGroups.length - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
```

### 8. Export Curation Decisions

After reviewing locally, export decisions to apply to filesystem:

```typescript
// src/lib/export/curationExport.ts
export function generateShellScript(decisions: CurationDecision[]): string {
  const lines = [
    '#!/bin/bash',
    '# Generated by PixNdx Gallery',
    `# ${new Date().toISOString()}`,
    '',
    '# Create directories',
    'mkdir -p archive deleted',
    '',
    '# Process images',
  ];
  
  for (const d of decisions) {
    if (d.status === 'delete') {
      lines.push(`mv "full/${d.imageId}."* deleted/`);
      lines.push(`mv "medium/${d.imageId}."* deleted/`);
      lines.push(`mv "small/${d.imageId}."* deleted/`);
      lines.push(`mv "metadata/${d.imageId}.json" deleted/`);
    } else if (d.status === 'archive') {
      lines.push(`mv "full/${d.imageId}."* archive/full/`);
      lines.push(`mv "medium/${d.imageId}."* archive/medium/`);
      lines.push(`mv "small/${d.imageId}."* archive/small/`);
      lines.push(`mv "metadata/${d.imageId}.json" archive/metadata/`);
    }
  }
  
  lines.push('');
  lines.push('echo "Done! Review deleted/ folder before permanently removing."');
  
  return lines.join('\n');
}
```

---

## Recommended Libraries

### Replace Custom Implementations

| Current | Replace With | Why |
|---------|-------------|-----|
| Custom cosine similarity | `ml-distance` | Optimized, well-tested |
| Custom K-means | `ml-kmeans` | Edge cases, initialization |
| Custom DBSCAN | HDBSCAN (Python) | Better for varying density |
| Raw D3 force | `graphology` + Sigma.js | Proper data structure, WebGL |
| Custom color distance | `culori` (OKLAB) | Perceptually uniform |
| Manual state persistence | Dexie.js (IndexedDB) | Robust, async |
| Custom layout | `graphology-layout-forceatlas2` | Mature algorithm |

### New Dependencies to Add

```json
{
  "dependencies": {
    "graphology": "^0.25.4",
    "graphology-layout-forceatlas2": "^0.10.1",
    "graphology-communities-louvain": "^2.0.1",
    "sigma": "^3.0.0",
    "dexie": "^4.0.0",
    "culori": "^4.0.0",
    "ml-distance": "^4.0.1",
    "ml-kmeans": "^6.0.0"
  }
}
```

---

## Implementation Priority

### Phase 1: Core Improvements (Week 1)
1. ✅ Add `graphology` for graph data structure
2. ✅ Switch to `graphology-layout-forceatlas2`
3. ✅ Add Dexie.js for persistence
4. ✅ Implement basic admin mode toggle

### Phase 2: Curation Features (Week 2)
1. Rating component (stars)
2. Keep/Archive/Delete buttons
3. Batch selection
4. Undo/redo
5. Export decisions

### Phase 3: Duplicate Detection (Week 3)
1. Python script for pHash computation
2. Load duplicates.json
3. Duplicate review UI
4. Side-by-side comparison

### Phase 4: Rendering Performance (Week 4)
1. Switch to Sigma.js for WebGL
2. Level-of-detail rendering
3. Virtual scrolling for grid view
4. Image loading optimization

### Phase 5: Polish (Week 5)
1. OKLAB color analysis
2. Better search ranking
3. Keyboard shortcuts
4. Mobile responsiveness

---

## Offline Processing Pipeline

Here's the recommended directory structure for preprocessing:

```
preprocessing/
├── requirements.txt         # Python dependencies
├── compute_embeddings.py    # CLIP embedding generation
├── compute_similarity.py    # Pairwise similarity matrix
├── cluster_images.py        # UMAP + HDBSCAN
├── find_duplicates.py       # Perceptual hashing
├── resize_images.py         # Generate thumbnails (sharp)
└── generate_metadata.py     # Combine all outputs
```

```bash
# Full preprocessing pipeline
cd preprocessing

# 1. Generate thumbnails
python resize_images.py --input ../raw_photos --output ../processed_gallery

# 2. Compute CLIP embeddings
python compute_embeddings.py --input ../processed_gallery/full --output ../processed_gallery/embeddings

# 3. Find duplicates
python find_duplicates.py --input ../processed_gallery/full --output ../processed_gallery/duplicates.json

# 4. Compute similarity edges
python compute_similarity.py --embeddings ../processed_gallery/embeddings --output ../processed_gallery/edges.json --threshold 0.7

# 5. Compute layout positions
python cluster_images.py --embeddings ../processed_gallery/embeddings --output ../processed_gallery/layout.json

# 6. Generate localImages.ts
npm run local:generate -- --source ../processed_gallery
```

---

## Summary

The key architectural changes are:

1. **Two-phase architecture**: Heavy computation offline, fast viewing online
2. **Proper graph library**: graphology instead of raw arrays
3. **WebGL rendering**: Sigma.js for large graphs
4. **Admin mode**: Full curation workflow with persistence
5. **Perceptual algorithms**: OKLAB colors, perceptual hashing
6. **Local-first**: IndexedDB persistence, export to filesystem

This transforms PixNdx Gallery from a viewing app into a complete photo management system that runs locally first, then optionally deploys to AWS.

