import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { analyzeColor, getDominantColor, getColorPalette } from '@/lib/similarity/vectors';
import { ThumbnailImage } from '@/components/Gallery/ThumbnailImage';
import type {} from '@/types/gallery';

export function ColorWheel() {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  
  // Arrange images in a radial layout based on dominant color hue
  const arrangedImages = useMemo(() => {
    return filteredImages.map((img) => {
      const dominantColor = getDominantColor(img);
      const analysis = analyzeColor(dominantColor);
      return {
        image: img,
        hue: analysis.hue,
        saturation: analysis.saturation,
        lightness: analysis.lightness,
        dominantColor,
      };
    }).sort((a, b) => a.hue - b.hue);
  }, [filteredImages]);
  
  const centerX = 400;
  const centerY = 350;
  const baseRadius = 200;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full overflow-auto flex items-center justify-center p-8"
    >
      <div className="relative" style={{ width: 800, height: 700 }}>
        {/* Background color wheel */}
        <svg
          width="800"
          height="700"
          className="absolute inset-0"
          style={{ opacity: 0.1 }}
        >
          <defs>
            <linearGradient id="colorWheel">
              {Array.from({ length: 12 }).map((_, i) => (
                <stop
                  key={i}
                  offset={`${(i / 12) * 100}%`}
                  stopColor={`hsl(${i * 30}, 70%, 50%)`}
                />
              ))}
            </linearGradient>
          </defs>
          <circle
            cx={centerX}
            cy={centerY}
            r={baseRadius + 100}
            fill="none"
            stroke="url(#colorWheel)"
            strokeWidth="40"
            opacity="0.3"
          />
        </svg>
        
        {/* Center label */}
        <div
          className="absolute text-center"
          style={{
            left: centerX - 60,
            top: centerY - 30,
            width: 120,
          }}
        >
          <div className="text-xs text-nebula-400 uppercase tracking-wider">Arranged by</div>
          <div className="text-lg font-display text-stellar-cyan">Color</div>
        </div>
        
        {/* Images arranged radially */}
        {arrangedImages.map(({ image, hue, saturation, dominantColor }, index) => {
          const angle = hue * 2 * Math.PI - Math.PI / 2; // Start from top
          const radiusVariation = saturation * 80; // More saturated = further out
          const radius = baseRadius + radiusVariation;
          
          const x = centerX + Math.cos(angle) * radius - 32;
          const y = centerY + Math.sin(angle) * radius - 32;
          
          const isHovered = hoveredImage?.id === image.id;
          const palette = getColorPalette(image);
          
          return (
            <motion.div
              key={image.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ 
                opacity: 1, 
                scale: isHovered ? 1.2 : 1,
                zIndex: isHovered ? 10 : 1,
              }}
              transition={{ delay: index * 0.03, type: 'spring', damping: 15 }}
              className="absolute cursor-pointer"
              style={{ left: x, top: y }}
              onMouseEnter={() => setHoveredImage(image)}
              onMouseLeave={() => setHoveredImage(null)}
              onClick={() => openModal(image)}
            >
              <div className="relative">
                {/* Glow */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    backgroundColor: dominantColor,
                    filter: 'blur(12px)',
                    opacity: isHovered ? 0.6 : 0.3,
                    transform: 'scale(1.2)',
                  }}
                />
                
                {/* Image */}
                <div
                  className="relative w-16 h-16 rounded-full overflow-hidden ring-2"
                  style={{
                    ['--tw-ring-color' as string]: dominantColor,
                  }}
                >
                  <ThumbnailImage
                    src={image.urls.small}
                    alt={image.main_subject}
                    className="w-full h-full object-cover"
                  />
                </div>
                
                {/* Connection line to center */}
                <svg
                  className="absolute pointer-events-none"
                  style={{
                    left: 32,
                    top: 32,
                    width: Math.abs(centerX - x - 32) + 10,
                    height: Math.abs(centerY - y - 32) + 10,
                    overflow: 'visible',
                  }}
                >
                  <line
                    x1="0"
                    y1="0"
                    x2={centerX - x - 32}
                    y2={centerY - y - 32}
                    stroke={dominantColor}
                    strokeWidth="1"
                    opacity={isHovered ? 0.5 : 0.15}
                  />
                </svg>
              </div>
              
              {/* Tooltip */}
              {isHovered && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute left-1/2 -translate-x-1/2 top-full mt-2 glass rounded-lg p-2 whitespace-nowrap z-20"
                >
                  <div className="text-xs text-white">{image.main_subject}</div>
                  <div className="flex gap-1 mt-1">
                    {palette.slice(0, 4).map((c, i) => (
                      <div
                        key={i}
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          );
        })}
        
        {filteredImages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-nebula-400">
            <p>No images found</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
