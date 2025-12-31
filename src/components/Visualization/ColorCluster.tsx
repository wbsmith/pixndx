import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { groupByColorFamily, analyzeColor, getDominantColor, getColorPalette } from '@/lib/similarity/vectors';
import type { ImageMetadata, ColorFamily } from '@/types/gallery';

interface ColorClusterProps {
  images?: ImageMetadata[];
  onImageClick?: (image: ImageMetadata) => void;
  layout?: 'radial' | 'grid' | 'treemap';
}

const COLOR_FAMILY_INFO: Record<ColorFamily, { label: string; color: string; angle: number }> = {
  red: { label: 'Red', color: '#EF4444', angle: 0 },
  orange: { label: 'Orange', color: '#F97316', angle: 30 },
  yellow: { label: 'Yellow', color: '#EAB308', angle: 60 },
  green: { label: 'Green', color: '#22C55E', angle: 120 },
  cyan: { label: 'Cyan', color: '#06B6D4', angle: 180 },
  blue: { label: 'Blue', color: '#3B82F6', angle: 210 },
  purple: { label: 'Purple', color: '#A855F7', angle: 270 },
  magenta: { label: 'Magenta', color: '#EC4899', angle: 300 },
  neutral: { label: 'Neutral', color: '#6B7280', angle: -1 }, // Center
};

export function ColorCluster({ 
  images: propImages,
  onImageClick,
  layout = 'radial',
}: ColorClusterProps) {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  const images = propImages || filteredImages;
  
  // Group images by color family
  const colorGroups = useMemo(() => {
    return groupByColorFamily(images);
  }, [images]);
  
  // Convert to array with metadata
  const clusters = useMemo(() => {
    const result: Array<{
      family: ColorFamily;
      info: typeof COLOR_FAMILY_INFO[ColorFamily];
      images: ImageMetadata[];
    }> = [];
    
    colorGroups.forEach((imgs, family) => {
      result.push({
        family,
        info: COLOR_FAMILY_INFO[family],
        images: imgs,
      });
    });
    
    // Sort by angle for radial layout
    return result.sort((a, b) => a.info.angle - b.info.angle);
  }, [colorGroups]);
  
  const handleImageClick = (image: ImageMetadata) => {
    if (onImageClick) {
      onImageClick(image);
    } else {
      openModal(image);
    }
  };
  
  if (layout === 'grid') {
    return <GridColorCluster clusters={clusters} onImageClick={handleImageClick} />;
  }
  
  if (layout === 'treemap') {
    return <TreemapColorCluster clusters={clusters} onImageClick={handleImageClick} />;
  }
  
  // Default: Radial layout
  return (
    <RadialColorCluster 
      clusters={clusters} 
      onImageClick={handleImageClick}
      hoveredImage={hoveredImage}
      setHoveredImage={setHoveredImage}
    />
  );
}

// Radial layout component
interface RadialColorClusterProps {
  clusters: Array<{
    family: ColorFamily;
    info: typeof COLOR_FAMILY_INFO[ColorFamily];
    images: ImageMetadata[];
  }>;
  onImageClick: (image: ImageMetadata) => void;
  hoveredImage: ImageMetadata | null;
  setHoveredImage: (image: ImageMetadata | null) => void;
}

function RadialColorCluster({ 
  clusters, 
  onImageClick,
  hoveredImage,
  setHoveredImage,
}: RadialColorClusterProps) {
  const centerX = 400;
  const centerY = 350;
  const clusterRadius = 180;
  const imageRadius = 24;
  
  return (
    <div className="relative w-full h-full min-h-[700px]" style={{ width: 800 }}>
      {/* Center label */}
      <div
        className="absolute text-center z-10"
        style={{ left: centerX - 40, top: centerY - 20, width: 80 }}
      >
        <div className="text-xs text-nebula-400 uppercase">Color</div>
        <div className="text-lg font-display text-white">Clusters</div>
      </div>
      
      {/* Cluster segments */}
      {clusters.map((cluster, clusterIndex) => {
        if (cluster.info.angle < 0) return null; // Skip neutral for radial
        
        const angleRad = (cluster.info.angle - 90) * (Math.PI / 180);
        const clusterCenterX = centerX + Math.cos(angleRad) * clusterRadius;
        const clusterCenterY = centerY + Math.sin(angleRad) * clusterRadius;
        
        return (
          <motion.div
            key={cluster.family}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: clusterIndex * 0.05 }}
            className="absolute"
            style={{
              left: clusterCenterX - 60,
              top: clusterCenterY - 60,
              width: 120,
            }}
          >
            {/* Cluster background glow */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                backgroundColor: cluster.info.color,
                filter: 'blur(30px)',
                opacity: 0.2,
                transform: 'scale(1.5)',
              }}
            />
            
            {/* Cluster label */}
            <div className="text-center mb-2">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ 
                  backgroundColor: `${cluster.info.color}30`,
                  color: cluster.info.color,
                }}
              >
                {cluster.info.label} ({cluster.images.length})
              </span>
            </div>
            
            {/* Images in cluster */}
            <div className="flex flex-wrap justify-center gap-1">
              {cluster.images.slice(0, 6).map((image, imgIndex) => {
                const isHovered = hoveredImage?.id === image.id;
                const dominantColor = getDominantColor(image);
                
                return (
                  <motion.div
                    key={image.id}
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: 1, 
                      scale: isHovered ? 1.2 : 1,
                      zIndex: isHovered ? 10 : 1,
                    }}
                    transition={{ delay: clusterIndex * 0.05 + imgIndex * 0.02 }}
                    className="relative cursor-pointer"
                    onMouseEnter={() => setHoveredImage(image)}
                    onMouseLeave={() => setHoveredImage(null)}
                    onClick={() => onImageClick(image)}
                  >
                    <div
                      className="rounded-full overflow-hidden ring-2"
                      style={{
                        width: imageRadius * 2,
                        height: imageRadius * 2,
                        ringColor: dominantColor,
                      }}
                    >
                      <img
                        src={image.urls.small}
                        alt={image.main_subject}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </motion.div>
                );
              })}
              
              {cluster.images.length > 6 && (
                <div
                  className="rounded-full bg-nebula-800/50 flex items-center justify-center text-xs text-nebula-400"
                  style={{ width: imageRadius * 2, height: imageRadius * 2 }}
                >
                  +{cluster.images.length - 6}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
      
      {/* Neutral cluster in center */}
      {clusters.find((c) => c.family === 'neutral') && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute"
          style={{
            left: centerX - 50,
            top: centerY + 50,
            width: 100,
          }}
        >
          <div className="text-center text-[10px] text-nebula-500 mb-1">
            Neutral ({clusters.find((c) => c.family === 'neutral')?.images.length})
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            {clusters
              .find((c) => c.family === 'neutral')
              ?.images.slice(0, 4)
              .map((image) => (
                <div
                  key={image.id}
                  className="w-8 h-8 rounded-full overflow-hidden ring-1 ring-nebula-600 cursor-pointer hover:ring-nebula-400"
                  onClick={() => onImageClick(image)}
                >
                  <img
                    src={image.urls.small}
                    alt={image.main_subject}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
          </div>
        </motion.div>
      )}
      
      {/* Connection lines to center */}
      <svg className="absolute inset-0 pointer-events-none">
        {clusters.map((cluster) => {
          if (cluster.info.angle < 0) return null;
          
          const angleRad = (cluster.info.angle - 90) * (Math.PI / 180);
          const endX = centerX + Math.cos(angleRad) * (clusterRadius - 60);
          const endY = centerY + Math.sin(angleRad) * (clusterRadius - 60);
          
          return (
            <line
              key={cluster.family}
              x1={centerX}
              y1={centerY}
              x2={endX}
              y2={endY}
              stroke={cluster.info.color}
              strokeWidth={1}
              strokeOpacity={0.2}
              strokeDasharray="4 4"
            />
          );
        })}
      </svg>
    </div>
  );
}

// Grid layout component
interface GridColorClusterProps {
  clusters: Array<{
    family: ColorFamily;
    info: typeof COLOR_FAMILY_INFO[ColorFamily];
    images: ImageMetadata[];
  }>;
  onImageClick: (image: ImageMetadata) => void;
}

function GridColorCluster({ clusters, onImageClick }: GridColorClusterProps) {
  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      {clusters.map((cluster) => (
        <div
          key={cluster.family}
          className="glass rounded-xl p-4"
          style={{ borderColor: `${cluster.info.color}40`, borderWidth: 1 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: cluster.info.color }}
            />
            <span className="text-sm font-medium text-white">
              {cluster.info.label}
            </span>
            <span className="text-xs text-nebula-400">
              ({cluster.images.length})
            </span>
          </div>
          
          <div className="grid grid-cols-4 gap-1">
            {cluster.images.slice(0, 8).map((image) => (
              <div
                key={image.id}
                className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:ring-2 transition-all"
                style={{ ringColor: cluster.info.color }}
                onClick={() => onImageClick(image)}
              >
                <img
                  src={image.urls.small}
                  alt={image.main_subject}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Treemap layout component
function TreemapColorCluster({ clusters, onImageClick }: GridColorClusterProps) {
  // Calculate sizes based on image count
  const totalImages = clusters.reduce((sum, c) => sum + c.images.length, 0);
  
  return (
    <div className="flex flex-wrap gap-2 p-4 h-full">
      {clusters
        .sort((a, b) => b.images.length - a.images.length)
        .map((cluster) => {
          const sizePercent = (cluster.images.length / totalImages) * 100;
          const minSize = 150;
          const size = Math.max(minSize, sizePercent * 4);
          
          return (
            <motion.div
              key={cluster.family}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl overflow-hidden"
              style={{
                width: size,
                height: size,
                backgroundColor: `${cluster.info.color}20`,
                border: `2px solid ${cluster.info.color}40`,
              }}
            >
              <div className="p-2 h-full flex flex-col">
                <div className="text-xs font-medium mb-1" style={{ color: cluster.info.color }}>
                  {cluster.info.label} ({cluster.images.length})
                </div>
                
                <div className="flex-1 grid grid-cols-3 gap-1 overflow-hidden">
                  {cluster.images.slice(0, 9).map((image) => (
                    <div
                      key={image.id}
                      className="rounded overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => onImageClick(image)}
                    >
                      <img
                        src={image.urls.small}
                        alt={image.main_subject}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          );
        })}
    </div>
  );
}

// Color distribution chart
export function ColorDistributionChart({ images }: { images: ImageMetadata[] }) {
  const colorGroups = useMemo(() => groupByColorFamily(images), [images]);
  const totalImages = images.length;
  
  const data = useMemo(() => {
    const result: Array<{ family: ColorFamily; count: number; percent: number }> = [];
    
    colorGroups.forEach((imgs, family) => {
      result.push({
        family,
        count: imgs.length,
        percent: (imgs.length / totalImages) * 100,
      });
    });
    
    return result.sort((a, b) => b.count - a.count);
  }, [colorGroups, totalImages]);
  
  return (
    <div className="glass rounded-lg p-4">
      <div className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
        Color Distribution
      </div>
      
      <div className="space-y-2">
        {data.map(({ family, count, percent }) => (
          <div key={family} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: COLOR_FAMILY_INFO[family].color }}
            />
            <span className="text-xs text-nebula-300 w-16">
              {COLOR_FAMILY_INFO[family].label}
            </span>
            <div className="flex-1 h-2 bg-nebula-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="h-full rounded-full"
                style={{ backgroundColor: COLOR_FAMILY_INFO[family].color }}
              />
            </div>
            <span className="text-[10px] text-nebula-500 w-8 text-right">
              {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
