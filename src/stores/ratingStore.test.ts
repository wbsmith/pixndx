import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Amplify client methods - shared across tests
let mockImageRatingList: ReturnType<typeof vi.fn>;
let mockImageRatingCreate: ReturnType<typeof vi.fn>;
let mockImageRatingUpdate: ReturnType<typeof vi.fn>;
let mockGetCurrentUser: ReturnType<typeof vi.fn>;

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(() => mockGetCurrentUser()),
}));

// Mock aws-amplify/data - return a fresh client each time
vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      ImageRating: {
        list: (...args: unknown[]) => mockImageRatingList(...args),
        create: (...args: unknown[]) => mockImageRatingCreate(...args),
        update: (...args: unknown[]) => mockImageRatingUpdate(...args),
      },
    },
  })),
}));

// Mock config to simulate production mode (IS_LOCAL_DEV = false)
vi.mock('@/config', () => ({
  IS_LOCAL_DEV: false,
}));

describe('ratingStore', () => {
  // Import inside describe to get fresh module after mocks are set up
  let useRatingStore: typeof import('./ratingStore').useRatingStore;

  beforeEach(async () => {
    // Reset mocks before each test
    mockImageRatingList = vi.fn();
    mockImageRatingCreate = vi.fn();
    mockImageRatingUpdate = vi.fn();
    mockGetCurrentUser = vi.fn();

    // Reset modules to get fresh store state and fresh client
    vi.resetModules();

    // Re-import to get fresh store
    const module = await import('./ratingStore');
    useRatingStore = module.useRatingStore;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('submitRating - user identification', () => {
    it('should create a new rating when user has not rated the image before', async () => {
      const currentUserId = 'user-123';
      const imageId = 'image-abc';
      const rating = 4;

      // Current user is user-123
      mockGetCurrentUser.mockResolvedValue({ userId: currentUserId });

      // Other users have rated this image, but not user-123
      mockImageRatingList.mockResolvedValue({
        data: [
          { id: 'rating-1', imageId, rating: 3, owner: 'user-456' },
          { id: 'rating-2', imageId, rating: 5, owner: 'user-789' },
        ],
      });

      mockImageRatingCreate.mockResolvedValue({ data: { id: 'new-rating' } });

      await useRatingStore.getState().submitRating(imageId, rating);

      // Should call create (not update) since user-123 hasn't rated this image
      expect(mockImageRatingCreate).toHaveBeenCalledWith({
        imageId,
        rating,
      });
      expect(mockImageRatingUpdate).not.toHaveBeenCalled();
    });

    it('should update existing rating when user has already rated the image', async () => {
      const currentUserId = 'user-123';
      const imageId = 'image-abc';
      const newRating = 5;

      // Current user is user-123
      mockGetCurrentUser.mockResolvedValue({ userId: currentUserId });

      // user-123 has already rated this image
      mockImageRatingList.mockResolvedValue({
        data: [
          { id: 'rating-1', imageId, rating: 3, owner: 'user-456' },
          { id: 'rating-user123', imageId, rating: 2, owner: 'user-123' },
          { id: 'rating-2', imageId, rating: 5, owner: 'user-789' },
        ],
      });

      mockImageRatingUpdate.mockResolvedValue({ data: { id: 'rating-user123' } });

      await useRatingStore.getState().submitRating(imageId, newRating);

      // Should call update (not create) with the correct rating ID
      expect(mockImageRatingUpdate).toHaveBeenCalledWith({
        id: 'rating-user123',
        rating: newRating,
      });
      expect(mockImageRatingCreate).not.toHaveBeenCalled();
    });

    it('should NOT mistake another user\'s rating as the current user\'s rating', async () => {
      // This is the BUG we fixed: the old code would find(r => r.owner) which
      // just returns the first rating with any owner, not the current user's rating
      const currentUserId = 'user-123';
      const imageId = 'image-abc';
      const rating = 4;

      mockGetCurrentUser.mockResolvedValue({ userId: currentUserId });

      // Only other users have rated - user-123 has NOT rated
      // The OLD buggy code would find 'user-456' rating because it has an owner
      mockImageRatingList.mockResolvedValue({
        data: [
          { id: 'other-rating', imageId, rating: 3, owner: 'user-456' },
        ],
      });

      mockImageRatingCreate.mockResolvedValue({ data: { id: 'new-rating' } });

      await useRatingStore.getState().submitRating(imageId, rating);

      // Should CREATE a new rating, not UPDATE user-456's rating
      expect(mockImageRatingCreate).toHaveBeenCalled();
      expect(mockImageRatingUpdate).not.toHaveBeenCalled();
    });

    it('should handle empty ratings list correctly', async () => {
      const currentUserId = 'user-123';
      const imageId = 'image-abc';
      const rating = 4;

      mockGetCurrentUser.mockResolvedValue({ userId: currentUserId });
      mockImageRatingList.mockResolvedValue({ data: [] });
      mockImageRatingCreate.mockResolvedValue({ data: { id: 'new-rating' } });

      await useRatingStore.getState().submitRating(imageId, rating);

      expect(mockImageRatingCreate).toHaveBeenCalledWith({
        imageId,
        rating,
      });
    });
  });

  describe('optimistic updates', () => {
    it('should optimistically update rating before API call completes', async () => {
      const imageId = 'image-abc';
      const rating = 4;

      mockGetCurrentUser.mockResolvedValue({ userId: 'user-123' });
      mockImageRatingList.mockResolvedValue({ data: [] });
      mockImageRatingCreate.mockResolvedValue({ data: { id: 'new-rating' } });

      // Start the rating submission
      const submitPromise = useRatingStore.getState().submitRating(imageId, rating);

      // Check that the rating was optimistically updated
      const ratingData = useRatingStore.getState().getRating(imageId);
      expect(ratingData.userRating).toBe(rating);

      await submitPromise;
    });

    it('should calculate new average correctly for first rating', async () => {
      const imageId = 'image-abc';
      const rating = 4;

      mockGetCurrentUser.mockResolvedValue({ userId: 'user-123' });
      // Return the new rating in the list after create (simulating DB state)
      mockImageRatingList.mockResolvedValue({
        data: [{ id: 'new-rating', imageId, rating, owner: 'user-123' }]
      });
      mockImageRatingCreate.mockResolvedValue({ data: { id: 'new-rating' } });

      await useRatingStore.getState().submitRating(imageId, rating);

      const ratingData = useRatingStore.getState().getRating(imageId);
      expect(ratingData.avg).toBe(4);
      expect(ratingData.count).toBe(1);
    });
  });

  describe('getRating', () => {
    it('should return default values for unrated images', () => {
      const ratingData = useRatingStore.getState().getRating('nonexistent-image');

      expect(ratingData).toEqual({
        avg: 0,
        count: 0,
        userRating: undefined,
      });
    });

    it('should return stored rating data', () => {
      const imageId = 'test-image';
      const testRating = { avg: 3.5, count: 10, userRating: 4 };

      useRatingStore.setState({
        ratings: new Map([[imageId, testRating]]),
      });

      const ratingData = useRatingStore.getState().getRating(imageId);
      expect(ratingData).toEqual(testRating);
    });
  });
});
