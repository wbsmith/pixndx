import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

interface ImageRatingProps {
  imageId: string;
  currentRating?: number;
  userRating?: number;
  totalRatings?: number;
  onRate: (imageId: string, rating: number) => Promise<void>;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  readOnly?: boolean;
}

export function ImageRating({
  imageId,
  currentRating = 0,
  userRating,
  totalRatings = 0,
  onRate,
  size = 'md',
  showCount = true,
  readOnly = false,
}: ImageRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localUserRating, setLocalUserRating] = useState(userRating);

  const displayRating = hoverRating ?? localUserRating ?? currentRating;

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const handleRate = useCallback(async (rating: number) => {
    if (readOnly || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onRate(imageId, rating);
      setLocalUserRating(rating);
    } catch (error) {
      console.error('Failed to submit rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [imageId, onRate, readOnly, isSubmitting]);

  return (
    <div className="flex items-center gap-2">
      <div 
        className="flex items-center gap-0.5"
        onMouseLeave={() => !readOnly && setHoverRating(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= displayRating;
          const isHalf = star - 0.5 <= displayRating && star > displayRating;

          return (
            <motion.button
              key={star}
              type="button"
              disabled={readOnly || isSubmitting}
              className={`
                relative transition-transform
                ${readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}
                ${isSubmitting ? 'opacity-50' : ''}
              `}
              onMouseEnter={() => !readOnly && setHoverRating(star)}
              onClick={() => handleRate(star)}
              whileTap={readOnly ? undefined : { scale: 0.9 }}
            >
              {/* Background star (empty) */}
              <Star
                className={`${sizeClasses[size]} text-nebula-600`}
                strokeWidth={1.5}
              />
              
              {/* Filled star overlay */}
              <motion.div
                className="absolute inset-0"
                initial={false}
                animate={{ 
                  opacity: isFilled ? 1 : isHalf ? 0.5 : 0,
                }}
                transition={{ duration: 0.15 }}
              >
                <Star
                  className={`${sizeClasses[size]} text-stellar-gold fill-stellar-gold`}
                  strokeWidth={1.5}
                />
              </motion.div>
            </motion.button>
          );
        })}
      </div>

      {showCount && (
        <div className="flex items-center gap-1 text-xs text-nebula-400">
          <span className="font-mono">{currentRating.toFixed(1)}</span>
          {totalRatings > 0 && (
            <span>({totalRatings})</span>
          )}
        </div>
      )}

      {localUserRating && !readOnly && (
        <span className="text-[10px] text-stellar-cyan">Your rating</span>
      )}
    </div>
  );
}

// Compact rating display (for cards/grid)
interface RatingBadgeProps {
  rating: number;
  count?: number;
}

export function RatingBadge({ rating, count }: RatingBadgeProps) {
  if (rating === 0) return null;

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-black/60 rounded text-xs">
      <Star className="w-3 h-3 text-stellar-gold fill-stellar-gold" />
      <span className="text-white font-mono">{rating.toFixed(1)}</span>
      {count !== undefined && count > 0 && (
        <span className="text-nebula-400">({count})</span>
      )}
    </div>
  );
}

// Hook for managing ratings
export function useImageRating() {
  const [ratings, setRatings] = useState<Map<string, { avg: number; count: number; userRating?: number }>>(new Map());

  const submitRating = useCallback(async (imageId: string, rating: number): Promise<void> => {
    // This would call the API in production
    // For now, update local state optimistically
    setRatings(prev => {
      const current = prev.get(imageId) || { avg: 0, count: 0 };
      const newCount = current.userRating ? current.count : current.count + 1;
      
      // Recalculate average
      let newAvg: number;
      if (current.userRating) {
        // Update existing rating
        newAvg = (current.avg * current.count - current.userRating + rating) / current.count;
      } else {
        // New rating
        newAvg = (current.avg * current.count + rating) / newCount;
      }

      const updated = new Map(prev);
      updated.set(imageId, { avg: newAvg, count: newCount, userRating: rating });
      return updated;
    });

    // In production, call API:
    // await rateImage(imageId, rating);
  }, []);

  const getRating = useCallback((imageId: string) => {
    return ratings.get(imageId) || { avg: 0, count: 0, userRating: undefined };
  }, [ratings]);

  return { submitRating, getRating, ratings };
}
