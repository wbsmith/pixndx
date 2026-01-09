import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

interface ImageRatingProps {
  imageId: string;
  currentRating?: number;
  userRating?: number;
  totalRatings?: number;
  onRate: (imageId: string, rating: number) => Promise<void>;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Split rating display:
 * - Community rating (read-only, shows average)
 * - Your rating (interactive, empty until you rate)
 */
export function ImageRating({
  imageId,
  currentRating = 0,
  userRating,
  totalRatings = 0,
  onRate,
  size = 'md',
}: ImageRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localUserRating, setLocalUserRating] = useState(userRating);

  // Sync with prop when it changes (e.g., after fetch)
  useEffect(() => {
    setLocalUserRating(userRating);
  }, [userRating]);

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const handleRate = useCallback(async (rating: number) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onRate(imageId, rating);
      setLocalUserRating(rating);
    } catch (error) {
      console.error('Failed to submit rating:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [imageId, onRate, isSubmitting]);

  // What to show for user's interactive stars
  const userDisplayRating = hoverRating ?? localUserRating ?? 0;
  const hasUserRated = localUserRating !== undefined && localUserRating > 0;

  return (
    <div className="space-y-2">
      {/* Community rating (read-only) */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-nebula-400 w-20">Community:</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = star <= currentRating;
            const isHalf = star - 0.5 <= currentRating && star > currentRating;

            return (
              <div key={star} className="relative">
                <Star
                  className={`${sizeClasses[size]} text-nebula-600`}
                  strokeWidth={1.5}
                />
                <div
                  className="absolute inset-0"
                  style={{ opacity: isFilled ? 1 : isHalf ? 0.5 : 0 }}
                >
                  <Star
                    className={`${sizeClasses[size]} text-stellar-gold fill-stellar-gold`}
                    strokeWidth={1.5}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <span className="text-xs text-nebula-400 font-mono">
          {currentRating.toFixed(1)} ({totalRatings})
        </span>
      </div>

      {/* User's rating (interactive) */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-nebula-400 w-20">Your rating:</span>
        <div 
          className="flex items-center gap-0.5 group"
          onMouseLeave={() => setHoverRating(null)}
          title={!hasUserRated ? 'Click to rate' : undefined}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = star <= userDisplayRating;

            return (
              <motion.button
                key={star}
                type="button"
                disabled={isSubmitting}
                className={`
                  relative transition-transform cursor-pointer hover:scale-110
                  ${isSubmitting ? 'opacity-50' : ''}
                `}
                onMouseEnter={() => setHoverRating(star)}
                onClick={() => handleRate(star)}
                whileTap={{ scale: 0.9 }}
              >
                {/* Background star (empty) */}
                <Star
                  className={`${sizeClasses[size]} ${
                    !hasUserRated && !hoverRating 
                      ? 'text-nebula-500 group-hover:text-nebula-400' 
                      : 'text-nebula-600'
                  }`}
                  strokeWidth={1.5}
                />
                
                {/* Filled star overlay */}
                <motion.div
                  className="absolute inset-0"
                  initial={false}
                  animate={{ opacity: isFilled ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Star
                    className={`${sizeClasses[size]} text-stellar-cyan fill-stellar-cyan`}
                    strokeWidth={1.5}
                  />
                </motion.div>
              </motion.button>
            );
          })}
        </div>
        {hasUserRated && (
          <span className="text-xs text-stellar-cyan font-mono">{localUserRating}</span>
        )}
        {!hasUserRated && !hoverRating && (
          <span className="text-[10px] text-nebula-500 italic">not yet rated</span>
        )}
      </div>
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
