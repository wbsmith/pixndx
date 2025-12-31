import { Grid3X3, Network, Palette, Activity, Clock, Layers } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { LayoutType } from '@/types/gallery';

const layouts: { type: LayoutType; icon: typeof Grid3X3; label: string }[] = [
  { type: 'grid', icon: Grid3X3, label: 'Grid' },
  { type: 'network', icon: Network, label: 'Network' },
  { type: 'colorWheel', icon: Palette, label: 'Colors' },
  { type: 'moodSpectrum', icon: Activity, label: 'Mood' },
  { type: 'cluster', icon: Layers, label: 'Clusters' },
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
    <div className="flex items-center gap-2">
      {layouts.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => handleLayoutChange(type)}
          className={`layout-btn flex items-center gap-2 ${
            layout.type === type ? 'active' : ''
          }`}
          title={label}
        >
          <Icon size={16} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
