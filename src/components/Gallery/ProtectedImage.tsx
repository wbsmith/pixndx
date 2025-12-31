import { useState, useEffect, useRef } from 'react';
import { getUrl } from 'aws-amplify/storage';

interface ProtectedImageProps {
  /** S3 key for the image */
  s3Key: string;
  /** Alt text for accessibility */
  alt: string;
  /** CSS class name */
  className?: string;
  /** Image size variant */
  size?: 'small' | 'medium' | 'full';
  /** Callback when image loads */
  onLoad?: () => void;
  /** Callback on error */
  onError?: () => void;
  /** Show loading placeholder */
  showPlaceholder?: boolean;
  /** Disable context menu (right-click) */
  disableContextMenu?: boolean;
  /** Disable drag */
  disableDrag?: boolean;
}

/**
 * Protected image component that:
 * 1. Uses signed S3 URLs (expire after a short time)
 * 2. Disables right-click context menu
 * 3. Disables drag-to-save
 * 4. Applies CSS to prevent easy screenshots
 */
export function ProtectedImage({
  s3Key,
  alt,
  className = '',
  size = 'medium',
  onLoad,
  onError,
  showPlaceholder = true,
  disableContextMenu = true,
  disableDrag = true,
}: ProtectedImageProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Get signed URL on mount or when key changes
  useEffect(() => {
    let mounted = true;

    async function fetchSignedUrl() {
      try {
        setIsLoading(true);
        setHasError(false);

        // Get signed URL from Amplify Storage
        // URL expires in 15 minutes by default
        const result = await getUrl({
          key: `images/${size}/${s3Key}`,
          options: {
            expiresIn: 900, // 15 minutes
            validateObjectExistence: true,
          },
        });

        if (mounted) {
          setSignedUrl(result.url.toString());
        }
      } catch (error) {
        console.error('Failed to get signed URL:', error);
        if (mounted) {
          setHasError(true);
          onError?.();
        }
      }
    }

    fetchSignedUrl();

    return () => {
      mounted = false;
    };
  }, [s3Key, size, onError]);

  // Refresh URL before it expires (every 10 minutes)
  useEffect(() => {
    if (!signedUrl) return;

    const refreshInterval = setInterval(async () => {
      try {
        const result = await getUrl({
          key: `images/${size}/${s3Key}`,
          options: { expiresIn: 900 },
        });
        setSignedUrl(result.url.toString());
      } catch (error) {
        console.error('Failed to refresh signed URL:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(refreshInterval);
  }, [signedUrl, s3Key, size]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (disableContextMenu) {
      e.preventDefault();
      return false;
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (disableDrag) {
      e.preventDefault();
      return false;
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
    onLoad?.();
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
    onError?.();
  };

  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-nebula-800 ${className}`}>
        <span className="text-nebula-500 text-sm">Failed to load image</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Loading placeholder */}
      {showPlaceholder && isLoading && (
        <div className="absolute inset-0 bg-nebula-800 animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-stellar-cyan border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Actual image */}
      {signedUrl && (
        <img
          ref={imgRef}
          src={signedUrl}
          alt={alt}
          className={`
            ${className}
            ${isLoading ? 'opacity-0' : 'opacity-100'}
            transition-opacity duration-300
            select-none
            pointer-events-auto
          `}
          onContextMenu={handleContextMenu}
          onDragStart={handleDragStart}
          onLoad={handleLoad}
          onError={handleError}
          draggable={!disableDrag}
          // Prevent iOS long-press save
          style={{
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        />
      )}

      {/* Invisible overlay to prevent easy right-click saving */}
      {disableContextMenu && (
        <div
          className="absolute inset-0 bg-transparent"
          onContextMenu={handleContextMenu}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}

/**
 * Hook for getting signed URLs
 */
export function useSignedUrl(s3Key: string, size: 'small' | 'medium' | 'full' = 'medium') {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchUrl() {
      try {
        setIsLoading(true);
        setError(null);

        const result = await getUrl({
          key: `images/${size}/${s3Key}`,
          options: { expiresIn: 900 },
        });

        if (mounted) {
          setUrl(result.url.toString());
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Failed to get URL'));
          setIsLoading(false);
        }
      }
    }

    fetchUrl();

    return () => {
      mounted = false;
    };
  }, [s3Key, size]);

  return { url, isLoading, error };
}

/**
 * Batch fetch signed URLs for multiple images
 */
export async function getSignedUrls(
  s3Keys: string[],
  size: 'small' | 'medium' | 'full' = 'medium'
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();

  await Promise.all(
    s3Keys.map(async (key) => {
      try {
        const result = await getUrl({
          key: `images/${size}/${key}`,
          options: { expiresIn: 900 },
        });
        urlMap.set(key, result.url.toString());
      } catch (error) {
        console.error(`Failed to get signed URL for ${key}:`, error);
      }
    })
  );

  return urlMap;
}
