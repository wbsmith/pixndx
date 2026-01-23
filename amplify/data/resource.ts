import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { searchImages } from '../functions/searchImages/resource';
import { computeSimilarity } from '../functions/computeSimilarity/resource';
import { generateImageCookies } from '../functions/generateImageCookies/resource';
import { processImage } from '../functions/processImage/resource';
import { deleteImage } from '../functions/deleteImage/resource';

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

      // Precomputed similarity neighbors for graph visualization
      // Array of { id, clipWeight, compositeWeight }
      clipNeighbors: a.json(),             // ClipNeighbor[]

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
      // Authenticated users can read
      allow.authenticated().to(['read']),
      // Owners can manage their images
      allow.owner(),
      // API key auth for GPU instance to create/update images (triggers subscriptions)
      allow.publicApiKey().to(['create', 'update']),
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

  // Manifest update notification model
  // GPU processor creates a record when manifest is updated
  // Frontend subscribes to onCreate to know when to refetch manifest
  ManifestUpdate: a
    .model({
      version: a.string().required(),      // Manifest version
      imageCount: a.integer().required(),  // Number of images in manifest
      processedCount: a.integer(),         // Images processed this session
      instanceId: a.string(),              // GPU instance ID
      // TTL for auto-cleanup (DynamoDB TTL) - records expire after 1 day
      ttl: a.integer(),
    })
    .authorization((allow) => [
      // Anyone authenticated can read (for subscriptions)
      allow.authenticated().to(['read']),
      // API key auth for GPU processor to create records
      allow.publicApiKey().to(['create']),
    ]),

  // Process image result type
  ProcessImageResult: a.customType({
    success: a.boolean().required(),
    imageId: a.string().required(),
    message: a.string().required(),
    queuedAt: a.string().required(),
  }),

  // Delete image result type
  DeleteImageResult: a.customType({
    success: a.boolean().required(),
    imageId: a.string().required(),
    deletedFiles: a.string().array().required(),
    message: a.string().required(),
  }),

  // Cookie options for frontend to use when setting cookies
  CookieOptions: a.customType({
    domain: a.string().required(),
    path: a.string().required(),
    secure: a.boolean().required(),
    sameSite: a.string().required(),
    expires: a.string().required(),
  }),

  // Response from generateImageCookies mutation
  ImageCookiesResponse: a.customType({
    cookies: a.json().required(), // { CloudFront-Policy, CloudFront-Signature, CloudFront-Key-Pair-Id }
    cookieOptions: a.ref('CookieOptions').required(),
  }),

  // Generate CloudFront signed cookies for image access
  generateImageCookies: a
    .mutation()
    .returns(a.ref('ImageCookiesResponse'))
    .handler(a.handler.function(generateImageCookies))
    .authorization((allow) => [
      allow.authenticated(),
    ]),

  // Process uploaded image (Admins only)
  // Queues image for GPU processing (resize, CLIP, Gemma metadata)
  processImage: a
    .mutation()
    .arguments({ sourceKey: a.string().required() })
    .returns(a.ref('ProcessImageResult'))
    .handler(a.handler.function(processImage))
    .authorization((allow) => [
      allow.groups(['Admins']),
    ]),

  // Delete image and all associated files from S3 (Admins only)
  deleteImageFiles: a
    .mutation()
    .arguments({ imageId: a.string().required() })
    .returns(a.ref('DeleteImageResult'))
    .handler(a.handler.function(deleteImage))
    .authorization((allow) => [
      allow.groups(['Admins']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // Default to user pool authentication (requires login)
    defaultAuthorizationMode: 'userPool',
    // API key auth for GPU instance to create images via AppSync
    // This triggers subscriptions for real-time updates
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
