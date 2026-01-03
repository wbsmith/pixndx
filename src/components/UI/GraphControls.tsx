/**
 * Graph Controls
 * 
 * Extended controls for network graph visualization including:
 * - Force layout parameters (gravity, scaling, iterations)
 * - Edge filtering (threshold, max per node)
 * - Coloring mode (by cluster, community, mood, etc.)
 * - Layout presets
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';

// =============================================================================
// TYPES
// =============================================================================

export interface ForceLayoutParams {
  gravity: number;        // Pull toward center (0-1)
  scaling: number;        // Edge length multiplier
  edgeWeightInfluence: number;  // How much edge weight affects distance
  barnesHutTheta: number; // Barnes-Hut approximation (0.5-1.5)
  iterations: number;     // Layout iterations
}

export interface EdgeFilterParams {
  threshold: number;      // Minimum edge weight (0-1)
  maxEdgesPerNode: number; // Cap edges per node
  showWeakLinks: boolean; // Show low-weight edges as dashed
}

export type ColorMode = 
  | 'uniform'       // Single color
  | 'cluster'       // By HDBSCAN cluster
  | 'community'     // By Louvain community
  | 'mood'          // By mood
  | 'color'         // By dominant color
  | 'rating';       // By user rating (admin mode)

export interface GraphSettings {
  force: ForceLayoutParams;
  edges: EdgeFilterParams;
  colorMode: ColorMode;
}

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_SETTINGS: GraphSettings = {
  force: {
    gravity: 0.05,
    scaling: 1.0,
    edgeWeightInfluence: 1.0,
    barnesHutTheta: 0.8,
    iterations: 300,
  },
  edges: {
    threshold: 0.6,
    maxEdgesPerNode: 20,
    showWeakLinks: false,
  },
  colorMode: 'uniform',
};

const PRESETS: Record<string, Partial<GraphSettings>> = {
  tight: {
    force: { ...DEFAULT_SETTINGS.force, gravity: 0.15, scaling: 0.5 },
    edges: { ...DEFAULT_SETTINGS.edges, threshold: 0.8, maxEdgesPerNode: 10 },
  },
  loose: {
    force: { ...DEFAULT_SETTINGS.force, gravity: 0.02, scaling: 2.0 },
    edges: { ...DEFAULT_SETTINGS.edges, threshold: 0.5, maxEdgesPerNode: 30 },
  },
  clusters: {
    force: { ...DEFAULT_SETTINGS.force, gravity: 0.08, edgeWeightInfluence: 1.5 },
    edges: { ...DEFAULT_SETTINGS.edges, threshold: 0.7 },
    colorMode: 'cluster',
  },
  communities: {
    force: { ...DEFAULT_SETTINGS.force, gravity: 0.1 },
    edges: { ...DEFAULT_SETTINGS.edges, threshold: 0.65 },
    colorMode: 'community',
  },
};

// =============================================================================
// COMPONENT
// =============================================================================

interface GraphControlsProps {
  settings: GraphSettings;
  onChange: (settings: GraphSettings) => void;
  onRestart?: () => void;  // Restart layout simulation
}

export function GraphControls({ settings, onChange, onRestart }: GraphControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const { layout } = useGalleryStore();
  
  // Only show for network layouts
  if (layout.type !== 'network') return null;
  
  const updateForce = (key: keyof ForceLayoutParams, value: number) => {
    onChange({
      ...settings,
      force: { ...settings.force, [key]: value },
    });
  };
  
  const updateEdges = (key: keyof EdgeFilterParams, value: number | boolean) => {
    onChange({
      ...settings,
      edges: { ...settings.edges, [key]: value },
    });
  };
  
  const applyPreset = (presetName: string) => {
    const preset = PRESETS[presetName];
    if (preset) {
      onChange({
        ...settings,
        ...preset,
        force: { ...settings.force, ...preset.force },
        edges: { ...settings.edges, ...preset.edges },
      });
      onRestart?.();
    }
  };
  
  return (
    <div className="absolute top-4 right-4 z-20">
      <motion.div
        initial={false}
        animate={{ width: expanded ? 300 : 'auto' }}
        className="glass rounded-lg overflow-hidden"
      >
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-nebula-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-stellar-violet" />
            <span className="text-nebula-300">Graph Settings</span>
          </div>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        
        {/* Expanded panel */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-nebula-700"
            >
              <div className="p-3 space-y-4 max-h-[60vh] overflow-y-auto">
                
                {/* Presets */}
                <div>
                  <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2 block">
                    Presets
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(PRESETS).map((name) => (
                      <button
                        key={name}
                        onClick={() => applyPreset(name)}
                        className="px-2 py-1 text-[10px] rounded bg-nebula-800/50 text-nebula-300 
                                   hover:bg-stellar-violet/20 hover:text-stellar-violet transition-colors capitalize"
                      >
                        {name}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        onChange(DEFAULT_SETTINGS);
                        onRestart?.();
                      }}
                      className="px-2 py-1 text-[10px] rounded bg-nebula-800/50 text-nebula-400 
                                 hover:bg-nebula-700 transition-colors flex items-center gap-1"
                    >
                      <RotateCcw size={10} />
                      Reset
                    </button>
                  </div>
                </div>
                
                {/* Color Mode */}
                <div>
                  <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2 block">
                    Node Coloring
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['uniform', 'cluster', 'community', 'mood', 'color', 'rating'] as ColorMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => onChange({ ...settings, colorMode: mode })}
                        className={`px-2 py-1.5 text-[10px] rounded transition-colors capitalize
                          ${settings.colorMode === mode
                            ? 'bg-stellar-violet/20 text-stellar-violet border border-stellar-violet/30'
                            : 'bg-nebula-800/50 text-nebula-400 hover:bg-nebula-700'
                          }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Edge Threshold */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
                      Edge Threshold
                    </label>
                    <span className="text-[10px] text-stellar-cyan font-mono">
                      {(settings.edges.threshold * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="0.95"
                    step="0.05"
                    value={settings.edges.threshold}
                    onChange={(e) => updateEdges('threshold', parseFloat(e.target.value))}
                    className="similarity-slider w-full"
                  />
                  <div className="flex justify-between text-[9px] text-nebula-600 mt-0.5">
                    <span>More edges</span>
                    <span>Fewer edges</span>
                  </div>
                </div>
                
                {/* Max Edges Per Node */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
                      Max Edges/Node
                    </label>
                    <span className="text-[10px] text-stellar-cyan font-mono">
                      {settings.edges.maxEdgesPerNode}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="50"
                    step="1"
                    value={settings.edges.maxEdgesPerNode}
                    onChange={(e) => updateEdges('maxEdgesPerNode', parseInt(e.target.value))}
                    className="similarity-slider w-full"
                  />
                </div>
                
                {/* Force Layout Controls */}
                <div className="pt-2 border-t border-nebula-800">
                  <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2 block">
                    Force Layout
                  </label>
                  
                  {/* Gravity */}
                  <div className="mb-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-nebula-400">Gravity</span>
                      <span className="text-[10px] text-stellar-cyan font-mono">
                        {settings.force.gravity.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="0.3"
                      step="0.01"
                      value={settings.force.gravity}
                      onChange={(e) => updateForce('gravity', parseFloat(e.target.value))}
                      className="similarity-slider w-full"
                    />
                  </div>
                  
                  {/* Scaling */}
                  <div className="mb-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-nebula-400">Node Spacing</span>
                      <span className="text-[10px] text-stellar-cyan font-mono">
                        {settings.force.scaling.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="3"
                      step="0.1"
                      value={settings.force.scaling}
                      onChange={(e) => updateForce('scaling', parseFloat(e.target.value))}
                      className="similarity-slider w-full"
                    />
                  </div>
                  
                  {/* Edge Weight Influence */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-nebula-400">Weight Influence</span>
                      <span className="text-[10px] text-stellar-cyan font-mono">
                        {settings.force.edgeWeightInfluence.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.force.edgeWeightInfluence}
                      onChange={(e) => updateForce('edgeWeightInfluence', parseFloat(e.target.value))}
                      className="similarity-slider w-full"
                    />
                    <div className="flex justify-between text-[9px] text-nebula-600 mt-0.5">
                      <span>Ignore weights</span>
                      <span>Strong clustering</span>
                    </div>
                  </div>
                </div>
                
                {/* Restart button */}
                {onRestart && (
                  <button
                    onClick={onRestart}
                    className="w-full py-2 text-xs rounded bg-stellar-violet/20 text-stellar-violet
                               hover:bg-stellar-violet/30 transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={12} />
                    Restart Layout
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// =============================================================================
// HOOK
// =============================================================================

import { useCallback } from 'react';

/**
 * Hook to manage graph settings state
 */
export function useGraphSettings() {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);
  
  const updateSettings = useCallback((newSettings: GraphSettings) => {
    setSettings(newSettings);
  }, []);
  
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);
  
  return {
    settings,
    updateSettings,
    resetSettings,
  };
}

