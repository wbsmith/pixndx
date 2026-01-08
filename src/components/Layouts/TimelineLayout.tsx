import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { ImageMetadata } from '@/types/gallery';

interface TimelineGroup {
  key: string;
  label: string;
  sublabel?: string;
  images: ImageMetadata[];
  startDate: Date;
}

type GroupBy = 'day' | 'week' | 'month' | 'year';

export function TimelineLayout() {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [_scrollPosition, _setScrollPosition] = useState(0);
  
  // Parse date from EXIF or filename
  const parseImageDate = (img: ImageMetadata): Date | null => {
    // Try EXIF DateTimeOriginal
    if (img.exif?.DateTimeOriginal) {
      const exifDate = img.exif.DateTimeOriginal;
      // EXIF format: "YYYY:MM:DD HH:MM:SS"
      const isoDate = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const date = new Date(isoDate);
      if (!isNaN(date.getTime())) return date;
    }
    
    // Try FileModifyDate
    if (img.exif?.FileModifyDate) {
      const date = new Date(img.exif.FileModifyDate);
      if (!isNaN(date.getTime())) return date;
    }
    
    return null;
  };
  
  // Group images by time period
  const timelineGroups = useMemo(() => {
    const groups = new Map<string, TimelineGroup>();
    
    // Sort images by date
    const sortedImages = [...filteredImages]
      .map((img) => ({ img, date: parseImageDate(img) }))
      .filter((item) => item.date !== null)
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    
    sortedImages.forEach(({ img, date }) => {
      if (!date) return;
      
      let key: string;
      let label: string;
      let sublabel: string | undefined;
      
      switch (groupBy) {
        case 'day':
          key = date.toISOString().split('T')[0];
          label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          sublabel = date.getFullYear().toString();
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          label = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          sublabel = weekStart.getFullYear().toString();
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          label = date.toLocaleDateString('en-US', { month: 'long' });
          sublabel = date.getFullYear().toString();
          break;
        case 'year':
          key = date.getFullYear().toString();
          label = date.getFullYear().toString();
          break;
      }
      
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          sublabel,
          images: [],
          startDate: date,
        });
      }
      groups.get(key)!.images.push(img);
    });
    
    return Array.from(groups.values());
  }, [filteredImages, groupBy]);
  
  // Images without dates
  const undatedImages = useMemo(() => {
    return filteredImages.filter((img) => parseImageDate(img) === null);
  }, [filteredImages]);
  
  const scrollTimeline = (direction: 'left' | 'right') => {
    const container = document.getElementById('timeline-container');
    if (container) {
      const scrollAmount = direction === 'left' ? -400 : 400;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
      setScrollPosition(container.scrollLeft + scrollAmount);
    }
  };
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full flex flex-col"
    >
      {/* Header controls */}
      <div className="flex items-center justify-between p-4 border-b border-nebula-800">
        <div className="flex items-center gap-3">
          <Calendar size={20} className="text-stellar-cyan" />
          <h2 className="font-display font-bold text-white">Timeline</h2>
          <span className="text-sm text-nebula-400">
            {filteredImages.length} images
          </span>
        </div>
        
        {/* Group by selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-nebula-400">Group by:</span>
          <div className="flex bg-nebula-800/50 rounded-lg p-1">
            {(['day', 'week', 'month', 'year'] as GroupBy[]).map((option) => (
              <button
                key={option}
                onClick={() => setGroupBy(option)}
                className={`
                  px-3 py-1 rounded text-xs transition-all capitalize
                  ${groupBy === option
                    ? 'bg-stellar-cyan text-cosmos-void'
                    : 'text-nebula-300 hover:text-white'
                  }
                `}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Timeline */}
      <div className="flex-1 relative">
        {/* Navigation arrows */}
        <button
          onClick={() => scrollTimeline('left')}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 glass rounded-full hover:bg-nebula-700 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <button
          onClick={() => scrollTimeline('right')}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 glass rounded-full hover:bg-nebula-700 transition-colors"
        >
          <ChevronRight size={24} />
        </button>
        
        {/* Timeline container */}
        <div
          id="timeline-container"
          className="h-full overflow-x-auto overflow-y-hidden px-16 py-8 scrollbar-thin"
        >
          <div className="flex gap-8 h-full">
            {/* Timeline line */}
            <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-nebula-600 to-transparent" />
            
            {timelineGroups.map((group, groupIndex) => (
              <motion.div
                key={group.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.05 }}
                className="flex-shrink-0 flex flex-col items-center"
              >
                {/* Date label */}
                <div className="mb-4 text-center">
                  <div className="text-lg font-display text-white">{group.label}</div>
                  {group.sublabel && (
                    <div className="text-xs text-nebula-400">{group.sublabel}</div>
                  )}
                </div>
                
                {/* Timeline node */}
                <div className="w-4 h-4 rounded-full bg-stellar-cyan mb-4 relative">
                  <div className="absolute inset-0 rounded-full bg-stellar-cyan animate-ping opacity-20" />
                </div>
                
                {/* Images */}
                <div className="flex gap-2 flex-wrap justify-center max-w-[300px]">
                  {group.images.slice(0, 6).map((image, imgIndex) => {
                    const isHovered = hoveredImage?.id === image.id;
                    
                    return (
                      <motion.div
                        key={image.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ 
                          opacity: 1, 
                          scale: isHovered ? 1.1 : 1,
                          zIndex: isHovered ? 10 : 1,
                        }}
                        transition={{ delay: groupIndex * 0.05 + imgIndex * 0.02 }}
                        className="relative cursor-pointer"
                        onMouseEnter={() => setHoveredImage(image)}
                        onMouseLeave={() => setHoveredImage(null)}
                        onClick={() => openModal(image)}
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden ring-2 ring-nebula-700 hover:ring-stellar-cyan transition-all">
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
                          >
                            <div className="text-xs text-white">{image.main_subject}</div>
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                  
                  {/* Show more indicator */}
                  {group.images.length > 6 && (
                    <div className="w-16 h-16 rounded-lg bg-nebula-800/50 flex items-center justify-center">
                      <span className="text-sm text-nebula-400">
                        +{group.images.length - 6}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Image count */}
                <div className="mt-2 text-[10px] text-nebula-500">
                  {group.images.length} {group.images.length === 1 ? 'image' : 'images'}
                </div>
              </motion.div>
            ))}
            
            {/* Undated images */}
            {undatedImages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-shrink-0 flex flex-col items-center opacity-60"
              >
                <div className="mb-4 text-center">
                  <div className="text-lg font-display text-nebula-400">Undated</div>
                </div>
                
                <div className="w-4 h-4 rounded-full bg-nebula-600 mb-4" />
                
                <div className="flex gap-2 flex-wrap justify-center max-w-[300px]">
                  {undatedImages.slice(0, 6).map((image) => (
                    <div
                      key={image.id}
                      className="w-16 h-16 rounded-lg overflow-hidden ring-2 ring-nebula-800 cursor-pointer hover:ring-nebula-600 transition-all"
                      onClick={() => openModal(image)}
                    >
                      <img
                        src={image.urls.small}
                        alt={image.main_subject}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                  
                  {undatedImages.length > 6 && (
                    <div className="w-16 h-16 rounded-lg bg-nebula-800/50 flex items-center justify-center">
                      <span className="text-sm text-nebula-500">
                        +{undatedImages.length - 6}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="mt-2 text-[10px] text-nebula-600">
                  {undatedImages.length} {undatedImages.length === 1 ? 'image' : 'images'}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
      
      {/* Empty state */}
      {timelineGroups.length === 0 && undatedImages.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-nebula-400">
            <Calendar size={48} className="mx-auto mb-4 opacity-50" />
            <p>No images with date information</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
