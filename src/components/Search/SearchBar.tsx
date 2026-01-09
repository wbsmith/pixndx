import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Sparkles, Star } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import { motion, AnimatePresence } from 'framer-motion';

// Special query constants
const SPECIAL_QUERIES = {
  '__top_rated__': { label: 'Top Rated', icon: Star },
};

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useGalleryStore();
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [focused, setFocused] = useState(false);
  const [_suggestions, _setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Check if we have a special filter active
  const specialFilter = SPECIAL_QUERIES[searchQuery as keyof typeof SPECIAL_QUERIES];
  
  // Sync local query with store when store changes externally
  // Handle special queries like __top_rated__ for display
  useEffect(() => {
    if (searchQuery === '__top_rated__') {
      setLocalQuery(''); // Don't show internal query in input
    } else {
      setLocalQuery(searchQuery);
    }
  }, [searchQuery]);
  
  // Debounced search - only trigger after user stops typing
  const debouncedSearch = useCallback((query: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      setSearchQuery(query);
    }, 400); // Wait 400ms after last keystroke
  }, [setSearchQuery]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalQuery(value); // Update input immediately
    debouncedSearch(value); // Debounce the actual search
  };
  
  const handleClear = () => {
    setLocalQuery('');
    setSearchQuery('');
    inputRef.current?.focus();
  };
  
  const handleSuggestionClick = (suggestion: string) => {
    setLocalQuery(suggestion);
    setSearchQuery(suggestion);
    _setSuggestions([]);
  };
  
  // Handle Enter key to search immediately
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      setSearchQuery(localQuery);
    }
  };
  
  const exampleQueries = [
    'sunset',
    'ocean', 
    'mountains',
    'city',
  ];
  
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
        {focused && !localQuery && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50"
          >
            <div className="p-4">
              <div className="flex items-center gap-2 text-xs text-nebula-400 mb-3">
                <Sparkles size={12} />
                <span>Try searching for</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {exampleQueries.map((query) => (
                  <button
                    key={query}
                    onClick={() => handleSuggestionClick(query)}
                    className="tag-pill hover:glow-sm"
                  >
                    {query}
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
