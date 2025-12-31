import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { ImageCard } from '../Gallery/ImageCard';
import { Loader2 } from 'lucide-react';

const IMAGES_PER_PAGE = 50;

export function GridLayout() {
  const { filteredImages } = useGalleryStore();
  const [displayCount, setDisplayCount] = useState(IMAGES_PER_PAGE);
  const [isLoading, setIsLoading] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Reset display count when filtered images change (new search)
  useEffect(() => {
    setDisplayCount(IMAGES_PER_PAGE);
  }, [filteredImages]);
  
  // Intersection Observer for infinite scroll
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry.isIntersecting && displayCount < filteredImages.length && !isLoading) {
      setIsLoading(true);
      // Small delay to prevent jarring load
      setTimeout(() => {
        setDisplayCount(prev => Math.min(prev + IMAGES_PER_PAGE, filteredImages.length));
        setIsLoading(false);
      }, 150);
    }
  }, [displayCount, filteredImages.length, isLoading]);
  
  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, {
      root: containerRef.current,
      rootMargin: '200px', // Load more before reaching the bottom
      threshold: 0,
    });
    
    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }
    
    return () => observer.disconnect();
  }, [handleObserver]);
  
  const visibleImages = filteredImages.slice(0, displayCount);
  const hasMore = displayCount < filteredImages.length;
  
  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full overflow-auto p-6"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {visibleImages.map((image, index) => (
          <ImageCard key={image.id} image={image} index={index} />
        ))}
      </div>
      
      {/* Loading trigger / indicator */}
      {hasMore && (
        <div 
          ref={loaderRef} 
          className="flex items-center justify-center py-8 text-nebula-400"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          ) : (
            <span className="text-sm">
              Showing {displayCount} of {filteredImages.length} images
            </span>
          )}
        </div>
      )}
      
      {filteredImages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-nebula-400">
          <p className="text-lg">No images found</p>
          <p className="text-sm mt-2">Try adjusting your search</p>
        </div>
      )}
      
      {!hasMore && filteredImages.length > 0 && (
        <div className="text-center py-6 text-nebula-500 text-sm">
          Showing all {filteredImages.length} images
        </div>
      )}
    </motion.div>
  );
}
