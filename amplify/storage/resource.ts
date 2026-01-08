import { defineStorage } from '@aws-amplify/backend';

/**
 * S3 Storage configuration for PixNdx Gallery
 * 
 * Structure:
 * - images/small/{filename}   - Thumbnails (~200px)
 * - images/medium/{filename}  - Preview size (~800px)
 * - images/full/{filename}    - Full resolution
 * - metadata/{filename}.json  - Image metadata
 * - embeddings/{filename}.json - Vector embeddings (optional)
 */
export const storage = defineStorage({
  name: 'pixndxGalleryStorage',
  
  access: (allow) => ({
    // Public read access to images
    'images/small/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
    ],
    'images/medium/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
    ],
    'images/full/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read']),
    ],
    
    // Metadata readable by all, writable by authenticated users
    'metadata/*': [
      allow.guest.to(['read']),
      allow.authenticated.to(['read', 'write']),
    ],
    
    // Embeddings (internal use)
    'embeddings/*': [
      allow.authenticated.to(['read', 'write']),
    ],
    
    // User uploads - each user has their own folder
    'uploads/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
    
    // Private galleries
    'private/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});

/**
 * Storage paths helper
 * Use these constants for consistent path construction
 */
export const StoragePaths = {
  // Image sizes
  small: (filename: string) => `images/small/${filename}`,
  medium: (filename: string) => `images/medium/${filename}`,
  full: (filename: string) => `images/full/${filename}`,
  
  // Metadata
  metadata: (id: string) => `metadata/${id}.json`,
  
  // Embeddings
  embedding: (id: string) => `embeddings/${id}.json`,
  
  // User uploads
  userUpload: (userId: string, filename: string) => `uploads/${userId}/${filename}`,
  
  // Private galleries
  privateGallery: (userId: string, galleryId: string, filename: string) => 
    `private/${userId}/${galleryId}/${filename}`,
};

/**
 * Image size configurations
 * Used by the ingestImage function to resize uploads
 */
export const ImageSizes = {
  small: {
    width: 200,
    height: 200,
    fit: 'cover' as const,
    quality: 80,
  },
  medium: {
    width: 800,
    height: 800,
    fit: 'inside' as const,
    quality: 85,
  },
  full: {
    // Keep original dimensions
    quality: 90,
  },
};
