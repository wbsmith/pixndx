import { create } from 'zustand';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { IS_LOCAL_DEV } from '@/config';

// Type for rating data
interface RatingData {
  avg: number;
  count: number;
  userRating?: number;
}

interface RatingStore {
  // State
  ratings: Map<string, RatingData>;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  submitRating: (imageId: string, rating: number) => Promise<void>;
  getRating: (imageId: string) => RatingData;
  fetchRatingsForImages: (imageIds: string[]) => Promise<void>;
  clearError: () => void;
}

// Create Amplify client (only used in production)
let client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!client && !IS_LOCAL_DEV) {
    client = generateClient<Schema>();
  }
  return client;
}

export const useRatingStore = create<RatingStore>((set, get) => ({
  ratings: new Map(),
  isLoading: false,
  error: null,

  getRating: (imageId: string) => {
    return get().ratings.get(imageId) || { avg: 0, count: 0, userRating: undefined };
  },

  clearError: () => set({ error: null }),

  submitRating: async (imageId: string, rating: number) => {
    const currentRatings = get().ratings;
    const current = currentRatings.get(imageId) || { avg: 0, count: 0 };
    
    // Optimistic update
    const newCount = current.userRating ? current.count : current.count + 1;
    let newAvg: number;
    if (current.userRating) {
      // Update existing rating
      newAvg = current.count > 0 
        ? (current.avg * current.count - current.userRating + rating) / current.count
        : rating;
    } else {
      // New rating
      newAvg = (current.avg * current.count + rating) / newCount;
    }
    
    const updatedRatings = new Map(currentRatings);
    updatedRatings.set(imageId, { avg: newAvg, count: newCount, userRating: rating });
    set({ ratings: updatedRatings });

    // If in local dev, we're done (no backend)
    if (IS_LOCAL_DEV) {
      console.log(`[RatingStore] Local dev: Rating ${rating} for image ${imageId}`);
      return;
    }

    // Submit to Amplify backend
    try {
      const amplifyClient = getClient();
      if (!amplifyClient) throw new Error('Amplify client not initialized');
      
      // Check if user already has a rating for this image
      const { data: existingRatings } = await amplifyClient.models.ImageRating.list({
        filter: { imageId: { eq: imageId } },
      });
      
      const userRating = existingRatings?.find(r => r.owner);
      
      if (userRating) {
        // Update existing rating
        await amplifyClient.models.ImageRating.update({
          id: userRating.id,
          rating,
        });
        console.log(`[RatingStore] Updated rating to ${rating} for image ${imageId}`);
      } else {
        // Create new rating
        await amplifyClient.models.ImageRating.create({
          imageId,
          rating,
        });
        console.log(`[RatingStore] Created rating ${rating} for image ${imageId}`);
      }
      
      // Update the Image model's aggregate rating
      // Note: In a production system, this might be done via a Lambda trigger
      // For now, we'll update it directly
      const { data: allRatings } = await amplifyClient.models.ImageRating.list({
        filter: { imageId: { eq: imageId } },
      });
      
      if (allRatings && allRatings.length > 0) {
        const totalRating = allRatings.reduce((sum, r) => sum + r.rating, 0);
        const avgRating = totalRating / allRatings.length;
        
        // Update the ratings map with the actual server data
        const finalRatings = new Map(get().ratings);
        finalRatings.set(imageId, { 
          avg: avgRating, 
          count: allRatings.length, 
          userRating: rating 
        });
        set({ ratings: finalRatings });
      }
      
    } catch (error) {
      console.error('[RatingStore] Failed to submit rating:', error);
      // Revert optimistic update on error
      const revertedRatings = new Map(get().ratings);
      revertedRatings.set(imageId, current);
      set({ 
        ratings: revertedRatings,
        error: 'Failed to save rating. Please try again.',
      });
    }
  },

  fetchRatingsForImages: async (imageIds: string[]) => {
    if (IS_LOCAL_DEV || imageIds.length === 0) return;
    
    set({ isLoading: true, error: null });
    
    try {
      const amplifyClient = getClient();
      if (!amplifyClient) throw new Error('Amplify client not initialized');
      
      const updatedRatings = new Map(get().ratings);
      
      // Fetch ratings in batches to avoid overwhelming the API
      const batchSize = 25;
      for (let i = 0; i < imageIds.length; i += batchSize) {
        const batch = imageIds.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (imageId) => {
          try {
            const { data: ratings } = await amplifyClient.models.ImageRating.list({
              filter: { imageId: { eq: imageId } },
            });
            
            if (ratings && ratings.length > 0) {
              const totalRating = ratings.reduce((sum, r) => sum + r.rating, 0);
              const avgRating = totalRating / ratings.length;
              const userRating = ratings.find(r => r.owner)?.rating;
              
              updatedRatings.set(imageId, {
                avg: avgRating,
                count: ratings.length,
                userRating,
              });
            }
          } catch (e) {
            console.warn(`[RatingStore] Failed to fetch rating for ${imageId}:`, e);
          }
        }));
      }
      
      set({ ratings: updatedRatings, isLoading: false });
    } catch (error) {
      console.error('[RatingStore] Failed to fetch ratings:', error);
      set({ error: 'Failed to load ratings', isLoading: false });
    }
  },
}));

// Hook for convenience
export function useImageRating(imageId: string) {
  const { getRating, submitRating, error, clearError } = useRatingStore();
  const ratingData = getRating(imageId);
  
  return {
    ...ratingData,
    submitRating: (rating: number) => submitRating(imageId, rating),
    error,
    clearError,
  };
}

