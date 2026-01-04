import { useState } from 'react';
import { RotateCcw, Play } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';
import type { SimilarityMode } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

export interface ForceLayoutParams {
  gravity: number;
  scaling: number;
  edgeWeightInfluence: number;
}

export type ColorMode = 'uniform' | 'cluster' | 'community' | 'mood' | 'color';

export interface GraphSettings {
  force: ForceLayoutParams;
  colorMode: ColorMode;
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_FORCE: ForceLayoutParams = {
  gravity: 0.05,
  scaling: 1.0,
  edgeWeightInfluence: 1.0,
};

const PRESETS: Record<string, { threshold: number; maxEdges: number; force?: Partial<ForceLayoutParams> }> = {
  tight: { threshold: 0.7, maxEdges: 10, force: { gravity: 0.15, scaling: 0.5 } },
  loose: { threshold: 0.4, maxEdges: 30, force: { gravity: 0.02, scaling: 2.0 } },
  clusters: { threshold: 0.6, maxEdges: 20, force: { gravity: 0.08, edgeWeightInfluence: 1.5 } },
};

// =============================================================================
// COMPONENT
// =============================================================================

export function SimilaritySlider() {
  const { 
    similarity, 
    setSimilarity, 
    edges, 
    layout,
    filteredImages,
    recomputeEdges,
  } = useGalleryStore();
  
  // Local state for force layout and coloring (not persisted to store)
  const [force, setForce] = useState<ForceLayoutParams>(DEFAULT_FORCE);
  const [colorMode, setColorMode] = useState<ColorMode>('uniform');
  const [hasChanges, setHasChanges] = useState(false);
  
  // Only show for network layouts
  if (layout.type === 'grid') return null;
  
  // Check if CLIP neighbors are available
  const hasClipNeighbors = filteredImages.some(img => img.clipNeighbors && img.clipNeighbors.length > 0);
  
  const handleModeChange = (mode: SimilarityMode) => {
    setSimilarity({ ...similarity, mode });
    setHasChanges(true);
  };
  
  const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimilarity({ ...similarity, threshold: parseFloat(e.target.value) });
    setHasChanges(true);
  };
  
  const handleMaxEdgesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimilarity({ ...similarity, maxEdgesPerNode: parseInt(e.target.value, 10) });
    setHasChanges(true);
  };
  
  const handleForceChange = (key: keyof ForceLayoutParams, value: number) => {
    setForce(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };
  
  const handleApply = () => {
    recomputeEdges();
    setHasChanges(false);
    // Force layout params are passed via a custom event that the graph can listen to
    window.dispatchEvent(new CustomEvent('graph-settings-update', { 
      detail: { force, colorMode } 
    }));
  };
  
  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    if (preset) {
      setSimilarity({
        ...similarity,
        threshold: preset.threshold,
        maxEdgesPerNode: preset.maxEdges,
      });
      if (preset.force) {
        setForce(prev => ({ ...prev, ...preset.force }));
      }
      setHasChanges(true);
    }
  };
  
  const handleReset = () => {
    setSimilarity({
      mode: 'clip',
      threshold: 0.5,
      maxEdgesPerNode: 20,
    });
    setForce(DEFAULT_FORCE);
    setColorMode('uniform');
    setHasChanges(true);
  };
  
  return (
    <div className="space-y-4">
      {/* Similarity Mode */}
      <div>
        <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2 block">
          Similarity Mode
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleModeChange('clip')}
            disabled={!hasClipNeighbors}
            className={`px-3 py-2 text-xs rounded-lg transition-all ${
              similarity.mode === 'clip'
                ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
                : !hasClipNeighbors
                  ? 'bg-nebula-900/50 text-nebula-600 cursor-not-allowed'
                  : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
            }`}
          >
            <div className="font-medium">CLIP</div>
            <div className="text-[9px] opacity-70">Embedding similarity</div>
          </button>
          <button
            onClick={() => handleModeChange('composite')}
            disabled={!hasClipNeighbors}
            className={`px-3 py-2 text-xs rounded-lg transition-all ${
              similarity.mode === 'composite'
                ? 'bg-stellar-violet/20 text-stellar-violet border border-stellar-violet/30'
                : !hasClipNeighbors
                  ? 'bg-nebula-900/50 text-nebula-600 cursor-not-allowed'
                  : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
            }`}
          >
            <div className="font-medium">Composite</div>
            <div className="text-[9px] opacity-70">CLIP + metadata</div>
          </button>
        </div>
        {!hasClipNeighbors && (
          <div className="mt-2 text-[10px] text-yellow-500/80">
            ⚠️ Run compute_neighbors.py for similarity data
          </div>
        )}
      </div>
      
      {/* Edge Threshold */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
            Edge Threshold
          </label>
          <span className="text-[10px] text-stellar-cyan font-mono">
            {(similarity.threshold * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="0.2"
          max="0.9"
          step="0.05"
          value={similarity.threshold}
          onChange={handleThresholdChange}
          className="similarity-slider"
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
            {similarity.maxEdgesPerNode}
          </span>
        </div>
        <input
          type="range"
          min="3"
          max="50"
          step="1"
          value={similarity.maxEdgesPerNode}
          onChange={handleMaxEdgesChange}
          className="similarity-slider"
        />
      </div>
      
      {/* Apply Button */}
      <button
        onClick={handleApply}
        className={`w-full py-2.5 text-sm rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${
          hasChanges 
            ? 'bg-stellar-cyan text-cosmos-void hover:bg-stellar-cyan/90 shadow-lg shadow-stellar-cyan/20' 
            : 'bg-stellar-cyan/20 text-stellar-cyan hover:bg-stellar-cyan/30'
        }`}
      >
        <Play size={14} />
        Apply & Compute Edges
      </button>
      
      {/* Presets */}
      <div className="pt-3 border-t border-nebula-800">
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
            onClick={handleReset}
            className="px-2 py-1 text-[10px] rounded bg-nebula-800/50 text-nebula-400 
                       hover:bg-nebula-700 transition-colors flex items-center gap-1"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        </div>
      </div>
      
      {/* Node Coloring */}
      <div>
        <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-2 block">
          Node Coloring
        </label>
        <div className="grid grid-cols-3 gap-1">
          {(['uniform', 'cluster', 'community', 'mood', 'color'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => { setColorMode(mode); setHasChanges(true); }}
              className={`px-2 py-1.5 text-[10px] rounded transition-colors capitalize ${
                colorMode === mode
                  ? 'bg-stellar-violet/20 text-stellar-violet border border-stellar-violet/30'
                  : 'bg-nebula-800/50 text-nebula-400 hover:bg-nebula-700'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      
      {/* Force Layout */}
      <div className="pt-3 border-t border-nebula-800">
        <label className="text-[10px] text-nebula-500 uppercase tracking-wider mb-3 block">
          Force Layout
        </label>
        
        {/* Gravity */}
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-nebula-400">Gravity</span>
            <span className="text-[10px] text-stellar-cyan font-mono">
              {force.gravity.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0.01"
            max="0.3"
            step="0.01"
            value={force.gravity}
            onChange={(e) => handleForceChange('gravity', parseFloat(e.target.value))}
            className="similarity-slider"
          />
        </div>
        
        {/* Scaling */}
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-nebula-400">Node Spacing</span>
            <span className="text-[10px] text-stellar-cyan font-mono">
              {force.scaling.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.3"
            max="3"
            step="0.1"
            value={force.scaling}
            onChange={(e) => handleForceChange('scaling', parseFloat(e.target.value))}
            className="similarity-slider"
          />
        </div>
        
        {/* Edge Weight Influence */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-nebula-400">Weight Influence</span>
            <span className="text-[10px] text-stellar-cyan font-mono">
              {force.edgeWeightInfluence.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={force.edgeWeightInfluence}
            onChange={(e) => handleForceChange('edgeWeightInfluence', parseFloat(e.target.value))}
            className="similarity-slider"
          />
          <div className="flex justify-between text-[9px] text-nebula-600 mt-0.5">
            <span>Ignore weights</span>
            <span>Strong clustering</span>
          </div>
        </div>
      </div>
      
      {/* Stats */}
      <div className="text-xs text-nebula-400 pt-3 border-t border-nebula-800 space-y-1">
        <div className="flex justify-between">
          <span>Connections</span>
          <span className="text-stellar-cyan font-mono">{edges.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Images</span>
          <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
        </div>
        {edges.length > 0 && filteredImages.length > 0 && (
          <div className="flex justify-between">
            <span>Avg edges/node</span>
            <span className="text-stellar-cyan font-mono">
              {(edges.length * 2 / filteredImages.length).toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
