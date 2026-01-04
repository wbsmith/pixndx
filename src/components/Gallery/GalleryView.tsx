import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, Zap, Server } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import { GridLayout } from '../Layouts/GridLayout';
import { NetworkGraph } from '../Layouts/NetworkGraph';
import { NetworkGraphScalable } from '../Layouts/NetworkGraphScalable';
import { NetworkGraphSigma } from '../Layouts/NetworkGraphSigma';
import { ColorWheel } from '../Layouts/ColorWheel';
import { MoodSpectrum } from '../Layouts/MoodSpectrum';
import { ClusterView } from '../Layouts/ClusterView';

// =============================================================================
// GRAPH RENDERING MODE
// =============================================================================

type GraphMode = 'auto' | 'd3' | 'graphology' | 'webgl';

interface GraphModeConfig {
  mode: GraphMode;
  label: string;
  description: string;
  icon: typeof Cpu;
  minNodes: number;
  maxNodes: number;
}

const GRAPH_MODES: GraphModeConfig[] = [
  {
    mode: 'auto',
    label: 'Auto',
    description: 'Automatically select based on node count',
    icon: Zap,
    minNodes: 0,
    maxNodes: Infinity,
  },
  {
    mode: 'd3',
    label: 'D3',
    description: 'Classic D3 force simulation (best < 500 nodes)',
    icon: Cpu,
    minNodes: 0,
    maxNodes: 500,
  },
  {
    mode: 'graphology',
    label: 'ForceAtlas2',
    description: 'Graphology + D3 render (500-5000 nodes)',
    icon: Server,
    minNodes: 200,
    maxNodes: 5000,
  },
  {
    mode: 'webgl',
    label: 'WebGL',
    description: 'Sigma.js GPU rendering (5000+ nodes)',
    icon: Zap,
    minNodes: 2000,
    maxNodes: Infinity,
  },
];

// Thresholds for automatic mode selection
const AUTO_THRESHOLDS = {
  useGraphology: 300,
  useWebGL: 5000,
};

// =============================================================================
// COMPONENT
// =============================================================================

export function GalleryView() {
  const { layout, filteredImages, graphVersion } = useGalleryStore();
  const [graphMode, setGraphMode] = useState<GraphMode>('auto');
  
  // Determine effective graph mode based on node count
  const effectiveMode = useMemo(() => {
    const nodeCount = filteredImages.length;
    
    if (graphMode !== 'auto') {
      return graphMode;
    }
    
    if (nodeCount >= AUTO_THRESHOLDS.useWebGL) {
      return 'webgl';
    } else if (nodeCount >= AUTO_THRESHOLDS.useGraphology) {
      return 'graphology';
    } else {
      return 'd3';
    }
  }, [graphMode, filteredImages.length]);
  
  // Render the appropriate network graph
  const renderNetworkGraph = () => {
    // Use graphVersion as key to force re-mount when edges change
    const graphKey = `${effectiveMode}-${graphVersion}`;
    
    switch (effectiveMode) {
      case 'webgl':
        return <NetworkGraphSigma key={graphKey} />;
      case 'graphology':
        return <NetworkGraphScalable key={graphKey} />;
      case 'd3':
      default:
        return <NetworkGraph key={graphKey} />;
    }
  };
  
  const renderLayout = () => {
    switch (layout.type) {
      case 'grid':
        return <GridLayout />;
      case 'network':
        return renderNetworkGraph();
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
      
      {/* Graph mode selector - only show for network layout */}
      {layout.type === 'network' && (
        <GraphModeSelector
          mode={graphMode}
          effectiveMode={effectiveMode}
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
  effectiveMode: GraphMode;
  nodeCount: number;
  onChange: (mode: GraphMode) => void;
}

function GraphModeSelector({ mode, effectiveMode, nodeCount, onChange }: GraphModeSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  
  const currentConfig = GRAPH_MODES.find(m => m.mode === (mode === 'auto' ? effectiveMode : mode));
  
  return (
    <div className="absolute top-4 left-4 z-20">
      <motion.div
        initial={false}
        animate={{ width: expanded ? 280 : 'auto' }}
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
                Renderer: <span className="text-white">{currentConfig.label}</span>
              </span>
              {mode === 'auto' && (
                <span className="text-nebula-500">(auto)</span>
              )}
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
                  const isRecommended = 
                    config.mode !== 'auto' &&
                    nodeCount >= config.minNodes && 
                    nodeCount <= config.maxNodes;
                  
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{config.label}</span>
                          {isRecommended && config.mode !== 'auto' && (
                            <span className="px-1.5 py-0.5 bg-green-900/50 text-green-400 rounded text-[10px]">
                              recommended
                            </span>
                          )}
                        </div>
                        <div className="text-nebula-500 text-[10px]">
                          {config.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              
              <div className="px-3 py-2 border-t border-nebula-700 text-[10px] text-nebula-500">
                Current: {nodeCount} nodes
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
