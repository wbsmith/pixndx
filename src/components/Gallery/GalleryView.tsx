import { AnimatePresence } from 'framer-motion';
import { useGalleryStore } from '@/stores/galleryStore';
import { GridLayout } from '../Layouts/GridLayout';
import { NetworkGraph } from '../Layouts/NetworkGraph';
import { ColorWheel } from '../Layouts/ColorWheel';
import { MoodSpectrum } from '../Layouts/MoodSpectrum';
import { ClusterView } from '../Layouts/ClusterView';

export function GalleryView() {
  const { layout } = useGalleryStore();
  
  const renderLayout = () => {
    switch (layout.type) {
      case 'grid':
        return <GridLayout />;
      case 'network':
        return <NetworkGraph />;
      case 'colorWheel':
        return <ColorWheel />;
      case 'moodSpectrum':
        return <MoodSpectrum />;
      case 'cluster':
        return <ClusterView />;
      default:
        return <GridLayout />;
    }
  };
  
  return (
    <div className="flex-1 min-h-0 relative">
      <AnimatePresence mode="wait">
        {renderLayout()}
      </AnimatePresence>
    </div>
  );
}
