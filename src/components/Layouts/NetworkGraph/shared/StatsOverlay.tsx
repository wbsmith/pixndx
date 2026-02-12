/**
 * Stats overlay component for network graph.
 * Displays node/edge counts, layout status, community info, LOD controls, and stop button.
 */

import { Square } from 'lucide-react';
import { useGalleryStore } from '@/stores/galleryStore';

export interface GraphStats {
  nodes: number;
  edges: number;
  communities: number;
  layoutTime?: number;
}

export type LayoutStatus = 'computing' | 'stable' | 'unstable';

interface StatsOverlayProps {
  stats: GraphStats;
  status: LayoutStatus;
  currentZoom: number;
  algorithmLabel?: string;
  onStop?: () => void;
}

export function StatsOverlay({
  stats,
  status,
  currentZoom,
  algorithmLabel,
  onStop,
}: StatsOverlayProps) {
  const { graphLOD, setGraphLODEnabled, setGraphLODResolution } = useGalleryStore();

  const statusText = {
    computing: '○ Computing layout...',
    stable: `● Layout stable${stats.layoutTime ? ` (${stats.layoutTime.toFixed(0)}ms)` : ''}`,
    unstable: '● Numerical instability',
  };

  const statusColor = {
    computing: 'text-yellow-400',
    stable: 'text-green-400',
    unstable: 'text-red-400',
  };

  return (
    <div className="absolute top-4 right-4 glass rounded-lg p-3 text-xs space-y-1">
      <div className="text-nebula-300">
        {stats.nodes} nodes • {stats.edges} edges
      </div>

      {algorithmLabel && (
        <div className="text-stellar-violet">
          {algorithmLabel}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className={statusColor[status]}>
          {statusText[status]}
        </span>
        {status === 'computing' && onStop && (
          <button
            onClick={onStop}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title="Stop layout computation"
          >
            <Square size={10} fill="currentColor" />
            <span>Stop</span>
          </button>
        )}
      </div>

      {stats.communities > 0 && (
        <div className="text-purple-400">
          {stats.communities} communities detected
        </div>
      )}

      {/* LOD controls */}
      <div className="pt-1 border-t border-nebula-700 mt-1 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={graphLOD.enabled}
            onChange={(e) => setGraphLODEnabled(e.target.checked)}
            className="accent-stellar-violet"
          />
          <span className="text-nebula-300">
            LOD mode {graphLOD.enabled && currentZoom < graphLOD.zoomThreshold ? '(active)' : ''}
          </span>
        </label>

        {/* Resolution slider - only show when LOD enabled */}
        {graphLOD.enabled && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-nebula-400">
              <span>Resolution</span>
              <span className="text-nebula-300">{graphLOD.resolution.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={graphLOD.resolution}
              onChange={(e) => setGraphLODResolution(parseFloat(e.target.value))}
              className="w-full h-1 bg-nebula-700 rounded-lg appearance-none cursor-pointer accent-stellar-violet"
            />
            <div className="flex justify-between text-[9px] text-nebula-500">
              <span>Fewer</span>
              <span>More communities</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Unstable layout warning banner.
 */
export function UnstableWarning() {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-lg px-4 py-3 text-sm text-red-400 max-w-md text-center">
      <div className="font-medium mb-1">Layout Unstable</div>
      <div className="text-xs text-nebula-300">
        Edge weight influence is too high, causing numerical overflow.
        Lower the value in Graph Controls and click Apply.
      </div>
    </div>
  );
}

/**
 * No edges warning banner.
 */
export function NoEdgesWarning() {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-lg px-4 py-2 text-sm text-yellow-400">
      No edges found. Lower the similarity threshold.
    </div>
  );
}

/**
 * Empty state message.
 */
export function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-nebula-400">
      No images found
    </div>
  );
}

/**
 * Computing overlay for batch layouts.
 */
export function ComputingOverlay({ nodeCount }: { nodeCount: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
      <div className="text-white text-lg">
        Computing layout for {nodeCount} images...
      </div>
    </div>
  );
}
