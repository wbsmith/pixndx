import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { searchImages } from '../functions/searchImages/resource';
import { computeSimilarity } from '../functions/computeSimilarity/resource';

/**
 * GraphQL Schema for PixNdx Gallery
 * 
 * Models:
 * - Image: Core image metadata matching your JSON structure
 * - ImageRating: User ratings for images
 * - SearchResult: Results from semantic search
 * - SimilarityEdge: Connections between similar images
 * - Gallery: Collections of images (optional feature)
 * 
 * Authentication:
 * - All access requires authentication (no guest access)
 * - Users can rate any image
 * - Only owners can create/update/delete images
 */
const schema = a.schema({
  // Core Image model - matches your metadata JSON structure
  Image: a
    .model({
      // Identifiers
      filename: a.string().required(),
      
      // URLs for different sizes (will be signed URLs in production)
      urlSmall: a.string().required(),
      urlMedium: a.string().required(),
      urlFull: a.string().required(),
      
      // AI-generated content from your metadata
      description: a.string().required(),
      mood: a.string().required(),
      mainSubject: a.string().required(),
      
      // Nested structures stored as JSON strings
      tags: a.json().required(),           // Record<string, string[]>
      mainColors: a.json().required(),     // Record<string, string>
      exif: a.json(),                      // Full EXIF data
      
      // Vector embeddings for similarity search (stored as JSON arrays)
      clipEmbedding: a.json(),             // number[] - CLIP image embedding
      descriptionEmbedding: a.json(),      // number[] - Text embedding
      
      // Computed fields for filtering
      dominantColorHex: a.string(),        // First color from mainColors
      warmth: a.float(),                   // Computed color warmth 0-1
      
      // Rating aggregates (updated when ratings change)
      avgRating: a.float().default(0),     // Average rating 0-5
      ratingCount: a.integer().default(0), // Number of ratings
      
      // Timestamps
      dateTaken: a.datetime(),             // From EXIF DateTimeOriginal
      
      // Optional: Gallery associations
      galleryId: a.id(),
      
      // For sorting and filtering
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      // Index for filtering by mood
      index('mood'),
      // Index for filtering by dominant color
      index('dominantColorHex'),
      // Index for date-based queries
      index('dateTaken'),
      // Index for sorting by rating
      index('avgRating'),
    ])
    .authorization((allow) => [
      // Only authenticated users can access (no guest access)
      allow.authenticated().to(['read']),
      // Only owners can create/update/delete
      allow.owner(),
    ]),

  // Individual user ratings for images
  ImageRating: a
    .model({
      imageId: a.id().required(),
      rating: a.integer().required(),      // 1-5 stars
      // owner field is automatically added for authorization
    })
    .secondaryIndexes((index) => [
      // Index to query all ratings for an image
      index('imageId'),
    ])
    .authorization((allow) => [
      // Users can read all ratings (for aggregate display)
      allow.authenticated().to(['read']),
      // Users can only create/update/delete their own ratings
      allow.owner(),
    ]),

  // Gallery model for organizing images into collections
  Gallery: a
    .model({
      name: a.string().required(),
      description: a.string(),
      coverImageId: a.id(),
      isPublic: a.boolean().default(true),
      ownerId: a.id(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),
      allow.owner(),
    ]),

  // Search result type (not persisted)
  SearchResult: a.customType({
    imageId: a.id().required(),
    score: a.float().required(),
    matchedFields: a.string().array(),
    avgRating: a.float(),
  }),

  // Similarity edge for graph visualization
  SimilarityEdge: a.customType({
    sourceId: a.id().required(),
    targetId: a.id().required(),
    weight: a.float().required(),
    mode: a.string().required(),
  }),

  // Semantic search query with rating sort option
  searchImages: a
    .query()
    .arguments({
      query: a.string().required(),
      limit: a.integer(), // Default handled in Lambda: 20
      filters: a.json(), // Optional filters: { tags?, mood?, colors?, dateRange?, minRating? }
      sortBy: a.enum(['relevance', 'rating', 'date']),
      sortOrder: a.enum(['asc', 'desc']),
    })
    .returns(a.ref('SearchResult').array())
    .handler(a.handler.function(searchImages))
    .authorization((allow) => [
      allow.authenticated(),
    ]),

  // Compute similarity between images
  computeSimilarityEdges: a
    .query()
    .arguments({
      imageIds: a.id().array().required(),
      mode: a.enum(['full', 'colors', 'mood', 'tags', 'description', 'composite']),
      threshold: a.float(), // Default handled in Lambda: 0.3
      weights: a.json(), // { visual, semantic, color, mood }
    })
    .returns(a.ref('SimilarityEdge').array())
    .handler(a.handler.function(computeSimilarity))
    .authorization((allow) => [
      allow.authenticated(),
    ]),

  // Get similar images to a specific image
  getSimilarImages: a
    .query()
    .arguments({
      imageId: a.id().required(),
      limit: a.integer(), // Default handled in Lambda: 10
      mode: a.enum(['full', 'colors', 'mood', 'tags', 'description', 'composite']),
    })
    .returns(a.ref('SearchResult').array())
    .handler(a.handler.function(searchImages))
    .authorization((allow) => [
      allow.authenticated(),
    ]),

  // Get top-rated images
  topRatedImages: a
    .query()
    .arguments({
      limit: a.integer(), // Default handled in Lambda: 20
      minRatings: a.integer(), // Default handled in Lambda: 1
    })
    .returns(a.ref('SearchResult').array())
    .handler(a.handler.function(searchImages))
    .authorization((allow) => [
      allow.authenticated(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Default to user pool authentication (requires login)
    defaultAuthorizationMode: 'userPool',
    // Keep API key for admin operations if needed
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
