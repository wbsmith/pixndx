import { useState, useCallback, useMemo, useEffect } from 'react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { ImageMetadata, SearchFilters, SearchResult } from '@/types/gallery';

interface UseSearchOptions {
  debounceMs?: number;
  minQueryLength?: number;
  maxResults?: number;
}

interface UseSearchReturn {
  // State
  query: string;
  filters: SearchFilters | undefined;
  results: SearchResult[];
  isSearching: boolean;
  hasSearched: boolean;
  
  // Actions
  setQuery: (query: string) => void;
  setFilters: (filters: SearchFilters | undefined) => void;
  search: () => void;
  clearSearch: () => void;
  
  // Derived
  resultCount: number;
  hasResults: boolean;
  hasActiveFilters: boolean;
}

/**
 * Hook for managing search state and performing searches
 */
export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const {
    debounceMs = 300,
    minQueryLength = 0,
    maxResults = 50,
  } = options;
  
  const {
    searchQuery,
    searchFilters,
    setSearchQuery,
    setSearchFilters,
    performSearch,
    filteredImages,
  } = useGalleryStore();
  
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  
  // Convert filtered images to search results with scores
  const results = useMemo((): SearchResult[] => {
    if (!hasSearched && !searchQuery && !searchFilters) {
      return [];
    }
    
    return filteredImages.slice(0, maxResults).map((image) => ({
      image,
      score: 1, // In a real implementation, this would be the actual score
      matchedFields: getMatchedFields(image, searchQuery, searchFilters),
    }));
  }, [filteredImages, hasSearched, searchQuery, searchFilters, maxResults]);
  
  // Set query with debouncing
  const setQuery = useCallback((query: string) => {
    setSearchQuery(query);
    
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    if (query.length >= minQueryLength) {
      setIsSearching(true);
      const timer = setTimeout(() => {
        performSearch();
        setIsSearching(false);
        setHasSearched(true);
      }, debounceMs);
      setDebounceTimer(timer);
    }
  }, [debounceMs, debounceTimer, minQueryLength, performSearch, setSearchQuery]);
  
  // Set filters
  const setFilters = useCallback((filters: SearchFilters | undefined) => {
    setSearchFilters(filters);
    performSearch();
    setHasSearched(true);
  }, [performSearch, setSearchFilters]);
  
  // Manual search trigger
  const search = useCallback(() => {
    setIsSearching(true);
    performSearch();
    setIsSearching(false);
    setHasSearched(true);
  }, [performSearch]);
  
  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchFilters(undefined);
    performSearch();
    setHasSearched(false);
  }, [performSearch, setSearchFilters, setSearchQuery]);
  
  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);
  
  // Derived state
  const hasActiveFilters = useMemo(() => {
    if (!searchFilters) return false;
    return (
      (searchFilters.tags?.length ?? 0) > 0 ||
      (searchFilters.mood?.length ?? 0) > 0 ||
      (searchFilters.colors?.length ?? 0) > 0 ||
      !!searchFilters.dateRange?.start ||
      !!searchFilters.dateRange?.end
    );
  }, [searchFilters]);
  
  return {
    query: searchQuery,
    filters: searchFilters,
    results,
    isSearching,
    hasSearched,
    setQuery,
    setFilters,
    search,
    clearSearch,
    resultCount: results.length,
    hasResults: results.length > 0,
    hasActiveFilters,
  };
}

/**
 * Determine which fields matched the search
 */
function getMatchedFields(
  image: ImageMetadata,
  query: string,
  filters: SearchFilters | undefined
): string[] {
  const matched: string[] = [];
  const queryLower = query.toLowerCase();
  
  if (queryLower) {
    // Check tags
    const allTags = Object.values(image.tags).flat();
    if (allTags.some((tag) => tag.toLowerCase().includes(queryLower))) {
      matched.push('tags');
    }
    
    // Check description
    if (image.description.toLowerCase().includes(queryLower)) {
      matched.push('description');
    }
    
    // Check mood
    if (image.mood.toLowerCase().includes(queryLower)) {
      matched.push('mood');
    }
    
    // Check main subject
    if (image.main_subject.toLowerCase().includes(queryLower)) {
      matched.push('main_subject');
    }
    
    // Check colors
    if (Object.keys(image.main_colors).some((c) => c.toLowerCase().includes(queryLower))) {
      matched.push('colors');
    }
  }
  
  // Add filter matches
  if (filters?.tags?.length) {
    matched.push('filter:tags');
  }
  if (filters?.mood?.length) {
    matched.push('filter:mood');
  }
  if (filters?.colors?.length) {
    matched.push('filter:colors');
  }
  
  return matched;
}

/**
 * Hook for search suggestions/autocomplete
 */
export function useSearchSuggestions(query: string, maxSuggestions = 10) {
  const { images } = useGalleryStore();
  
  const suggestions = useMemo(() => {
    if (!query || query.length < 2) {
      return [];
    }
    
    const queryLower = query.toLowerCase();
    const results: Array<{ type: string; value: string; score: number }> = [];
    
    // Collect unique values
    const tags = new Set<string>();
    const moods = new Set<string>();
    const subjects = new Set<string>();
    const colors = new Set<string>();
    
    images.forEach((img) => {
      Object.values(img.tags).flat().forEach((t) => tags.add(t.toLowerCase()));
      img.mood.split(/[,\s]+/).forEach((m) => {
        if (m.trim()) moods.add(m.trim().toLowerCase());
      });
      subjects.add(img.main_subject.toLowerCase());
      Object.keys(img.main_colors).forEach((c) => colors.add(c.replace(/_/g, ' ').toLowerCase()));
    });
    
    // Score and filter
    const score = (value: string) => {
      if (value === queryLower) return 100;
      if (value.startsWith(queryLower)) return 80;
      if (value.includes(queryLower)) return 60;
      return 0;
    };
    
    tags.forEach((t) => {
      const s = score(t);
      if (s > 0) results.push({ type: 'tag', value: t, score: s });
    });
    
    moods.forEach((m) => {
      const s = score(m);
      if (s > 0) results.push({ type: 'mood', value: m, score: s });
    });
    
    subjects.forEach((s) => {
      const sc = score(s);
      if (sc > 0) results.push({ type: 'subject', value: s, score: sc });
    });
    
    colors.forEach((c) => {
      const s = score(c);
      if (s > 0) results.push({ type: 'color', value: c, score: s });
    });
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions);
  }, [query, images, maxSuggestions]);
  
  return suggestions;
}
