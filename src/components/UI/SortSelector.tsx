import { Star, Calendar, Shuffle } from 'lucide-react';
import { useGalleryStore, type SortMode } from '@/stores/galleryStore';

const sortModes: { mode: SortMode; icon: typeof Star; label: string }[] = [
  { mode: 'rating', icon: Star, label: 'Rating' },
  { mode: 'date', icon: Calendar, label: 'Date' },
  { mode: 'random', icon: Shuffle, label: 'Random' },
];

export function SortSelector() {
  const { sortMode, setSortMode } = useGalleryStore();

  return (
    <div className="flex gap-2">
      {sortModes.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => setSortMode(mode)}
          title={label}
          className={`flex-1 px-3 py-2 rounded-lg transition-all flex items-center justify-center ${
            sortMode === mode
              ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
              : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
          }`}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
