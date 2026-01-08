import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import type { ImageMetadata } from '@/types/gallery';

// These exports may not exist until clustering is run - provide fallbacks
let clusterInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = {};
let communityInfo: Record<string, { name: string; count: number; common_tags?: string[] }> = {};

try {
  // Dynamic import won't work here, so we'll use require with try/catch
  const localData = require('@/data/localImages');
  clusterInfo = localData.clusterInfo || {};
  communityInfo = localData.communityInfo || {};
} catch {
  // Clustering data not available yet
}

type ClusterMode = 'auto' | 'hdbscan' | 'louvain' | 'tags';

interface Cluster {
  id: number | string;
  name: string;
  images: ImageMetadata[];
  color: string;
  commonTags?: string[];
}

// Color palette for clusters
const CLUSTER_COLORS = [
  '#E74C3C', '#3498DB', '#27AE60', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E91E63', '#00BCD4', '#FF5722', '#607D8B',
  '#8E44AD', '#16A085', '#D35400', '#2980B9', '#C0392B',
  '#7D3C98', '#148F77', '#D68910', '#2E86AB', '#A93226',
];

export function ClusterView() {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  const [mode, setMode] = useState<ClusterMode>('auto');
  
  // Determine what clustering data is available
  const hasHdbscan = useMemo(() => 
    filteredImages.some(img => img.cluster !== undefined && img.cluster !== -1), 
    [filteredImages]
  );
  
  const hasLouvain = useMemo(() => 
    filteredImages.some(img => img.community !== undefined), 
    [filteredImages]
  );
  
  // Determine effective mode
  const effectiveMode = useMemo(() => {
    if (mode === 'auto') {
      if (hasLouvain) return 'louvain';
      if (hasHdbscan) return 'hdbscan';
      return 'tags';
    }
    return mode;
  }, [mode, hasHdbscan, hasLouvain]);
  
  // Group images into clusters
  const clusters = useMemo(() => {
    const clusterMap = new Map<number | string, ImageMetadata[]>();
    
    if (effectiveMode === 'hdbscan') {
      // Group by HDBSCAN cluster
      filteredImages.forEach((img) => {
        const clusterId = img.cluster ?? -1;
        if (!clusterMap.has(clusterId)) {
          clusterMap.set(clusterId, []);
        }
        clusterMap.get(clusterId)!.push(img);
      });
    } else if (effectiveMode === 'louvain') {
      // Group by Louvain community
      filteredImages.forEach((img) => {
        const communityId = img.community ?? -1;
        if (!clusterMap.has(communityId)) {
          clusterMap.set(communityId, []);
        }
        clusterMap.get(communityId)!.push(img);
      });
    } else {
      // Fallback: group by first tag category
      filteredImages.forEach((img) => {
        const categories = Object.keys(img.tags);
        const mainCategory = categories[0] || 'other';
        const mainTag = img.tags[mainCategory]?.[0] || mainCategory;
        const key = `${mainCategory}:${mainTag}`;
        
        if (!clusterMap.has(key)) {
          clusterMap.set(key, []);
        }
        clusterMap.get(key)!.push(img);
      });
    }
    
    // Convert to cluster objects
    const clusterArray: Cluster[] = [];
    let colorIndex = 0;
    
    clusterMap.forEach((images, id) => {
      let name: string;
      let commonTags: string[] | undefined;
      
      if (effectiveMode === 'hdbscan') {
        const info = clusterInfo[String(id)];
        name = info?.name || (id === -1 ? 'Unclustered' : `Cluster ${Number(id) + 1}`);
        commonTags = info?.common_tags;
      } else if (effectiveMode === 'louvain') {
        const info = communityInfo[String(id)];
        name = info?.name || (id === -1 ? 'Unclustered' : `Community ${Number(id) + 1}`);
        commonTags = info?.common_tags;
      } else {
        const [category, tag] = String(id).split(':');
        name = tag || category || 'Other';
      }
      
      clusterArray.push({
        id,
        name,
        images,
        color: id === -1 ? '#6B7280' : CLUSTER_COLORS[colorIndex % CLUSTER_COLORS.length],
        commonTags,
      });
      
      if (id !== -1) colorIndex++;
    });
    
    // Sort by size (put unclustered at end)
    return clusterArray.sort((a, b) => {
      if (a.id === -1) return 1;
      if (b.id === -1) return -1;
      return b.images.length - a.images.length;
    });
  }, [filteredImages, effectiveMode]);
  
  const totalClusters = clusters.filter(c => c.id !== -1).length;
  const unclusteredCount = clusters.find(c => c.id === -1)?.images.length ?? 0;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full overflow-auto p-8"
    >
      {/* Mode selector */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {(['auto', 'louvain', 'hdbscan', 'tags'] as ClusterMode[]).map((m) => {
              const isAvailable = 
                m === 'auto' || m === 'tags' ||
                (m === 'louvain' && hasLouvain) ||
                (m === 'hdbscan' && hasHdbscan);
              
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={!isAvailable}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    mode === m
                      ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
                      : isAvailable
                        ? 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
                        : 'bg-nebula-900/30 text-nebula-600 cursor-not-allowed'
                  }`}
                >
                  {m === 'auto' ? 'Auto' : 
                   m === 'louvain' ? 'Louvain' : 
                   m === 'hdbscan' ? 'HDBSCAN' : 'Tags'}
                </button>
              );
            })}
          </div>
          
          <span className="text-xs text-nebula-500">
            Using: <span className="text-nebula-300">{effectiveMode}</span>
          </span>
        </div>
        
        <div className="text-xs text-nebula-400">
          {totalClusters} clusters • {filteredImages.length} images
          {unclusteredCount > 0 && ` • ${unclusteredCount} unclustered`}
        </div>
      </div>
      
      {/* Info banner if no precomputed clusters */}
      {!hasHdbscan && !hasLouvain && (
        <div className="mb-6 p-4 glass rounded-xl text-sm text-nebula-300">
          <p className="mb-2">
            💡 <strong>Tip:</strong> Run the clustering pipeline for better results:
          </p>
          <code className="text-xs text-stellar-cyan bg-nebula-900/50 px-2 py-1 rounded block mt-2">
            python preprocessing/cluster_layout.py --gallery /path/to/gallery --algorithm both
          </code>
        </div>
      )}
      
      {/* Clusters grid */}
      <div className="flex flex-wrap gap-8 justify-center">
        {clusters.map((cluster, clusterIndex) => (
          <motion.div
            key={String(cluster.id)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: clusterIndex * 0.05 }}
            className="relative"
          >
            {/* Cluster background glow */}
            <div
              className="absolute inset-0 rounded-3xl"
              style={{
                backgroundColor: cluster.color,
                opacity: 0.08,
                filter: 'blur(40px)',
                transform: 'scale(1.1)',
              }}
            />
            
            <div className="glass rounded-2xl p-6 relative">
              {/* Cluster header */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: cluster.color }}
                />
                <h3 className="text-sm font-display uppercase tracking-wider text-white">
                  {cluster.name}
                </h3>
                <span className="text-xs text-nebula-400 ml-auto">
                  {cluster.images.length} images
                </span>
              </div>
              
              {/* Common tags (if available) */}
              {cluster.commonTags && cluster.commonTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {cluster.commonTags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${cluster.color}20`,
                        color: cluster.color,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              
              {/* Cluster images */}
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(cluster.images.length, 5)}, 1fr)`,
                  maxWidth: Math.min(cluster.images.length, 5) * 72,
                }}
              >
                {cluster.images.slice(0, 20).map((image, imageIndex) => {
                  const isHovered = hoveredImage?.id === image.id;
                  
                  return (
                    <motion.div
                      key={image.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ 
                        opacity: 1, 
                        y: 0,
                        scale: isHovered ? 1.15 : 1,
                        zIndex: isHovered ? 10 : 1,
                      }}
                      transition={{ delay: clusterIndex * 0.05 + imageIndex * 0.02 }}
                      className="relative cursor-pointer"
                      onMouseEnter={() => setHoveredImage(image)}
                      onMouseLeave={() => setHoveredImage(null)}
                      onClick={() => openModal(image)}
                    >
                      <div
                        className="w-14 h-14 rounded-lg overflow-hidden ring-2 transition-all"
                        style={{
                          ['--tw-ring-color' as string]: isHovered ? cluster.color : 'transparent',
                          boxShadow: isHovered ? `0 0 20px ${cluster.color}40` : 'none',
                        }}
                      >
                        <img
                          src={image.urls.small}
                          alt={image.main_subject}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      
                      {/* Tooltip */}
                      {isHovered && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 glass rounded-lg p-2 whitespace-nowrap z-20"
                          style={{ minWidth: 150 }}
                        >
                          <div className="text-xs text-white">{image.main_subject}</div>
                          <div className="text-[10px] text-nebula-400 mt-1">
                            {image.filename}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
                
                {/* Show more indicator */}
                {cluster.images.length > 20 && (
                  <div className="w-14 h-14 rounded-lg bg-nebula-800/50 flex items-center justify-center text-xs text-nebula-400">
                    +{cluster.images.length - 20}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      {filteredImages.length === 0 && (
        <div className="flex items-center justify-center h-64 text-nebula-400">
          <p>No images found</p>
        </div>
      )}
    </motion.div>
  );
}
