import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import { getAllTags, getTagCategories, getAllMoods } from '@/data/mockData';

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FilterPanel({ isOpen, onClose }: FilterPanelProps) {
  const { searchFilters, setSearchFilters, performSearch } = useGalleryStore();
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tags: true,
    mood: true,
    colors: false,
    date: false,
  });
  
  const allTags = useMemo(() => getAllTags(), []);
  const tagCategories = useMemo(() => getTagCategories(), []);
  const allMoods = useMemo(() => getAllMoods(), []);
  
  // Color filter options
  const colorOptions = [
    { name: 'Warm', value: 'warm', color: '#F59E0B' },
    { name: 'Cool', value: 'cool', color: '#3B82F6' },
    { name: 'Red', value: 'red', color: '#EF4444' },
    { name: 'Orange', value: 'orange', color: '#F97316' },
    { name: 'Yellow', value: 'yellow', color: '#EAB308' },
    { name: 'Green', value: 'green', color: '#22C55E' },
    { name: 'Blue', value: 'blue', color: '#3B82F6' },
    { name: 'Purple', value: 'purple', color: '#A855F7' },
    { name: 'Pink', value: 'pink', color: '#EC4899' },
  ];
  
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };
  
  const toggleTagFilter = (tag: string) => {
    const currentTags = searchFilters?.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];
    
    setSearchFilters({
      ...searchFilters,
      tags: newTags.length > 0 ? newTags : undefined,
    });
    performSearch();
  };
  
  const toggleMoodFilter = (mood: string) => {
    const currentMoods = searchFilters?.mood || [];
    const newMoods = currentMoods.includes(mood)
      ? currentMoods.filter((m) => m !== mood)
      : [...currentMoods, mood];
    
    setSearchFilters({
      ...searchFilters,
      mood: newMoods.length > 0 ? newMoods : undefined,
    });
    performSearch();
  };
  
  const toggleColorFilter = (color: string) => {
    const currentColors = searchFilters?.colors || [];
    const newColors = currentColors.includes(color)
      ? currentColors.filter((c) => c !== color)
      : [...currentColors, color];
    
    setSearchFilters({
      ...searchFilters,
      colors: newColors.length > 0 ? newColors : undefined,
    });
    performSearch();
  };
  
  const clearAllFilters = () => {
    setSearchFilters(undefined);
    performSearch();
  };
  
  const hasActiveFilters = 
    (searchFilters?.tags?.length ?? 0) > 0 ||
    (searchFilters?.mood?.length ?? 0) > 0 ||
    (searchFilters?.colors?.length ?? 0) > 0;
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={onClose}
          />
          
          {/* Panel */}
          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: 'spring', damping: 25 }}
            className="fixed left-0 top-0 bottom-0 w-80 glass z-50 overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-nebula-800">
              <div className="flex items-center gap-2">
                <Filter size={20} className="text-stellar-cyan" />
                <h2 className="font-display font-bold text-white">Filters</h2>
              </div>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-nebula-400 hover:text-white transition-colors"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1 rounded hover:bg-nebula-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* Filter sections */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Tags section */}
              <FilterSection
                title="Tags"
                isExpanded={expandedSections.tags}
                onToggle={() => toggleSection('tags')}
                count={searchFilters?.tags?.length}
              >
                <div className="space-y-3">
                  {tagCategories.map((category) => (
                    <div key={category}>
                      <div className="text-[10px] text-nebula-500 uppercase tracking-wider mb-1">
                        {category}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {allTags
                          .filter((_tag) => {
                            // This is a simplified check - in production you'd have proper category mapping
                            return true;
                          })
                          .slice(0, 8)
                          .map((tag) => (
                            <FilterChip
                              key={tag}
                              label={tag}
                              isActive={searchFilters?.tags?.includes(tag) ?? false}
                              onClick={() => toggleTagFilter(tag)}
                            />
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </FilterSection>
              
              {/* Mood section */}
              <FilterSection
                title="Mood"
                isExpanded={expandedSections.mood}
                onToggle={() => toggleSection('mood')}
                count={searchFilters?.mood?.length}
              >
                <div className="flex flex-wrap gap-1">
                  {allMoods.slice(0, 12).map((mood) => (
                    <FilterChip
                      key={mood}
                      label={mood}
                      isActive={searchFilters?.mood?.includes(mood) ?? false}
                      onClick={() => toggleMoodFilter(mood)}
                      variant="mood"
                    />
                  ))}
                </div>
              </FilterSection>
              
              {/* Colors section */}
              <FilterSection
                title="Colors"
                isExpanded={expandedSections.colors}
                onToggle={() => toggleSection('colors')}
                count={searchFilters?.colors?.length}
              >
                <div className="grid grid-cols-3 gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => toggleColorFilter(color.value)}
                      className={`
                        flex items-center gap-2 p-2 rounded-lg transition-all
                        ${searchFilters?.colors?.includes(color.value)
                          ? 'bg-nebula-700 ring-1 ring-stellar-cyan'
                          : 'bg-nebula-800/50 hover:bg-nebula-700'
                        }
                      `}
                    >
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-xs text-nebula-200">{color.name}</span>
                    </button>
                  ))}
                </div>
              </FilterSection>
              
              {/* Date section */}
              <FilterSection
                title="Date Range"
                isExpanded={expandedSections.date}
                onToggle={() => toggleSection('date')}
              >
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
                      From
                    </label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 bg-nebula-800/50 border border-nebula-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-stellar-cyan"
                      onChange={(e) => {
                        setSearchFilters({
                          ...searchFilters,
                          dateRange: {
                            start: e.target.value,
                            end: searchFilters?.dateRange?.end || '',
                          },
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
                      To
                    </label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 bg-nebula-800/50 border border-nebula-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-stellar-cyan"
                      onChange={(e) => {
                        setSearchFilters({
                          ...searchFilters,
                          dateRange: {
                            start: searchFilters?.dateRange?.start || '',
                            end: e.target.value,
                          },
                        });
                      }}
                    />
                  </div>
                </div>
              </FilterSection>
            </div>
            
            {/* Active filters summary */}
            {hasActiveFilters && (
              <div className="p-4 border-t border-nebula-800">
                <div className="text-xs text-nebula-400 mb-2">Active filters:</div>
                <div className="flex flex-wrap gap-1">
                  {searchFilters?.tags?.map((tag) => (
                    <ActiveFilterBadge
                      key={`tag-${tag}`}
                      label={tag}
                      onRemove={() => toggleTagFilter(tag)}
                    />
                  ))}
                  {searchFilters?.mood?.map((mood) => (
                    <ActiveFilterBadge
                      key={`mood-${mood}`}
                      label={mood}
                      onRemove={() => toggleMoodFilter(mood)}
                    />
                  ))}
                  {searchFilters?.colors?.map((color) => (
                    <ActiveFilterBadge
                      key={`color-${color}`}
                      label={color}
                      onRemove={() => toggleColorFilter(color)}
                    />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Sub-components

interface FilterSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  count?: number;
  children: React.ReactNode;
}

function FilterSection({ title, isExpanded, onToggle, count, children }: FilterSectionProps) {
  return (
    <div className="border border-nebula-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-nebula-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{title}</span>
          {count && count > 0 && (
            <span className="px-1.5 py-0.5 bg-stellar-cyan/20 text-stellar-cyan text-[10px] rounded-full">
              {count}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={16} className="text-nebula-400" />
        ) : (
          <ChevronDown size={16} className="text-nebula-400" />
        )}
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  variant?: 'default' | 'mood';
}

function FilterChip({ label, isActive, onClick, variant = 'default' }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-2 py-1 rounded-full text-[11px] transition-all
        ${isActive
          ? variant === 'mood'
            ? 'bg-stellar-violet/30 text-stellar-violet ring-1 ring-stellar-violet'
            : 'bg-stellar-cyan/30 text-stellar-cyan ring-1 ring-stellar-cyan'
          : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700'
        }
      `}
    >
      {label}
    </button>
  );
}

interface ActiveFilterBadgeProps {
  label: string;
  onRemove: () => void;
}

function ActiveFilterBadge({ label, onRemove }: ActiveFilterBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-stellar-cyan/20 text-stellar-cyan text-[10px] rounded-full">
      {label}
      <button onClick={onRemove} className="hover:text-white">
        <X size={10} />
      </button>
    </span>
  );
}
