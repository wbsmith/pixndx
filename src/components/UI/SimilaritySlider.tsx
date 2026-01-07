import { useState, useMemo, useCallback, useEffect } from 'react';
import { RotateCcw, Play } from 'lucide-react';
import { useGalleryStore, DEFAULT_FORCE_SETTINGS, type ForceSettings, type ColorMode } from '@/stores/galleryStore';
import { computeEdgeStats, type EdgeStats } from '@/lib/similarity/edgeComputation';
import type { SimilarityMode } from '@/types/gallery';

// =============================================================================
// TYPES
// =============================================================================

// =============================================================================
// PRESETS
// =============================================================================

const PRESETS: Record<string, { thresholdMin: number; thresholdMax: number; maxEdges: number; force?: Partial<ForceSettings> }> = {
  tight: { thresholdMin: 0.7, thresholdMax: 1.0, maxEdges: 10, force: { gravity: 0.15, scaling: 0.5 } },
  loose: { thresholdMin: 0.3, thresholdMax: 1.0, maxEdges: 30, force: { gravity: 0.02, scaling: 2.0 } },
  clusters: { thresholdMin: 0.5, thresholdMax: 0.85, maxEdges: 20, force: { gravity: 0.08, edgeWeightInfluence: 1.5 } },
};

// =============================================================================
// DUAL RANGE SLIDER COMPONENT
// =============================================================================

interface DualRangeSliderProps {
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (value: number) => void;
  onChangeMax: (value: number) => void;
  dataMin?: number;  // Actual min from data
  dataMax?: number;  // Actual max from data
}

function DualRangeSlider({ 
  min, max, step, valueMin, valueMax, onChangeMin, onChangeMax, dataMin, dataMax 
}: DualRangeSliderProps) {
  const range = max - min;
  const leftPercent = ((valueMin - min) / range) * 100;
  const rightPercent = ((valueMax - min) / range) * 100;
  
  return (
    <div className="relative h-8 pt-2">
      {/* Track background */}
      <div className="absolute top-4 left-0 right-0 h-2 rounded-full bg-nebula-800" />
      
      {/* Active range highlight */}
      <div 
        className="absolute top-4 h-2 bg-gradient-to-r from-stellar-cyan to-stellar-violet rounded-full"
        style={{ left: `${leftPercent}%`, right: `${100 - rightPercent}%` }}
      />
      
      {/* Data range indicators (if available) */}
      {dataMin !== undefined && (
        <div 
          className="absolute top-3 w-0.5 h-4 bg-yellow-500/50"
          style={{ left: `${((dataMin - min) / range) * 100}%` }}
          title={`Data min: ${dataMin.toFixed(2)}`}
        />
      )}
      {dataMax !== undefined && (
        <div 
          className="absolute top-3 w-0.5 h-4 bg-yellow-500/50"
          style={{ left: `${((dataMax - min) / range) * 100}%` }}
          title={`Data max: ${dataMax.toFixed(2)}`}
        />
      )}
      
      {/* Min slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valueMin}
        onChange={(e) => {
          const newVal = parseFloat(e.target.value);
          if (newVal < valueMax) onChangeMin(newVal);
        }}
        className="absolute top-2 w-full h-6 appearance-none bg-transparent pointer-events-none
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:pointer-events-auto
          [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-stellar-cyan
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cosmos-void
          [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing
          [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-stellar-cyan/30
          [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform
          [&::-moz-range-thumb]:pointer-events-auto
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:bg-stellar-cyan
          [&::-moz-range-thumb]:cursor-grab"
        style={{ zIndex: valueMin > max - range * 0.1 ? 2 : 1 }}
      />
      
      {/* Max slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valueMax}
        onChange={(e) => {
          const newVal = parseFloat(e.target.value);
          if (newVal > valueMin) onChangeMax(newVal);
        }}
        className="absolute top-2 w-full h-6 appearance-none bg-transparent pointer-events-none
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:pointer-events-auto
          [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-stellar-violet
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-cosmos-void
          [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing
          [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-stellar-violet/30
          [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:transition-transform
          [&::-moz-range-thumb]:pointer-events-auto
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:bg-stellar-violet
          [&::-moz-range-thumb]:cursor-grab"
        style={{ zIndex: 1 }}
      />
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SimilaritySlider() {
  const { 
    similarity, 
    setSimilarity, 
    edges, 
    layout,
    filteredImages,
    recomputeEdges,
    forceSettings,
    setForceSettings,
    colorMode,
    setColorMode,
  } = useGalleryStore();
  
  const [hasChanges, setHasChanges] = useState(false);
  
  // Compute edge statistics for current image set
  const edgeStats = useMemo<EdgeStats | null>(() => {
    if (filteredImages.length === 0) return null;
    return computeEdgeStats(filteredImages, similarity.mode);
  }, [filteredImages, similarity.mode]);
  
  // Check if CLIP neighbors are available
  const hasClipNeighbors = useMemo(() => {
    return filteredImages.some(img => img.clipNeighbors && img.clipNeighbors.length > 0);
  }, [filteredImages]);
  
  // Track if we've initialized thresholdMin from edge stats
  const [initializedThreshold, setInitializedThreshold] = useState(false);
  
  // Set initial thresholdMin to min edge weight when stats first become available
  useEffect(() => {
    if (edgeStats && !initializedThreshold && edgeStats.min > 0) {
      // Get current similarity from store to avoid stale closures
      const currentSimilarity = useGalleryStore.getState().similarity;
      console.log(`[SimilaritySlider] Setting initial thresholdMin to ${edgeStats.min.toFixed(2)}`);
      setSimilarity({ ...currentSimilarity, thresholdMin: edgeStats.min });
      setInitializedThreshold(true);
    }
  }, [edgeStats, initializedThreshold, setSimilarity]);
  
  // Callbacks must be defined before any early returns (React hooks rule)
  const handleThresholdMinChange = useCallback((value: number) => {
    setSimilarity({ ...similarity, thresholdMin: value });
    setHasChanges(true);
  }, [similarity, setSimilarity]);
  
  const handleThresholdMaxChange = useCallback((value: number) => {
    setSimilarity({ ...similarity, thresholdMax: value });
    setHasChanges(true);
  }, [similarity, setSimilarity]);
  
  // Only show for network layouts - AFTER all hooks
  if (layout.type === 'grid') return null;
  
  const handleModeChange = (mode: SimilarityMode) => {
    setSimilarity({ ...similarity, mode });
    setHasChanges(true);
  };
  
  const handleMaxEdgesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimilarity({ ...similarity, maxEdgesPerNode: parseInt(e.target.value, 10) });
    setHasChanges(true);
  };
  
  const handleForceChange = (key: keyof ForceSettings, value: number) => {
    setForceSettings({ ...forceSettings, [key]: value });
    setHasChanges(true);
  };
  
  const handleApply = () => {
    recomputeEdges();
    setHasChanges(false);
  };
  
  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    if (preset) {
    setSimilarity({
      ...similarity,
        thresholdMin: preset.thresholdMin,
        thresholdMax: preset.thresholdMax,
        maxEdgesPerNode: preset.maxEdges,
    });
      if (preset.force) {
        setForceSettings({ ...forceSettings, ...preset.force });
      }
      setHasChanges(true);
    }
  };
  
  const handleReset = () => {
    setSimilarity({
      mode: 'clip',
      thresholdMin: edgeStats?.min ?? 0.3,
      thresholdMax: 1.0,
      maxEdgesPerNode: 20,
    });
    setForceSettings(DEFAULT_FORCE_SETTINGS);
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
      
      {/* Edge Weight Range */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-[10px] text-nebula-500 uppercase tracking-wider">
            Edge Weight Range
          </label>
          <span className="text-[10px] font-mono">
            <span className="text-stellar-cyan">{similarity.thresholdMin.toFixed(2)}</span>
            <span className="text-nebula-500"> – </span>
            <span className="text-stellar-violet">{similarity.thresholdMax.toFixed(2)}</span>
          </span>
        </div>
        
        <DualRangeSlider
          min={0}
          max={1}
          step={0.05}
          valueMin={similarity.thresholdMin}
          valueMax={similarity.thresholdMax}
          onChangeMin={handleThresholdMinChange}
          onChangeMax={handleThresholdMaxChange}
          dataMin={edgeStats?.min}
          dataMax={edgeStats?.max}
        />
        
        <div className="flex justify-between text-[9px] text-nebula-600 mt-1">
          <span>0.00</span>
          <span>1.00</span>
        </div>
      </div>
      
      {/* Edge Statistics */}
      {edgeStats && (
        <div className="bg-nebula-900/50 rounded-lg p-3 text-[10px]">
          <div className="text-nebula-500 uppercase tracking-wider mb-2">
            Weight Distribution ({edgeStats.totalPotential.toLocaleString()} edges)
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div>
              <div className="text-nebula-400">Min</div>
              <div className="text-stellar-cyan font-mono">{edgeStats.min.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-nebula-400">Max</div>
              <div className="text-stellar-cyan font-mono">{edgeStats.max.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-nebula-400">Mean</div>
              <div className="text-stellar-cyan font-mono">{edgeStats.mean.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-nebula-400">Med</div>
              <div className="text-stellar-cyan font-mono">{edgeStats.median.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-nebula-400">σ</div>
              <div className="text-stellar-cyan font-mono">{edgeStats.stdDev.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}
      
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
              {forceSettings.gravity.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0.01"
            max="0.3"
            step="0.01"
            value={forceSettings.gravity}
            onChange={(e) => handleForceChange('gravity', parseFloat(e.target.value))}
            className="similarity-slider"
          />
        </div>
        
        {/* Scaling */}
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-nebula-400">Node Spacing</span>
            <span className="text-[10px] text-stellar-cyan font-mono">
              {forceSettings.scaling.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.3"
            max="3"
            step="0.1"
            value={forceSettings.scaling}
            onChange={(e) => handleForceChange('scaling', parseFloat(e.target.value))}
            className="similarity-slider"
          />
        </div>
        
        {/* Edge Weight Influence */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-nebula-400">Weight Influence</span>
            <span className="text-[10px] text-stellar-cyan font-mono">
              {forceSettings.edgeWeightInfluence.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={forceSettings.edgeWeightInfluence}
            onChange={(e) => handleForceChange('edgeWeightInfluence', parseFloat(e.target.value))}
            className="similarity-slider"
          />
          <div className="flex justify-between text-[9px] text-nebula-600 mt-0.5">
            <span>Ignore weights</span>
            <span>Strong clustering</span>
          </div>
        </div>
      </div>
      
      {/* Current Graph Stats */}
      <div className="text-xs text-nebula-400 pt-3 border-t border-nebula-800 space-y-1">
        <div className="text-nebula-500 uppercase tracking-wider text-[10px] mb-2">
          Current Graph
        </div>
        <div className="flex justify-between">
          <span>Images</span>
          <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Edges</span>
          <span className="text-stellar-cyan font-mono">{edges.length.toLocaleString()}</span>
        </div>
        {edges.length > 0 && filteredImages.length > 0 && (
          <>
            <div className="flex justify-between">
              <span>Avg edges/node</span>
              <span className="text-stellar-cyan font-mono">
                {(edges.length * 2 / filteredImages.length).toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Weight range</span>
              <span className="text-stellar-cyan font-mono">
                {Math.min(...edges.map(e => e.weight)).toFixed(2)} – {Math.max(...edges.map(e => e.weight)).toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
