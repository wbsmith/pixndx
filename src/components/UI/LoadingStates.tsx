import { motion } from 'framer-motion';
import { Loader2, Image, Search, Network } from 'lucide-react';

interface LoadingProps {
  message?: string;
}

// Full page loading spinner
export function FullPageLoading({ message = 'Loading...' }: LoadingProps) {
  return (
    <div className="fixed inset-0 bg-cosmos-void flex items-center justify-center z-50">
      <div className="text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="inline-block"
        >
          <Loader2 size={48} className="text-stellar-cyan" />
        </motion.div>
        <p className="mt-4 text-nebula-300">{message}</p>
      </div>
    </div>
  );
}

// Inline loading spinner
export function InlineLoading({ message = 'Loading...' }: LoadingProps) {
  return (
    <div className="flex items-center gap-2 text-nebula-400">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      >
        <Loader2 size={16} />
      </motion.div>
      <span className="text-sm">{message}</span>
    </div>
  );
}

// Gallery loading skeleton
export function GallerySkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.05 }}
          className="aspect-[3/2] rounded-xl overflow-hidden"
        >
          <div className="w-full h-full bg-gradient-to-br from-nebula-800 to-nebula-900 animate-pulse" />
        </motion.div>
      ))}
    </div>
  );
}

// Network graph loading skeleton
export function NetworkGraphSkeleton() {
  const nodes = Array.from({ length: 8 }).map((_, i) => ({
    id: i,
    x: 200 + Math.cos((i / 8) * Math.PI * 2) * 150,
    y: 200 + Math.sin((i / 8) * Math.PI * 2) * 150,
  }));
  
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg width={400} height={400} className="opacity-30">
        {/* Skeleton edges */}
        {nodes.map((node, i) => (
          <motion.line
            key={`edge-${i}`}
            x1={200}
            y1={200}
            x2={node.x}
            y2={node.y}
            stroke="#4a5568"
            strokeWidth={1}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: i * 0.1 }}
          />
        ))}
        
        {/* Skeleton nodes */}
        {nodes.map((node, i) => (
          <motion.circle
            key={`node-${i}`}
            cx={node.x}
            cy={node.y}
            r={24}
            fill="#1a1a2e"
            stroke="#4a5568"
            strokeWidth={2}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5 + i * 0.1, type: 'spring' }}
          />
        ))}
        
        {/* Center node */}
        <motion.circle
          cx={200}
          cy={200}
          r={32}
          fill="#1a1a2e"
          stroke="#6366f1"
          strokeWidth={2}
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ delay: 0.3, duration: 2, repeat: Infinity }}
        />
      </svg>
      
      <div className="absolute text-center">
        <Network size={24} className="mx-auto text-stellar-cyan mb-2 animate-pulse" />
        <p className="text-sm text-nebula-400">Building connections...</p>
      </div>
    </div>
  );
}

// Search results loading
export function SearchResultsSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-nebula-400">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Search size={16} />
        </motion.div>
        <span className="text-sm">Searching...</span>
      </div>
      
      {Array.from({ length: 3 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
          className="flex gap-3 p-3 rounded-lg bg-nebula-800/30"
        >
          <div className="w-16 h-16 rounded-lg bg-nebula-700 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-nebula-700 rounded animate-pulse w-3/4" />
            <div className="h-3 bg-nebula-700 rounded animate-pulse w-1/2" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// Image loading placeholder
export function ImagePlaceholder({ aspectRatio = '3/2' }: { aspectRatio?: string }) {
  return (
    <div
      className="relative bg-nebula-800 rounded-xl overflow-hidden"
      style={{ aspectRatio }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Image size={32} className="text-nebula-600 animate-pulse" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-nebula-900/50 to-transparent" />
    </div>
  );
}

// Progress bar for batch operations
interface ProgressBarProps {
  progress: number; // 0-100
  label?: string;
  showPercentage?: boolean;
}

export function ProgressBar({ progress, label, showPercentage = true }: ProgressBarProps) {
  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex justify-between text-xs text-nebula-400 mb-1">
          {label && <span>{label}</span>}
          {showPercentage && <span>{Math.round(progress)}%</span>}
        </div>
      )}
      <div className="h-2 bg-nebula-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-stellar-cyan to-stellar-violet"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  );
}

// Batch processing status
interface BatchProcessingStatusProps {
  total: number;
  completed: number;
  failed: number;
  currentItem?: string;
}

export function BatchProcessingStatus({
  total,
  completed,
  failed,
  currentItem,
}: BatchProcessingStatusProps) {
  const progress = (completed / total) * 100;
  
  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Processing Images</span>
        <span className="text-xs text-nebula-400">
          {completed} / {total}
        </span>
      </div>
      
      <ProgressBar progress={progress} />
      
      {currentItem && (
        <div className="text-xs text-nebula-400 truncate">
          Current: {currentItem}
        </div>
      )}
      
      {failed > 0 && (
        <div className="text-xs text-red-400">
          {failed} failed
        </div>
      )}
    </div>
  );
}

// Empty state
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      {icon && (
        <div className="mb-4 text-nebula-500">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-white mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-nebula-400 mb-4 max-w-md">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-stellar-cyan text-cosmos-void rounded-lg font-medium hover:bg-stellar-cyan/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// Error state
interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ 
  title = 'Something went wrong', 
  message, 
  onRetry 
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="text-lg font-medium text-white mb-1">{title}</h3>
      <p className="text-sm text-nebula-400 mb-4 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-nebula-700 text-white rounded-lg font-medium hover:bg-nebula-600 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
