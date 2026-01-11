import { create } from 'zustand';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
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
      
      // Get the current user's identity
      const { userId } = await getCurrentUser();

      // Check if user already has a rating for this image
      const { data: existingRatings } = await amplifyClient.models.ImageRating.list({
        filter: { imageId: { eq: imageId } },
      });

      // Find the current user's rating specifically (not just any rating with an owner)
      const userRating = existingRatings?.find(r => r.owner === userId);
      
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
      
      // Re-fetch to catch any concurrent ratings from other users
      // Note: DynamoDB GSIs are eventually consistent, so we may not see our
      // own rating immediately. Only update if server has MORE ratings than
      // our optimistic count (meaning other users rated concurrently).
      const { data: allRatings } = await amplifyClient.models.ImageRating.list({
        filter: { imageId: { eq: imageId } },
      });

      if (allRatings && allRatings.length > 0) {
        const optimisticState = get().ratings.get(imageId);
        const optimisticCount = optimisticState?.count || 0;

        // Only update from server if it has MORE ratings (concurrent users)
        // Don't downgrade count due to GSI eventual consistency
        if (allRatings.length > optimisticCount) {
          const totalRating = allRatings.reduce((sum, r) => sum + r.rating, 0);
          const avgRating = totalRating / allRatings.length;

          const finalRatings = new Map(get().ratings);
          finalRatings.set(imageId, {
            avg: avgRating,
            count: allRatings.length,
            userRating: rating
          });
          set({ ratings: finalRatings });
        }
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

  fetchRatingsForImages: async (_imageIds: string[]) => {
    if (IS_LOCAL_DEV) return;
    
    set({ isLoading: true, error: null });
    
    try {
      const amplifyClient = getClient();
      if (!amplifyClient) throw new Error('Amplify client not initialized');
      
      // Fetch ALL ratings in a single paginated query (much more efficient!)
      const allRatings: Array<{ imageId: string; rating: number; owner?: string | null }> = [];
      let nextToken: string | null | undefined = undefined;
      
      console.log('[RatingStore] Fetching all ratings from database...');
      
      // Fetch first page
      let response = await amplifyClient.models.ImageRating.list({
        limit: 1000,
      });
      
      if (response.data) {
        allRatings.push(...response.data);
      }
      nextToken = response.nextToken;
      
      // Fetch remaining pages
      while (nextToken) {
        response = await amplifyClient.models.ImageRating.list({
          limit: 1000,
          nextToken,
        });
        
        if (response.data) {
          allRatings.push(...response.data);
        }
        nextToken = response.nextToken;
      }
      
      console.log(`[RatingStore] Fetched ${allRatings.length} total ratings`);
      
      // Group ratings by imageId and calculate averages
      const ratingsByImage = new Map<string, number[]>();
      
      for (const rating of allRatings) {
        if (!rating.imageId) continue;
        
        const existing = ratingsByImage.get(rating.imageId) || [];
        existing.push(rating.rating);
        ratingsByImage.set(rating.imageId, existing);
      }
      
      // Convert to our rating data format
      const updatedRatings = new Map<string, RatingData>();
      
      for (const [imageId, ratings] of ratingsByImage) {
        const totalRating = ratings.reduce((sum, r) => sum + r, 0);
        const avgRating = totalRating / ratings.length;
        
        updatedRatings.set(imageId, {
          avg: avgRating,
          count: ratings.length,
          userRating: undefined, // We'll update this when user rates
        });
      }
      
      console.log(`[RatingStore] Processed ratings for ${updatedRatings.size} images`);
      
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

