import { useCallback, useMemo } from 'react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { ImageMetadata, LayoutType, SimilarityMode } from '@/types/gallery';

interface UseGalleryReturn {
  // Images
  images: ImageMetadata[];
  filteredImages: ImageMetadata[];
  imageCount: number;
  filteredCount: number;
  
  // Selection
  selectedImage: ImageMetadata | null;
  hoveredImage: ImageMetadata | null;
  selectImage: (image: ImageMetadata | null) => void;
  hoverImage: (image: ImageMetadata | null) => void;
  
  // Modal
  isModalOpen: boolean;
  openModal: (image: ImageMetadata) => void;
  closeModal: () => void;
  
  // Navigation
  nextImage: () => void;
  previousImage: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  currentIndex: number;
  
  // Bulk operations
  getImageById: (id: string) => ImageMetadata | undefined;
  getImagesByIds: (ids: string[]) => ImageMetadata[];
  getRandomImages: (count: number) => ImageMetadata[];
  
  // Layout
  currentLayout: LayoutType;
  setLayout: (layout: LayoutType) => void;
  
  // Loading
  isLoading: boolean;
}

/**
 * Main hook for interacting with the gallery
 */
export function useGallery(): UseGalleryReturn {
  const {
    images,
    filteredImages,
    selectedImage,
    hoveredImage,
    modalOpen,
    loading,
    layout,
    setSelectedImage,
    setHoveredImage,
    openModal,
    closeModal,
    setLayout: storeSetLayout,
  } = useGalleryStore();
  
  // Image lookup map for O(1) access
  const imageMap = useMemo(() => {
    const map = new Map<string, ImageMetadata>();
    images.forEach((img) => map.set(img.id, img));
    return map;
  }, [images]);
  
  // Current index in filtered images
  const currentIndex = useMemo(() => {
    if (!selectedImage) return -1;
    return filteredImages.findIndex((img) => img.id === selectedImage.id);
  }, [selectedImage, filteredImages]);
  
  // Navigation helpers
  const hasNext = currentIndex >= 0 && currentIndex < filteredImages.length - 1;
  const hasPrevious = currentIndex > 0;
  
  const nextImage = useCallback(() => {
    if (hasNext) {
      const next = filteredImages[currentIndex + 1];
      setSelectedImage(next);
      if (modalOpen) {
        openModal(next);
      }
    }
  }, [hasNext, filteredImages, currentIndex, setSelectedImage, modalOpen, openModal]);
  
  const previousImage = useCallback(() => {
    if (hasPrevious) {
      const prev = filteredImages[currentIndex - 1];
      setSelectedImage(prev);
      if (modalOpen) {
        openModal(prev);
      }
    }
  }, [hasPrevious, filteredImages, currentIndex, setSelectedImage, modalOpen, openModal]);
  
  // Image getters
  const getImageById = useCallback((id: string) => {
    return imageMap.get(id);
  }, [imageMap]);
  
  const getImagesByIds = useCallback((ids: string[]) => {
    return ids.map((id) => imageMap.get(id)).filter(Boolean) as ImageMetadata[];
  }, [imageMap]);
  
  const getRandomImages = useCallback((count: number) => {
    const shuffled = [...filteredImages].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }, [filteredImages]);
  
  // Layout setter
  const setLayout = useCallback((layoutType: LayoutType) => {
    storeSetLayout({ type: layoutType });
  }, [storeSetLayout]);
  
  return {
    images,
    filteredImages,
    imageCount: images.length,
    filteredCount: filteredImages.length,
    selectedImage,
    hoveredImage,
    selectImage: setSelectedImage,
    hoverImage: setHoveredImage,
    isModalOpen: modalOpen,
    openModal,
    closeModal,
    nextImage,
    previousImage,
    hasNext,
    hasPrevious,
    currentIndex,
    getImageById,
    getImagesByIds,
    getRandomImages,
    currentLayout: layout.type,
    setLayout,
    isLoading: loading,
  };
}

/**
 * Hook for keyboard navigation in gallery
 */
export function useGalleryKeyboard() {
  const { nextImage, previousImage, closeModal, isModalOpen } = useGallery();
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isModalOpen) return;
    
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        nextImage();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        previousImage();
        break;
      case 'Escape':
        event.preventDefault();
        closeModal();
        break;
    }
  }, [isModalOpen, nextImage, previousImage, closeModal]);
  
  // Use effect to attach listener would go in the component
  return { handleKeyDown };
}

/**
 * Hook for image preloading
 */
export function useImagePreload(images: ImageMetadata[], size: 'small' | 'medium' | 'full' = 'medium') {
  const preloadImage = useCallback((url: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
  }, []);
  
  const preloadAll = useCallback(async () => {
    const urls = images.map((img) => img.urls[size]);
    await Promise.allSettled(urls.map(preloadImage));
  }, [images, size, preloadImage]);
  
  const preloadAround = useCallback(async (currentIndex: number, range = 2) => {
    const start = Math.max(0, currentIndex - range);
    const end = Math.min(images.length, currentIndex + range + 1);
    const nearby = images.slice(start, end);
    const urls = nearby.map((img) => img.urls[size]);
    await Promise.allSettled(urls.map(preloadImage));
  }, [images, size, preloadImage]);
  
  return { preloadAll, preloadAround, preloadImage };
}

/**
 * Hook for image statistics
 */
export function useGalleryStats() {
  const { images, filteredImages } = useGalleryStore();
  
  const stats = useMemo(() => {
    const allTags = new Set<string>();
    const allMoods = new Set<string>();
    const allColors = new Set<string>();
    const cameras = new Set<string>();
    
    images.forEach((img) => {
      Object.values(img.tags).flat().forEach((t) => allTags.add(t));
      img.mood.split(/[,\s]+/).forEach((m) => {
        if (m.trim()) allMoods.add(m.trim());
      });
      Object.keys(img.main_colors).forEach((c) => allColors.add(c));
      if (img.exif?.Model) cameras.add(img.exif.Model);
    });
    
    return {
      totalImages: images.length,
      filteredImages: filteredImages.length,
      uniqueTags: allTags.size,
      uniqueMoods: allMoods.size,
      uniqueColors: allColors.size,
      uniqueCameras: cameras.size,
      tags: Array.from(allTags),
      moods: Array.from(allMoods),
      colors: Array.from(allColors),
      cameras: Array.from(cameras),
    };
  }, [images, filteredImages]);
  
  return stats;
}
