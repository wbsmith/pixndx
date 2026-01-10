import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Zap, Server, ImageIcon } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import { GridLayout } from '../Layouts/GridLayout';
import { NetworkGraph } from '../Layouts/NetworkGraph';
import { NetworkGraphScalable } from '../Layouts/NetworkGraphScalable';
import { ColorWheel } from '../Layouts/ColorWheel';
import { MoodSpectrum } from '../Layouts/MoodSpectrum';
import { ClusterView } from '../Layouts/ClusterView';
import type { LoadProgress } from '@/lib/dataLoader';

// =============================================================================
// LOADING SKELETON
// =============================================================================

function LoadingSkeleton({ progress }: { progress: LoadProgress | null }) {
  return (
    <motion.div 
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col items-center justify-center gap-6"
    >
      <div className="relative">
        <ImageIcon className="text-stellar-cyan" size={64} />
        <div className="absolute inset-0 text-stellar-cyan blur-xl opacity-30">
          <ImageIcon size={64} />
        </div>
      </div>
      
      <div className="text-center">
        <h2 className="text-xl font-display text-white mb-2">
          Loading Gallery
        </h2>
        {progress && (
          <p className="text-nebula-400 text-sm">
            <span className="text-stellar-cyan font-mono">{progress.loaded}</span>
            {' / '}
            <span className="font-mono">{progress.total}</span>
            {' images'}
          </p>
        )}
      </div>
      
      {/* Skeleton grid preview */}
      <div className="grid grid-cols-4 gap-2 opacity-30">
        {Array.from({ length: 8 }).map((_, i) => (
          <div 
            key={i}
            className="w-16 h-16 rounded-lg bg-nebula-800 animate-pulse"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    </motion.div>
  );
}

// =============================================================================
// GRAPH RENDERING MODE
// =============================================================================

type GraphMode = 'd3' | 'forceAtlas2';

interface GraphModeConfig {
  mode: GraphMode;
  label: string;
  description: string;
  icon: typeof Zap;
}

const GRAPH_MODES: GraphModeConfig[] = [
  {
    mode: 'd3',
    label: 'D3 Force',
    description: 'Animated force simulation - interactive, best for < 500 nodes',
    icon: Zap,
  },
  {
    mode: 'forceAtlas2',
    label: 'ForceAtlas2',
    description: 'Gephi-style layout - better clusters, handles large graphs',
    icon: Server,
  },
];

// =============================================================================
// COMPONENT
// =============================================================================

export function GalleryView() {
  const { layout, filteredImages, graphVersion, loading, loadProgress } = useGalleryStore();
  const [graphMode, setGraphMode] = useState<GraphMode>('d3');
  
  // Render the appropriate network graph based on user selection
  const renderNetworkGraph = () => {
    // Use graphVersion as key to force re-mount when edges change
    const graphKey = `${graphMode}-${graphVersion}`;
    
    switch (graphMode) {
      case 'forceAtlas2':
        return <NetworkGraphScalable key={graphKey} />;
      case 'd3':
      default:
        return <NetworkGraph key={graphKey} />;
    }
  };
  
  const renderLayout = () => {
    // Show skeleton while initial data loads
    if (filteredImages.length === 0 && loading) {
      return <LoadingSkeleton key="loading" progress={loadProgress} />;
    }
    
    // Each layout needs a unique key for AnimatePresence to work correctly
    switch (layout.type) {
      case 'grid':
        return <GridLayout key="grid" />;
      case 'network':
        return renderNetworkGraph();
      case 'colorWheel':
        return <ColorWheel key="colorWheel" />;
      case 'moodSpectrum':
        return <MoodSpectrum key="moodSpectrum" />;
      case 'cluster':
        return <ClusterView key="cluster" />;
      default:
        return <GridLayout key="grid-default" />;
    }
  };
  
  return (
    <div className="flex-1 min-h-0 relative">
      {/* Loading progress bar */}
      {loading && loadProgress && !loadProgress.complete && (
        <div className="absolute top-0 left-0 right-0 z-30 h-1 bg-nebula-800">
          <motion.div 
            className="h-full bg-gradient-to-r from-stellar-cyan to-stellar-violet"
            initial={{ width: 0 }}
            animate={{ width: `${(loadProgress.loaded / loadProgress.total) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}
      
      <AnimatePresence mode="wait">
        {renderLayout()}
      </AnimatePresence>
      
      {/* Graph mode selector - only show for network layout */}
      {layout.type === 'network' && (
        <GraphModeSelector
          mode={graphMode}
          nodeCount={filteredImages.length}
          onChange={setGraphMode}
        />
      )}
    </div>
  );
}

// =============================================================================
// GRAPH MODE SELECTOR
// =============================================================================

interface GraphModeSelectorProps {
  mode: GraphMode;
  nodeCount: number;
  onChange: (mode: GraphMode) => void;
}

function GraphModeSelector({ mode, nodeCount, onChange }: GraphModeSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  
  const currentConfig = GRAPH_MODES.find(m => m.mode === mode);
  
  return (
    <div className="absolute top-4 left-4 z-20">
      <motion.div
        initial={false}
        animate={{ width: expanded ? 300 : 'auto' }}
        className="glass rounded-lg overflow-hidden"
      >
        {/* Collapsed view */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-2 flex items-center gap-2 text-xs hover:bg-nebula-800/50 transition-colors"
        >
          {currentConfig && (
            <>
              <currentConfig.icon size={14} className="text-stellar-cyan" />
              <span className="text-nebula-300">
                Layout: <span className="text-white">{currentConfig.label}</span>
              </span>
            </>
          )}
        </button>
        
        {/* Expanded view */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-nebula-700"
            >
              <div className="p-2 space-y-1">
                {GRAPH_MODES.map((config) => {
                  const isActive = mode === config.mode;
                  
                  return (
                    <button
                      key={config.mode}
                      onClick={() => {
                        onChange(config.mode);
                        setExpanded(false);
                      }}
                      className={`
                        w-full px-3 py-2 rounded text-left text-xs
                        flex items-center gap-2 transition-colors
                        ${isActive 
                          ? 'bg-stellar-cyan/20 text-stellar-cyan' 
                          : 'text-nebula-300 hover:bg-nebula-800/50'
                        }
                      `}
                    >
                      <config.icon size={14} />
                      <div className="flex-1">
                        <span className="font-medium">{config.label}</span>
                        <div className="text-nebula-500 text-[10px]">
                          {config.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              
              <div className="px-3 py-2 border-t border-nebula-700 text-[10px] text-nebula-500">
                {nodeCount} nodes
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
