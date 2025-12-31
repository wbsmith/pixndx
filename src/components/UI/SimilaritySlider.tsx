import { useGalleryStore } from '@/stores/galleryStore';
import type { SimilarityMode } from '@/types/gallery';

const modes: { value: SimilarityMode; label: string }[] = [
  { value: 'composite', label: 'Combined' },
  { value: 'colors', label: 'Colors' },
  { value: 'mood', label: 'Mood' },
  { value: 'tags', label: 'Tags' },
  { value: 'description', label: 'Description' },
];

export function SimilaritySlider() {
  const { similarity, setSimilarity, edges, layout } = useGalleryStore();
  
  // Only show for network layouts
  if (layout.type === 'grid') return null;
  
  const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimilarity({
      ...similarity,
      threshold: parseFloat(e.target.value),
    });
  };
  
  const handleModeChange = (mode: SimilarityMode) => {
    setSimilarity({
      ...similarity,
      mode,
    });
  };
  
  return (
    <div className="glass rounded-xl p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-nebula-300">Similarity Mode</label>
        </div>
        <div className="flex flex-wrap gap-2">
          {modes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleModeChange(value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                similarity.mode === value
                  ? 'bg-stellar-cyan/20 text-stellar-cyan border border-stellar-cyan/30'
                  : 'bg-nebula-800/50 text-nebula-300 hover:bg-nebula-700/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-nebula-300">Connection Threshold</label>
          <span className="text-xs text-stellar-cyan font-mono">
            {(similarity.threshold * 100).toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
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
      
      <div className="text-xs text-nebula-400 pt-2 border-t border-nebula-800">
        Showing <span className="text-stellar-cyan font-mono">{edges.length}</span> connections
      </div>
    </div>
  );
}
