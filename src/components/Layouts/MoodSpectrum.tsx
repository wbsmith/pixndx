import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { analyzeColor, getDominantColor } from '@/lib/similarity/vectors';
import { ThumbnailImage } from '@/components/Gallery/ThumbnailImage';
// Types imported from gallery store

// Map mood keywords to a spectrum value (0 = calm, 1 = energetic)
const moodToEnergy: Record<string, number> = {
  // Calm end
  'serene': 0.1,
  'peaceful': 0.15,
  'calm': 0.15,
  'tranquil': 0.1,
  'contemplative': 0.2,
  'patient': 0.2,
  'quiet': 0.15,
  
  // Medium-low
  'mysterious': 0.3,
  'ethereal': 0.35,
  'intimate': 0.3,
  'nostalgic': 0.35,
  'cozy': 0.3,
  'magical': 0.4,
  'romantic': 0.35,
  
  // Medium
  'natural': 0.5,
  'majestic': 0.5,
  'beautiful': 0.5,
  'graceful': 0.45,
  'enchanting': 0.55,
  'timeless': 0.5,
  
  // Medium-high
  'awe-inspiring': 0.65,
  'dramatic': 0.7,
  'powerful': 0.7,
  'vast': 0.6,
  'modern': 0.65,
  'urban': 0.7,
  
  // Energetic end
  'vibrant': 0.85,
  'energetic': 0.9,
  'dynamic': 0.85,
  'exciting': 0.9,
  'intense': 0.95,
};

function getMoodEnergy(mood: string): number {
  const moods = mood.toLowerCase().split(/[,\s]+/).filter(Boolean);
  let totalEnergy = 0;
  let count = 0;
  
  for (const m of moods) {
    const trimmed = m.trim();
    if (moodToEnergy[trimmed] !== undefined) {
      totalEnergy += moodToEnergy[trimmed];
      count++;
    }
  }
  
  return count > 0 ? totalEnergy / count : 0.5;
}

export function MoodSpectrum() {
  const { filteredImages, openModal, setHoveredImage, hoveredImage } = useGalleryStore();
  
  // Arrange images along a spectrum
  const arrangedImages = useMemo(() => {
    return filteredImages.map((img) => {
      // Compute warmth from dominant color
      const dominantColor = getDominantColor(img);
      const analysis = analyzeColor(dominantColor);
      return {
        image: img,
        energy: getMoodEnergy(img.mood),
        warmth: analysis.warmth,
        dominantColor,
      };
    }).sort((a, b) => a.energy - b.energy);
  }, [filteredImages]);
  
  const spectrumWidth = 900;
  const spectrumHeight = 400;
  
  // Group images by energy level to avoid overlap
  const lanes = useMemo(() => {
    const groups: Array<Array<typeof arrangedImages[0]>> = [[], [], []];
    arrangedImages.forEach((item, i) => {
      groups[i % 3].push(item);
    });
    return groups;
  }, [arrangedImages]);
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full overflow-auto flex flex-col items-center justify-center p-8"
    >
      <div className="relative" style={{ width: spectrumWidth, height: spectrumHeight + 100 }}>
        {/* Spectrum background */}
        <div
          className="absolute bottom-20 left-0 right-0 h-2 rounded-full"
          style={{
            background: 'linear-gradient(90deg, #1ABC9C 0%, #3498DB 25%, #9B59B6 50%, #E74C3C 75%, #F39C12 100%)',
            opacity: 0.4,
          }}
        />
        
        {/* Labels */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-between text-xs text-nebula-400">
          <span className="flex flex-col items-center">
            <span className="text-stellar-cyan">●</span>
            <span>Calm</span>
          </span>
          <span className="flex flex-col items-center">
            <span className="text-stellar-violet">●</span>
            <span>Balanced</span>
          </span>
          <span className="flex flex-col items-center">
            <span className="text-stellar-gold">●</span>
            <span>Energetic</span>
          </span>
        </div>
        
        {/* Images */}
        {lanes.map((lane, laneIndex) => (
          <div key={laneIndex} className="absolute left-0 right-0" style={{ top: laneIndex * 110 }}>
            {lane.map(({ image, energy, warmth, dominantColor }, index) => {
              const x = energy * (spectrumWidth - 80) + 20;
              const isHovered = hoveredImage?.id === image.id;
              
              // Color based on warmth
              const glowColor = warmth > 0.5 
                ? `rgba(251, 191, 36, ${0.3 + warmth * 0.3})` 
                : `rgba(34, 211, 238, ${0.3 + (1 - warmth) * 0.3})`;
              
              return (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ 
                    opacity: 1, 
                    y: 0,
                    scale: isHovered ? 1.15 : 1,
                    zIndex: isHovered ? 10 : 1,
                  }}
                  transition={{ 
                    delay: index * 0.05 + laneIndex * 0.1,
                    type: 'spring',
                    damping: 15,
                  }}
                  className="absolute cursor-pointer"
                  style={{ left: x }}
                  onMouseEnter={() => setHoveredImage(image)}
                  onMouseLeave={() => setHoveredImage(null)}
                  onClick={() => openModal(image)}
                >
                  <div className="relative">
                    {/* Glow */}
                    <div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        backgroundColor: glowColor,
                        filter: 'blur(15px)',
                        opacity: isHovered ? 0.8 : 0.4,
                        transform: 'scale(1.1)',
                      }}
                    />
                    
                    {/* Image */}
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden ring-2 ring-white/20">
                      <ThumbnailImage
                        src={image.urls.small}
                        alt={image.main_subject}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    
                    {/* Energy indicator line */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 w-px"
                      style={{
                        top: '100%',
                        height: spectrumHeight - laneIndex * 110 - 50,
                        background: `linear-gradient(180deg, ${dominantColor}80 0%, transparent 100%)`,
                      }}
                    />
                  </div>
                  
                  {/* Tooltip */}
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 glass rounded-lg p-2 whitespace-nowrap z-20"
                    >
                      <div className="text-xs text-white font-medium">{image.main_subject}</div>
                      <div className="text-[10px] text-stellar-violet italic mt-1">
                        {image.mood}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ))}
        
        {filteredImages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-nebula-400">
            <p>No images found</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
