import { useState } from 'react';
import { useImageUrl } from '@/lib/amplify';

interface ThumbnailImageProps {
  src: string;
  alt: string;
  size?: 'small' | 'medium' | 'full';
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * A simple image component that handles URL transformation for CDN/signed URLs.
 * Use this in visualization layouts (ColorWheel, MoodSpectrum, ClusterView) where
 * images are rendered in loops and need proper authentication.
 */
export function ThumbnailImage({
  src,
  alt,
  size = 'small',
  className = '',
  loading = 'lazy',
}: ThumbnailImageProps) {
  const imageUrl = useImageUrl(src, size);
  const [loaded, setLoaded] = useState(false);

  if (!imageUrl) {
    return (
      <div className={`bg-nebula-800 animate-pulse ${className}`} />
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      loading={loading}
      onLoad={() => setLoaded(true)}
      crossOrigin="use-credentials"
    />
  );
}
