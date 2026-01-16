import { Grid3X3, Network, Palette, Activity } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { LayoutType } from '@/types/gallery';

const layouts: { type: LayoutType; icon: typeof Grid3X3; label: string }[] = [
  { type: 'grid', icon: Grid3X3, label: 'Grid' },
  { type: 'network', icon: Network, label: 'Graph' },
  { type: 'colorWheel', icon: Palette, label: 'Color' },
  { type: 'moodSpectrum', icon: Activity, label: 'Mood' },
];

export function LayoutSelector() {
  const { layout, setLayout } = useGalleryStore();

  const handleLayoutChange = (type: LayoutType) => {
    setLayout({
      ...layout,
      type,
    });
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {layouts.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => handleLayoutChange(type)}
          className={`px-3 py-2 text-sm rounded-lg transition-all flex items-center justify-center gap-2 ${
            layout.type === type
              ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
              : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
          }`}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}
