import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { SimilarityEdge, ImageMetadata } from '@/types/gallery';
import { getDominantColor } from '@/lib/similarity/vectors';

interface SimilarityEdgesProps {
  edges: SimilarityEdge[];
  images: ImageMetadata[];
  positions: Map<string, { x: number; y: number }>;
  hoveredImageId?: string | null;
  selectedEdge?: SimilarityEdge | null;
  onEdgeClick?: (edge: SimilarityEdge) => void;
  onEdgeHover?: (edge: SimilarityEdge | null) => void;
  showWeights?: boolean;
  animated?: boolean;
}

export function SimilarityEdges({
  edges,
  images,
  positions,
  hoveredImageId,
  selectedEdge,
  onEdgeClick,
  onEdgeHover,
  showWeights = false,
  animated = true,
}: SimilarityEdgesProps) {
  // Create image lookup map
  const imageMap = useMemo(() => {
    const map = new Map<string, ImageMetadata>();
    images.forEach((img) => map.set(img.id, img));
    return map;
  }, [images]);
  
  // Process edges with positions
  const processedEdges = useMemo(() => {
    return edges
      .map((edge) => {
        const sourcePos = positions.get(edge.source);
        const targetPos = positions.get(edge.target);
        const sourceImage = imageMap.get(edge.source);
        const targetImage = imageMap.get(edge.target);
        
        if (!sourcePos || !targetPos || !sourceImage || !targetImage) {
          return null;
        }
        
        // Calculate midpoint for weight label
        const midX = (sourcePos.x + targetPos.x) / 2;
        const midY = (sourcePos.y + targetPos.y) / 2;
        
        // Calculate angle for gradient
        const angle = Math.atan2(
          targetPos.y - sourcePos.y,
          targetPos.x - sourcePos.x
        ) * (180 / Math.PI);
        
        // Get colors for gradient
        const sourceColor = getDominantColor(sourceImage);
        const targetColor = getDominantColor(targetImage);
        
        return {
          ...edge,
          sourcePos,
          targetPos,
          midX,
          midY,
          angle,
          sourceColor,
          targetColor,
          sourceImage,
          targetImage,
        };
      })
      .filter(Boolean) as Array<SimilarityEdge & {
        sourcePos: { x: number; y: number };
        targetPos: { x: number; y: number };
        midX: number;
        midY: number;
        angle: number;
        sourceColor: string;
        targetColor: string;
        sourceImage: ImageMetadata;
        targetImage: ImageMetadata;
      }>;
  }, [edges, positions, imageMap]);
  
  // Determine if edge is highlighted
  const isEdgeHighlighted = (edge: SimilarityEdge) => {
    if (selectedEdge) {
      return edge.source === selectedEdge.source && edge.target === selectedEdge.target;
    }
    if (hoveredImageId) {
      return edge.source === hoveredImageId || edge.target === hoveredImageId;
    }
    return false;
  };
  
  // Determine edge opacity
  const getEdgeOpacity = (edge: SimilarityEdge) => {
    if (hoveredImageId) {
      return isEdgeHighlighted(edge) ? 0.8 : 0.1;
    }
    return edge.weight * 0.5 + 0.1;
  };
  
  return (
    <svg className="absolute inset-0 pointer-events-none overflow-visible">
      <defs>
        {/* Create gradient for each edge */}
        {processedEdges.map((edge) => (
          <linearGradient
            key={`gradient-${edge.source}-${edge.target}`}
            id={`edge-gradient-${edge.source}-${edge.target}`}
            gradientUnits="userSpaceOnUse"
            x1={edge.sourcePos.x}
            y1={edge.sourcePos.y}
            x2={edge.targetPos.x}
            y2={edge.targetPos.y}
          >
            <stop offset="0%" stopColor={edge.sourceColor} stopOpacity="0.6" />
            <stop offset="50%" stopColor="#6366f1" stopOpacity="0.3" />
            <stop offset="100%" stopColor={edge.targetColor} stopOpacity="0.6" />
          </linearGradient>
        ))}
        
        {/* Glow filter */}
        <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      {/* Render edges */}
      <g className="edges">
        {processedEdges.map((edge, index) => {
          const highlighted = isEdgeHighlighted(edge);
          const opacity = getEdgeOpacity(edge);
          const strokeWidth = Math.max(1, edge.weight * 4);
          
          return (
            <g key={`${edge.source}-${edge.target}`}>
              {/* Edge line */}
              <motion.line
                x1={edge.sourcePos.x}
                y1={edge.sourcePos.y}
                x2={edge.targetPos.x}
                y2={edge.targetPos.y}
                stroke={
                  highlighted
                    ? `url(#edge-gradient-${edge.source}-${edge.target})`
                    : '#4a5568'
                }
                strokeWidth={highlighted ? strokeWidth * 1.5 : strokeWidth}
                strokeOpacity={opacity}
                strokeLinecap="round"
                filter={highlighted ? 'url(#edge-glow)' : undefined}
                initial={animated ? { pathLength: 0 } : undefined}
                animate={animated ? { pathLength: 1 } : undefined}
                transition={{ delay: index * 0.01, duration: 0.5 }}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={() => onEdgeClick?.(edge)}
                onMouseEnter={() => onEdgeHover?.(edge)}
                onMouseLeave={() => onEdgeHover?.(null)}
              />
              
              {/* Weight label */}
              {showWeights && (highlighted || edge.weight > 0.5) && (
                <motion.g
                  initial={{ opacity: 0 }}
                  animate={{ opacity: highlighted ? 1 : 0.6 }}
                >
                  <rect
                    x={edge.midX - 16}
                    y={edge.midY - 10}
                    width={32}
                    height={20}
                    rx={4}
                    fill="rgba(0,0,0,0.7)"
                  />
                  <text
                    x={edge.midX}
                    y={edge.midY + 4}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#a0aec0"
                    fontFamily="monospace"
                  >
                    {(edge.weight * 100).toFixed(0)}%
                  </text>
                </motion.g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// Edge statistics component
interface EdgeStatsProps {
  edges: SimilarityEdge[];
  selectedEdge?: SimilarityEdge | null;
}

export function EdgeStats({ edges, selectedEdge }: EdgeStatsProps) {
  const stats = useMemo(() => {
    if (edges.length === 0) {
      return { count: 0, avgWeight: 0, minWeight: 0, maxWeight: 0 };
    }
    
    const weights = edges.map((e) => e.weight);
    return {
      count: edges.length,
      avgWeight: weights.reduce((a, b) => a + b, 0) / weights.length,
      minWeight: Math.min(...weights),
      maxWeight: Math.max(...weights),
    };
  }, [edges]);
  
  return (
    <div className="glass rounded-lg p-3 text-xs">
      <div className="text-nebula-400 uppercase tracking-wider mb-2">
        Edge Statistics
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-nebula-500">Count:</span>
          <span className="ml-1 text-white font-mono">{stats.count}</span>
        </div>
        <div>
          <span className="text-nebula-500">Avg:</span>
          <span className="ml-1 text-stellar-cyan font-mono">
            {(stats.avgWeight * 100).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-nebula-500">Min:</span>
          <span className="ml-1 text-white font-mono">
            {(stats.minWeight * 100).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-nebula-500">Max:</span>
          <span className="ml-1 text-white font-mono">
            {(stats.maxWeight * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      
      {selectedEdge && (
        <div className="mt-3 pt-3 border-t border-nebula-700">
          <div className="text-nebula-400 mb-1">Selected Edge</div>
          <div className="text-stellar-violet font-mono">
            {(selectedEdge.weight * 100).toFixed(1)}% ({selectedEdge.mode})
          </div>
        </div>
      )}
    </div>
  );
}
