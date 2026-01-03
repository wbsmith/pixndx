import { memo, useState } from 'react';
import { motion } from 'framer-motion';
import type { ImageMetadata } from '@/types/gallery';
import { useGalleryStore } from '@/stores/galleryStore';
import { getColorPalette } from '@/lib/similarity/vectors';
import { ImageCurationOverlay } from '@/components/Admin/ImageCurationOverlay';

interface ImageCardProps {
  image: ImageMetadata;
  index?: number;
  showInfo?: boolean;
}

export const ImageCard = memo(function ImageCard({ 
  image, 
  index = 0, 
  showInfo = true 
}: ImageCardProps) {
  const { openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const isHovered = hoveredImage?.id === image.id;
  const palette = getColorPalette(image);
  const primaryTags = Object.values(image.tags).flat().slice(0, 3);
  
  // Only stagger animation for first batch (avoids CPU overhead on scroll)
  const shouldAnimate = index < 50;
  
  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { delay: Math.min(index * 0.02, 0.5), duration: 0.3 } : { duration: 0.2 }}
      className="image-card group"
      onMouseEnter={() => setHoveredImage(image)}
      onMouseLeave={() => setHoveredImage(null)}
      onClick={() => openModal(image)}
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-cosmos-deep">
        {/* Placeholder while loading */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-nebula-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        
        <img
          src={image.urls.small}
          alt={image.main_subject}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
        />
        
        {/* Admin mode curation overlay */}
        <ImageCurationOverlay image={image} />
        
        {/* Color palette indicator */}
        <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {palette.slice(0, 3).map((color, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        
        {/* Info overlay */}
        {showInfo && (
          <div className="absolute bottom-0 left-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <h3 className="text-sm font-medium text-white mb-1 line-clamp-1">
              {image.main_subject}
            </h3>
            <div className="flex flex-wrap gap-1">
              {primaryTags.map((tag) => (
                <span key={tag} className="tag-pill tag-pill-primary text-[10px]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Glow effect on hover */}
      <motion.div
        className="absolute inset-0 rounded-lg pointer-events-none"
        initial={false}
        animate={{
          boxShadow: isHovered
            ? `0 0 30px ${palette[0] || '#6370f2'}40`
            : '0 0 0px transparent',
        }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
});
