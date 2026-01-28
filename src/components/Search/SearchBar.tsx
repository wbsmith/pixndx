import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Clock, Star } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import { useRecentSearchStore, type RecentSearch } from '@/stores/recentSearchStore';
import { motion, AnimatePresence } from 'framer-motion';

// Special query constants
const SPECIAL_QUERIES = {
  '__top_rated__': { label: 'Top Rated', icon: Star },
};

export function SearchBar() {
  const {
    searchQuery,
    setSearchQuery,
    layout,
    sortMode,
    similarity,
    forceSettings,
    colorMode,
    filteredImages,
    setLayout,
    setSortMode,
    setSimilarity,
    setForceSettings,
    setColorMode,
  } = useGalleryStore();

  const { addSearch, getRecentSearches } = useRecentSearchStore();

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [focused, setFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Check if we have a special filter active
  const specialFilter = SPECIAL_QUERIES[searchQuery as keyof typeof SPECIAL_QUERIES];

  // Load recent searches when focused
  useEffect(() => {
    if (focused) {
      getRecentSearches().then(setRecentSearches);
    }
  }, [focused, getRecentSearches]);

  // Sync local query with store when store changes externally
  useEffect(() => {
    if (searchQuery === '__top_rated__') {
      setLocalQuery('');
    } else {
      setLocalQuery(searchQuery);
    }
  }, [searchQuery]);

  // Save search with current settings
  const saveSearch = useCallback((query: string) => {
    if (!query.trim() || query.startsWith('__')) return;

    addSearch({
      query,
      layout: layout.type,
      sortMode,
      graphSettings: layout.type === 'network' ? {
        similarity,
        forceSettings,
        colorMode,
      } : undefined,
      resultCount: filteredImages.length,
    });
  }, [addSearch, layout.type, sortMode, similarity, forceSettings, colorMode, filteredImages.length]);

  // Debounced search - only trigger after user stops typing
  const debouncedSearch = useCallback((query: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setSearchQuery(query);
      saveSearch(query);
    }, 400);
  }, [setSearchQuery, saveSearch]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalQuery(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    setLocalQuery('');
    setSearchQuery('');
    setFocused(false);
    inputRef.current?.blur();
  };

  // Restore a recent search with its saved settings
  const handleRecentSearchClick = (recent: RecentSearch) => {
    setLocalQuery(recent.query);
    setSearchQuery(recent.query);

    // Restore layout type
    if (recent.layout !== layout.type) {
      setLayout({ ...layout, type: recent.layout });
    }

    // Restore sort mode
    if (recent.sortMode !== sortMode) {
      setSortMode(recent.sortMode);
    }

    // Restore graph settings if applicable
    if (recent.graphSettings && recent.layout === 'network') {
      setSimilarity(recent.graphSettings.similarity);
      setForceSettings(recent.graphSettings.forceSettings);
      setColorMode(recent.graphSettings.colorMode);
    }

    setFocused(false);
  };

  // Handle Enter key to search immediately
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      setSearchQuery(localQuery);
      saveSearch(localQuery);
      setFocused(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  // Format relative time
  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="relative w-full max-w-xl">
      <div className="relative">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 text-nebula-400"
          size={18}
        />

        {/* Show special filter badge if active */}
        {specialFilter ? (
          <div
            className="search-input pr-10 flex items-center gap-2 cursor-pointer"
            onClick={handleClear}
          >
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-stellar-gold/20 text-stellar-gold rounded-full text-sm font-medium">
              <specialFilter.icon size={14} />
              {specialFilter.label}
            </span>
            <span className="text-nebula-500 text-sm">Click to clear</span>
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            placeholder="Search by description, mood, colors..."
            className="search-input pr-10"
          />
        )}

        {(localQuery || specialFilter) && (
          <button
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-nebula-400 hover:text-nebula-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {focused && !localQuery && recentSearches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50"
          >
            <div className="p-3">
              <div className="flex items-center gap-2 text-xs text-nebula-400 mb-2 px-1">
                <Clock size={12} />
                <span>Recent searches</span>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {recentSearches.map((recent) => (
                  <button
                    key={recent.id}
                    onClick={() => handleRecentSearchClick(recent)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-nebula-200 hover:bg-nebula-800/50 transition-colors text-left"
                  >
                    <span className="truncate">{recent.query}</span>
                    <span className="text-xs text-nebula-500 ml-2 flex-shrink-0">
                      {formatRelativeTime(recent.timestamp)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
