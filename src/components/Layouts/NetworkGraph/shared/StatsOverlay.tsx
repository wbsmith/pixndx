/**
 * Stats overlay component for network graph.
 * Displays node/edge counts, layout status, community info, and LOD toggle.
 */

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
}

export function StatsOverlay({
  stats,
  status,
  currentZoom,
  algorithmLabel,
}: StatsOverlayProps) {
  const { graphLOD, setGraphLODEnabled } = useGalleryStore();

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

      <div className={statusColor[status]}>
        {statusText[status]}
      </div>

      {stats.communities > 0 && (
        <div className="text-purple-400">
          {stats.communities} communities detected
        </div>
      )}

      {/* LOD toggle */}
      <label className="flex items-center gap-2 pt-1 border-t border-nebula-700 mt-1 cursor-pointer">
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
