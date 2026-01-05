import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Camera, Aperture, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';

export function ImageModal() {
  const { 
    modalOpen, 
    closeModal, 
    selectedImage, 
    filteredImages,
    setSelectedImage 
  } = useGalleryStore();
  
  // Zoom/pan state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mouseNearEdge, setMouseNearEdge] = useState<'left' | 'right' | null>(null);
  
  // Image dimensions for 1:1 zoom calculation
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Calculate max zoom for 1:1 pixels
  const maxZoom = useCallback(() => {
    if (!imageDimensions.width || !containerDimensions.width) return 4;
    
    // Calculate the fitted scale (how much the image is scaled down to fit)
    const widthRatio = containerDimensions.width / imageDimensions.width;
    const heightRatio = containerDimensions.height / imageDimensions.height;
    const fittedScale = Math.min(widthRatio, heightRatio);
    
    // Max zoom = 1:1 pixels = 1 / fittedScale
    // But cap it at a reasonable value to prevent excessive zoom on tiny images
    return Math.max(1, Math.min(1 / fittedScale, 10));
  }, [imageDimensions, containerDimensions]);
  
  // Update container dimensions
  useEffect(() => {
    const updateContainerDimensions = () => {
      if (imageContainerRef.current) {
        setContainerDimensions({
          width: imageContainerRef.current.clientWidth,
          height: imageContainerRef.current.clientHeight,
        });
      }
    };
    
    updateContainerDimensions();
    window.addEventListener('resize', updateContainerDimensions);
    return () => window.removeEventListener('resize', updateContainerDimensions);
  }, [isFullscreen, modalOpen]);
  
  // Load image dimensions when image changes
  useEffect(() => {
    if (!selectedImage) return;
    
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = selectedImage.urls.full;
  }, [selectedImage?.id]);
  
  // Reset all state when image changes or modal closes
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setIsFullscreen(false);
  }, [selectedImage?.id]);
  
  // Reset fullscreen when modal closes
  useEffect(() => {
    if (!modalOpen) {
      setIsFullscreen(false);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [modalOpen]);
  
  // Reset zoom when exiting fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isFullscreen]);
  
  // Handle mouse position for edge detection
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
      return;
    }
    
    // Detect if mouse is near left or right edge
    const container = imageContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const edgeThreshold = 80;
      
      if (x < edgeThreshold) {
        setMouseNearEdge('left');
      } else if (x > rect.width - edgeThreshold) {
        setMouseNearEdge('right');
      } else {
        setMouseNearEdge(null);
      }
    }
  }, [isDragging, dragStart]);
  
  // Handle wheel zoom - using native event for passive: false support
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || !modalOpen) return;
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const max = maxZoom();
      setScale(prev => {
        const newScale = Math.min(Math.max(prev * delta, 1), max);
        // Reset position if zooming back to 1
        if (newScale <= 1) {
          setPosition({ x: 0, y: 0 });
        }
        return newScale;
      });
    };
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [modalOpen, maxZoom]);
  
  // Handle double-click to toggle zoom
  const handleDoubleClick = useCallback(() => {
    if (scale === 1) {
      // Zoom to 2x or max, whichever is smaller
      setScale(Math.min(2, maxZoom()));
    } else {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [scale, maxZoom]);
  
  // Handle drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [scale, position]);
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modalOpen || !selectedImage) return;
      
      const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
      const max = maxZoom();
      
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (scale > 1) {
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          closeModal();
        }
      } else if (e.key === 'ArrowRight' && currentIndex < filteredImages.length - 1) {
        setSelectedImage(filteredImages[currentIndex + 1]);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setSelectedImage(filteredImages[currentIndex - 1]);
      } else if (e.key === 'f' || e.key === 'F') {
        setIsFullscreen(prev => !prev);
      } else if (e.key === '+' || e.key === '=') {
        setScale(prev => Math.min(prev * 1.5, max));
      } else if (e.key === '-') {
        setScale(prev => {
          const newScale = Math.max(prev / 1.5, 1);
          if (newScale === 1) setPosition({ x: 0, y: 0 });
          return newScale;
        });
      } else if (e.key === '0') {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else if (e.key === '1') {
        // 1:1 zoom
        setScale(max);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, selectedImage, filteredImages, closeModal, setSelectedImage, isFullscreen, scale, maxZoom]);
  
  if (!selectedImage) return null;
  
  const currentIndex = filteredImages.findIndex(img => img.id === selectedImage.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < filteredImages.length - 1;
  
  const goToPrev = () => {
    if (hasPrev) {
      setSelectedImage(filteredImages[currentIndex - 1]);
    }
  };
  
  const goToNext = () => {
    if (hasNext) {
      setSelectedImage(filteredImages[currentIndex + 1]);
    }
  };
  
  const max = maxZoom();
  const handleZoomIn = () => setScale(prev => Math.min(prev * 1.5, max));
  const handleZoomOut = () => {
    setScale(prev => {
      const newScale = Math.max(prev / 1.5, 1);
      if (newScale === 1) setPosition({ x: 0, y: 0 });
      return newScale;
    });
  };
  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };
  
  // Format zoom display
  const zoomDisplay = () => {
    if (scale === 1) return 'Fit';
    if (Math.abs(scale - max) < 0.01) return '1:1';
    return `${Math.round(scale * 100)}%`;
  };
  
  // Get tag categories for display
  const tagCategories = Object.entries(selectedImage.tags);
  
  // Determine if image is portrait
  const isPortrait = imageDimensions.height > imageDimensions.width;
  
  return (
    <AnimatePresence>
      {modalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-overlay flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25 }}
            className={`relative glass overflow-hidden ${
              isFullscreen 
                ? 'fixed inset-0 m-0 rounded-none max-w-none max-h-none' 
                : 'max-w-6xl w-full max-h-[90vh] rounded-2xl'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Top controls bar */}
            <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-3 bg-gradient-to-b from-black/70 to-transparent">
              {/* Left: Image counter */}
              <div className="text-sm text-white/90 bg-black/40 px-2 py-1 rounded">
                {currentIndex + 1} / {filteredImages.length}
              </div>
              
              {/* Center: Zoom controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handleZoomOut}
                  disabled={scale <= 1}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors text-white disabled:opacity-40"
                  title="Zoom out (-)"
                >
                  <ZoomOut size={18} />
                </button>
                
                <span className="text-xs text-white/80 w-14 text-center font-mono">
                  {zoomDisplay()}
                </span>
                
                <button
                  onClick={handleZoomIn}
                  disabled={scale >= max}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors text-white disabled:opacity-40"
                  title="Zoom in (+)"
                >
                  <ZoomIn size={18} />
                </button>
                
                <button
                  onClick={() => setScale(max)}
                  disabled={scale >= max}
                  className="px-2 py-1 rounded bg-black/50 hover:bg-black/70 transition-colors text-white text-xs disabled:opacity-40"
                  title="View at 1:1 (1)"
                >
                  1:1
                </button>
                
                {scale > 1 && (
                  <button
                    onClick={handleResetZoom}
                    className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors text-white ml-1"
                    title="Reset zoom (0)"
                  >
                    <RotateCcw size={18} />
                  </button>
                )}
              </div>
              
              {/* Right: Fullscreen and Close */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsFullscreen(prev => !prev)}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors text-white"
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors text-white"
                  title="Close (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            
            <div className={`flex ${isFullscreen ? 'h-full' : 'h-full max-h-[90vh] flex-col lg:flex-row'}`}>
              {/* Image container */}
              <div 
                ref={imageContainerRef}
                className={`relative bg-black overflow-hidden ${isFullscreen ? 'flex-1' : 'flex-1 min-h-0 lg:max-h-[90vh]'}`}
                style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { handleMouseUp(); setMouseNearEdge(null); }}
                onDoubleClick={handleDoubleClick}
              >
                <div 
                  className="w-full h-full flex items-center justify-center p-4"
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                  }}
                >
                  <img
                    ref={imageRef}
                    src={selectedImage.urls.full}
                    alt={selectedImage.main_subject}
                    className="object-contain select-none"
                    style={{
                      // Constrain both width and height to fit container
                      maxWidth: '100%',
                      maxHeight: isFullscreen ? 'calc(100vh - 80px)' : isPortrait ? '65vh' : '100%',
                      width: 'auto',
                      height: 'auto',
                    }}
                    draggable={false}
                  />
                </div>
                
                {/* Navigation buttons - positioned inside image area, show on hover near edges */}
                <AnimatePresence>
                  {hasPrev && mouseNearEdge === 'left' && (
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 hover:bg-black/80 transition-all text-white hover:scale-110"
                    >
                      <ChevronLeft size={28} />
                    </motion.button>
                  )}
                </AnimatePresence>
                
                <AnimatePresence>
                  {hasNext && mouseNearEdge === 'right' && (
                    <motion.button
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      onClick={(e) => { e.stopPropagation(); goToNext(); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/60 hover:bg-black/80 transition-all text-white hover:scale-110"
                    >
                      <ChevronRight size={28} />
                    </motion.button>
                  )}
                </AnimatePresence>
                
                {/* Zoom hint at bottom */}
                {scale === 1 && !isFullscreen && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/60 bg-black/40 px-3 py-1 rounded-full pointer-events-none">
                    Scroll to zoom • Double-click for 2× • Press 1 for 1:1
                  </div>
                )}
                {scale > 1 && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/60 bg-black/40 px-3 py-1 rounded-full pointer-events-none">
                    Drag to pan • Double-click or 0 to reset
                  </div>
                )}
              </div>
              
              {/* Info panel - hide in fullscreen */}
              {!isFullscreen && (
                <div className={`w-full lg:w-96 p-6 overflow-y-auto max-h-[50vh] lg:max-h-[90vh] ${isPortrait ? 'lg:w-80' : ''}`}>
                  <h2 className="text-xl font-display font-bold text-white mb-2">
                    {selectedImage.main_subject}
                  </h2>
                  
                  <p className="text-sm text-nebula-300 mb-4 leading-relaxed">
                    {selectedImage.description}
                  </p>
                  
                  {/* Mood */}
                  <div className="mb-4">
                    <h4 className="text-xs text-nebula-400 uppercase tracking-wider mb-2">Mood</h4>
                    <p className="text-sm text-stellar-cyan italic">
                      {selectedImage.mood}
                    </p>
                  </div>
                  
                  {/* Tags by category */}
                  <div className="mb-4">
                    <h4 className="text-xs text-nebula-400 uppercase tracking-wider mb-2">Tags</h4>
                    <div className="space-y-2">
                      {tagCategories.map(([category, tags]) => (
                        <div key={category}>
                          <span className="text-[10px] text-nebula-500 uppercase">{category.replace(/_/g, ' ')}:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(tags as string[]).map((tag: string) => (
                              <span key={tag} className="tag-pill text-[10px]">{tag.toUpperCase()}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Colors */}
                  <div className="mb-4">
                    <h4 className="text-xs text-nebula-400 uppercase tracking-wider mb-2">Color Palette</h4>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(selectedImage.main_colors).map(([name, color]) => (
                        <div key={name} className="flex items-center gap-1">
                          <div
                            className="w-5 h-5 rounded ring-1 ring-white/20"
                            style={{ backgroundColor: color }}
                            title={`${name}: ${color}`}
                          />
                          <span className="text-[10px] text-nebula-400">{name.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* File info */}
                  <div className="mb-4 pt-4 border-t border-nebula-800">
                    <h4 className="text-xs text-nebula-400 uppercase tracking-wider mb-2">File</h4>
                    <div className="text-xs text-nebula-300 font-mono break-all">
                      {selectedImage.filename}
                    </div>
                    {imageDimensions.width > 0 && (
                      <div className="text-xs text-nebula-500 mt-1">
                        {imageDimensions.width} × {imageDimensions.height} px
                      </div>
                    )}
                  </div>
                  
                  {/* EXIF */}
                  {selectedImage.exif && (
                    <div className="mb-4 pt-4 border-t border-nebula-800">
                      <h4 className="text-xs text-nebula-400 uppercase tracking-wider mb-2">Camera Info</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {selectedImage.exif.Model && (
                          <div className="flex items-center gap-2 text-nebula-300">
                            <Camera size={12} />
                            <span>{selectedImage.exif.Model}</span>
                          </div>
                        )}
                        {selectedImage.exif.FNumber && (
                          <div className="flex items-center gap-2 text-nebula-300">
                            <Aperture size={12} />
                            <span>f/{selectedImage.exif.FNumber}</span>
                          </div>
                        )}
                        {selectedImage.exif.ISO && (
                          <div className="text-nebula-300">
                            ISO {selectedImage.exif.ISO}
                          </div>
                        )}
                        {selectedImage.exif.FocalLength && (
                          <div className="text-nebula-300">
                            Focal {selectedImage.exif.FocalLength}
                          </div>
                        )}
                        {selectedImage.exif.ExposureTime && (
                          <div className="text-nebula-300">
                            {selectedImage.exif.ExposureTime}s
                          </div>
                        )}
                        {selectedImage.exif.DateTimeOriginal && (
                          <div className="text-nebula-300 col-span-2">
                            {selectedImage.exif.DateTimeOriginal}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
