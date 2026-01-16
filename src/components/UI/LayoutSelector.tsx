import { useGalleryStore } from '@/stores/galleryStore';
import type { LayoutType } from '@/types/gallery';

const layouts: { type: LayoutType; label: string }[] = [
  { type: 'grid', label: 'Grid' },
  { type: 'network', label: 'Graph' },
  { type: 'colorWheel', label: 'Color' },
  { type: 'moodSpectrum', label: 'Mood' },
  { type: 'cluster', label: 'Groups' },
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
      {layouts.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => handleLayoutChange(type)}
          className={`px-3 py-2 text-sm rounded-lg transition-all text-center ${
            layout.type === type
              ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
              : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
