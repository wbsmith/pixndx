import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import type { ImageMetadata } from '@/types/gallery';

interface Cluster {
  name: string;
  images: ImageMetadata[];
  color: string;
}

export function ClusterView() {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  
  // Group images by tag categories
  const clusters = useMemo(() => {
    const tagGroups = new Map<string, ImageMetadata[]>();
    
    // Group by first tag category and its first tag
    filteredImages.forEach((img) => {
      const categories = Object.keys(img.tags);
      const mainCategory = categories[0] || 'other';
      const mainTag = img.tags[mainCategory]?.[0] || mainCategory;
      
      const key = `${mainCategory}:${mainTag}`;
      if (!tagGroups.has(key)) {
        tagGroups.set(key, []);
      }
      tagGroups.get(key)!.push(img);
    });
    
    // Convert to clusters with colors
    const colors = [
      '#E74C3C', '#3498DB', '#27AE60', '#F39C12', '#9B59B6',
      '#1ABC9C', '#E91E63', '#00BCD4', '#FF5722', '#607D8B',
    ];
    
    const clusterArray: Cluster[] = [];
    let colorIndex = 0;
    
    tagGroups.forEach((images, key) => {
      const [category, tag] = key.split(':');
      clusterArray.push({
        name: tag || category,
        images,
        color: colors[colorIndex % colors.length],
      });
      colorIndex++;
    });
    
    // Sort by size
    return clusterArray.sort((a, b) => b.images.length - a.images.length);
  }, [filteredImages]);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full overflow-auto p-8"
    >
      <div className="flex flex-wrap gap-8 justify-center">
        {clusters.map((cluster, clusterIndex) => (
          <motion.div
            key={cluster.name}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: clusterIndex * 0.1 }}
            className="relative"
          >
            {/* Cluster background */}
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
              
              {/* Cluster images */}
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(cluster.images.length, 4)}, 1fr)`,
                  maxWidth: Math.min(cluster.images.length, 4) * 80,
                }}
              >
                {cluster.images.map((image, imageIndex) => {
                  const isHovered = hoveredImage?.id === image.id;
                  
                  return (
                    <motion.div
                      key={image.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ 
                        opacity: 1, 
                        y: 0,
                        scale: isHovered ? 1.1 : 1,
                        zIndex: isHovered ? 10 : 1,
                      }}
                      transition={{ delay: clusterIndex * 0.1 + imageIndex * 0.03 }}
                      className="relative cursor-pointer"
                      onMouseEnter={() => setHoveredImage(image)}
                      onMouseLeave={() => setHoveredImage(null)}
                      onClick={() => openModal(image)}
                    >
                      <div
                        className="w-16 h-16 rounded-lg overflow-hidden ring-2 transition-all"
                        style={{
                          ringColor: isHovered ? cluster.color : 'transparent',
                          boxShadow: isHovered ? `0 0 20px ${cluster.color}40` : 'none',
                        }}
                      >
                        <img
                          src={image.urls.small}
                          alt={image.main_subject}
                          className="w-full h-full object-cover"
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
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.values(image.tags).flat().slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: `${cluster.color}30`,
                                  color: cluster.color,
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
              
              {/* Connection indicator */}
              <div className="mt-4 pt-3 border-t border-nebula-800/50">
                <div className="flex flex-wrap gap-1">
                  {Array.from(
                    new Set(cluster.images.flatMap((img) => 
                      Object.values(img.tags).flat()
                    ))
                  ).slice(0, 5).map((tag) => (
                    <span key={tag} className="tag-pill text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
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
