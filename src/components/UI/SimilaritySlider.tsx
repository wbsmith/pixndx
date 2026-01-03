import { useGalleryStore } from '@/stores/galleryStore';
import type { SimilarityMode } from '@/types/gallery';

const modes: { value: SimilarityMode; label: string; description: string }[] = [
  { value: 'composite', label: 'Combined', description: 'CLIP + metadata blend' },
  { value: 'full', label: 'CLIP Only', description: 'Visual similarity from AI' },
  { value: 'tags', label: 'Tags', description: 'Shared keywords' },
  { value: 'mood', label: 'Mood', description: 'Atmospheric similarity' },
  { value: 'colors', label: 'Colors', description: 'Color palette match' },
  { value: 'description', label: 'Description', description: 'Text content overlap' },
];

export function SimilaritySlider() {
  const { 
    similarity, 
    setSimilarity, 
    edgeParams, 
    setEdgeParams,
    edges, 
    layout,
    filteredImages,
  } = useGalleryStore();
  
  // Only show for network layouts
  if (layout.type === 'grid') return null;
  
  const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimilarity({
      ...similarity,
      threshold: parseFloat(e.target.value),
    });
  };
  
  const handleMaxEdgesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEdgeParams({
      maxEdgesPerNode: parseInt(e.target.value, 10),
    });
  };
  
  const handleModeChange = (mode: SimilarityMode) => {
    setSimilarity({
      ...similarity,
      mode,
    });
  };
  
  // Check if CLIP neighbors are available
  const hasClipNeighbors = filteredImages.some(img => img.clipNeighbors && img.clipNeighbors.length > 0);
  
  return (
    <div className="glass rounded-xl p-4 space-y-4">
      {/* Similarity Mode */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-nebula-300">Similarity Mode</label>
        </div>
        <div className="flex flex-wrap gap-2">
          {modes.map(({ value, label, description }) => {
            // Disable CLIP-based modes if no neighbors available
            const needsClip = value === 'composite' || value === 'full';
            const disabled = needsClip && !hasClipNeighbors;
            
            return (
              <button
                key={value}
                onClick={() => !disabled && handleModeChange(value)}
                disabled={disabled}
                title={disabled ? 'Run compute_neighbors.py first' : description}
                className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                  similarity.mode === value
                    ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
                    : disabled
                      ? 'bg-nebula-900/50 text-nebula-600 cursor-not-allowed'
                      : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {!hasClipNeighbors && (
          <div className="mt-2 text-[10px] text-yellow-500/80">
            ⚠️ CLIP neighbors not found. Run preprocessing for visual similarity.
          </div>
        )}
      </div>
      
      {/* Connection Threshold */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-nebula-300">Connection Threshold</label>
          <span className="text-xs text-stellar-cyan font-mono">
            {(similarity.threshold * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="0.3"
          max="0.95"
          step="0.05"
          value={similarity.threshold}
          onChange={handleThresholdChange}
          className="similarity-slider"
        />
        <div className="flex justify-between text-xs text-nebula-500 mt-1">
          <span>More connections</span>
          <span>Fewer connections</span>
        </div>
      </div>
      
      {/* Max Edges Per Node */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-nebula-300">Max Edges / Node</label>
          <span className="text-xs text-stellar-cyan font-mono">
            {edgeParams.maxEdgesPerNode}
          </span>
        </div>
        <input
          type="range"
          min="3"
          max="50"
          step="1"
          value={edgeParams.maxEdgesPerNode}
          onChange={handleMaxEdgesChange}
          className="similarity-slider"
        />
        <div className="flex justify-between text-xs text-nebula-500 mt-1">
          <span>Sparse</span>
          <span>Dense</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="text-xs text-nebula-400 pt-2 border-t border-nebula-800 space-y-1">
        <div className="flex justify-between">
          <span>Connections</span>
          <span className="text-stellar-cyan font-mono">{edges.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Images</span>
          <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
        </div>
        {edges.length > 0 && (
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
