import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Tag, Palette, Smile, Clock } from 'lucide-react';
import { getAllTags, getAllMoods, mockImages } from '@/data/mockData';

interface SearchSuggestionsProps {
  query: string;
  isVisible: boolean;
  onSelect: (suggestion: string) => void;
  onClose: () => void;
}

interface Suggestion {
  type: 'tag' | 'mood' | 'color' | 'subject' | 'recent';
  value: string;
  label: string;
  category?: string;
}

export function SearchSuggestions({ 
  query, 
  isVisible, 
  onSelect, 
  onClose 
}: SearchSuggestionsProps) {
  const suggestions = useMemo(() => {
    if (!query.trim() || query.length < 2) {
      return getRecentSearches();
    }
    
    const queryLower = query.toLowerCase();
    const results: Suggestion[] = [];
    
    // Search tags
    const allTags = getAllTags();
    const matchingTags = allTags
      .filter((tag) => tag.toLowerCase().includes(queryLower))
      .slice(0, 5)
      .map((tag) => ({
        type: 'tag' as const,
        value: tag,
        label: tag,
      }));
    results.push(...matchingTags);
    
    // Search moods
    const allMoods = getAllMoods();
    const matchingMoods = allMoods
      .filter((mood) => mood.toLowerCase().includes(queryLower))
      .slice(0, 3)
      .map((mood) => ({
        type: 'mood' as const,
        value: mood,
        label: mood,
      }));
    results.push(...matchingMoods);
    
    // Search main subjects
    const subjects = mockImages.map((img) => img.main_subject);
    const matchingSubjects = subjects
      .filter((subject) => subject.toLowerCase().includes(queryLower))
      .slice(0, 3)
      .map((subject) => ({
        type: 'subject' as const,
        value: subject,
        label: subject,
      }));
    results.push(...matchingSubjects);
    
    // Search color names
    const colorNames = new Set<string>();
    mockImages.forEach((img) => {
      Object.keys(img.main_colors).forEach((name) => {
        colorNames.add(name.replace(/_/g, ' '));
      });
    });
    const matchingColors = Array.from(colorNames)
      .filter((color) => color.toLowerCase().includes(queryLower))
      .slice(0, 3)
      .map((color) => ({
        type: 'color' as const,
        value: color,
        label: color,
      }));
    results.push(...matchingColors);
    
    return results.slice(0, 10);
  }, [query]);
  
  const getIcon = (type: Suggestion['type']) => {
    switch (type) {
      case 'tag':
        return <Tag size={14} />;
      case 'mood':
        return <Smile size={14} />;
      case 'color':
        return <Palette size={14} />;
      case 'subject':
        return <Search size={14} />;
      case 'recent':
        return <Clock size={14} />;
    }
  };
  
  const getTypeLabel = (type: Suggestion['type']) => {
    switch (type) {
      case 'tag':
        return 'Tag';
      case 'mood':
        return 'Mood';
      case 'color':
        return 'Color';
      case 'subject':
        return 'Subject';
      case 'recent':
        return 'Recent';
    }
  };
  
  const getTypeColor = (type: Suggestion['type']) => {
    switch (type) {
      case 'tag':
        return 'text-stellar-cyan';
      case 'mood':
        return 'text-stellar-violet';
      case 'color':
        return 'text-stellar-gold';
      case 'subject':
        return 'text-nebula-300';
      case 'recent':
        return 'text-nebula-400';
    }
  };
  
  if (!isVisible || suggestions.length === 0) {
    return null;
  }
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50 shadow-xl"
      >
        <div className="p-2">
          {query.length < 2 && (
            <div className="px-3 py-1 text-[10px] text-nebula-500 uppercase tracking-wider">
              Recent Searches
            </div>
          )}
          
          <ul className="space-y-1">
            {suggestions.map((suggestion, index) => (
              <motion.li
                key={`${suggestion.type}-${suggestion.value}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <button
                  onClick={() => {
                    onSelect(suggestion.value);
                    saveRecentSearch(suggestion.value);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-nebula-700/50 transition-colors text-left"
                >
                  <span className={getTypeColor(suggestion.type)}>
                    {getIcon(suggestion.type)}
                  </span>
                  
                  <span className="flex-1 text-sm text-white">
                    {highlightMatch(suggestion.label, query)}
                  </span>
                  
                  <span className={`text-[10px] ${getTypeColor(suggestion.type)}`}>
                    {getTypeLabel(suggestion.type)}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        </div>
        
        {/* Quick filters */}
        {query.length >= 2 && (
          <div className="border-t border-nebula-800 p-3">
            <div className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2">
              Quick Filters
            </div>
            <div className="flex flex-wrap gap-2">
              <QuickFilterButton
                label={`"${query}" in tags`}
                onClick={() => onSelect(`tag:${query}`)}
              />
              <QuickFilterButton
                label={`"${query}" in mood`}
                onClick={() => onSelect(`mood:${query}`)}
              />
              <QuickFilterButton
                label={`"${query}" in description`}
                onClick={() => onSelect(query)}
              />
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// Helper components

interface QuickFilterButtonProps {
  label: string;
  onClick: () => void;
}

function QuickFilterButton({ label, onClick }: QuickFilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 bg-nebula-800/50 hover:bg-nebula-700 rounded text-[11px] text-nebula-300 transition-colors"
    >
      {label}
    </button>
  );
}

// Highlight matching text
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} className="text-stellar-cyan font-medium">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Local storage for recent searches
const RECENT_SEARCHES_KEY = 'nebula-gallery-recent-searches';
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): Suggestion[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      const searches: string[] = JSON.parse(stored);
      return searches.map((s) => ({
        type: 'recent' as const,
        value: s,
        label: s,
      }));
    }
  } catch {
    // Ignore localStorage errors
  }
  return [];
}

function saveRecentSearch(query: string): void {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    let searches: string[] = stored ? JSON.parse(stored) : [];
    
    // Remove if exists, add to front
    searches = searches.filter((s) => s !== query);
    searches.unshift(query);
    
    // Keep only recent
    searches = searches.slice(0, MAX_RECENT_SEARCHES);
    
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
  } catch {
    // Ignore localStorage errors
  }
}
