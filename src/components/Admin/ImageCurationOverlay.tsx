/**
 * Image Curation Overlay
 * 
 * Shows curation status indicators on image cards when in admin mode.
 * Handles click-to-select and shows rating/status badges.
 */

import { Star, Check, Archive, Trash2, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCurationStore, useImageCuration, type CurationStatus } from '@/stores/curationStore';
import type { ImageMetadata } from '@/types/gallery';

interface ImageCurationOverlayProps {
  image: ImageMetadata;
  showControls?: boolean;
}

export function ImageCurationOverlay({ image, showControls = true }: ImageCurationOverlayProps) {
  const { isAdminMode } = useCurationStore();
  const { status, rating, isSelected, toggleSelected, setRating: _setRating, setStatus } = useImageCuration(image.id);
  
  if (!isAdminMode) return null;
  
  return (
    <>
      {/* Selection checkbox - z-20 to stay above info overlay (z-10) */}
      <div
        className="absolute top-2 left-2 z-20"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelected();
        }}
      >
        <motion.div
          whileTap={{ scale: 0.9 }}
          className={`
            w-6 h-6 rounded border-2 
            flex items-center justify-center
            cursor-pointer transition-colors
            ${isSelected 
              ? 'bg-stellar-cyan border-stellar-cyan' 
              : 'bg-black/50 border-white/50 hover:border-white'
            }
          `}
        >
          {isSelected && <Check size={14} className="text-black" />}
        </motion.div>
      </div>
      
      {/* Status badge - z-20 to stay above info overlay */}
      {status !== 'unreviewed' && (
        <div className="absolute top-2 right-2 z-20">
          <StatusBadge status={status} />
        </div>
      )}

      {/* Rating display - z-20 to stay above info overlay */}
      {rating > 0 && (
        <div className="absolute bottom-2 left-2 z-20 flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              size={12}
              className={star <= rating ? 'text-stellar-gold fill-stellar-gold' : 'text-white/30'}
            />
          ))}
        </div>
      )}
      
      {/* Quick actions on hover - z-20 to stay above info overlay */}
      {showControls && (
        <div className="absolute bottom-2 right-2 z-20
                        opacity-0 group-hover:opacity-100 transition-opacity
                        flex gap-1">
          <QuickActionButton
            onClick={(e) => { e.stopPropagation(); setStatus('keep'); }}
            active={status === 'keep'}
            title="Keep"
          >
            <Check size={14} />
          </QuickActionButton>
          <QuickActionButton
            onClick={(e) => { e.stopPropagation(); setStatus('favorite'); }}
            active={status === 'favorite'}
            title="Favorite"
          >
            <Heart size={14} />
          </QuickActionButton>
          <QuickActionButton
            onClick={(e) => { e.stopPropagation(); setStatus('archive'); }}
            active={status === 'archive'}
            title="Archive"
          >
            <Archive size={14} />
          </QuickActionButton>
          <QuickActionButton
            onClick={(e) => { e.stopPropagation(); setStatus('delete'); }}
            active={status === 'delete'}
            variant="danger"
            title="Delete"
          >
            <Trash2 size={14} />
          </QuickActionButton>
        </div>
      )}
      
      {/* Selection overlay */}
      {isSelected && (
        <div className="absolute inset-0 bg-stellar-cyan/20 pointer-events-none z-0" />
      )}
      
      {/* Deleted overlay */}
      {status === 'delete' && (
        <div className="absolute inset-0 bg-red-900/40 pointer-events-none z-0">
          <div className="absolute inset-0 flex items-center justify-center">
            <Trash2 size={32} className="text-red-400 opacity-50" />
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function StatusBadge({ status }: { status: CurationStatus }) {
  const config = {
    keep: { icon: Check, bg: 'bg-green-500', text: 'text-green-900' },
    favorite: { icon: Heart, bg: 'bg-stellar-gold', text: 'text-black' },
    archive: { icon: Archive, bg: 'bg-yellow-500', text: 'text-yellow-900' },
    delete: { icon: Trash2, bg: 'bg-red-500', text: 'text-white' },
    unreviewed: { icon: null, bg: '', text: '' },
  };
  
  const { icon: Icon, bg, text } = config[status];
  if (!Icon) return null;
  
  return (
    <div className={`${bg} ${text} w-6 h-6 rounded-full flex items-center justify-center shadow-lg`}>
      <Icon size={12} />
    </div>
  );
}

interface QuickActionButtonProps {
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  variant?: 'default' | 'danger';
  title: string;
  children: React.ReactNode;
}

function QuickActionButton({
  onClick,
  active = false,
  variant = 'default',
  title,
  children,
}: QuickActionButtonProps) {
  const baseClasses = `
    w-7 h-7 rounded flex items-center justify-center
    transition-colors cursor-pointer
    backdrop-blur
  `;
  
  const variantClasses = {
    default: active
      ? 'bg-green-500 text-white'
      : 'bg-black/50 text-white/70 hover:bg-black/70 hover:text-white',
    danger: active
      ? 'bg-red-500 text-white'
      : 'bg-black/50 text-white/70 hover:bg-red-900/70 hover:text-red-400',
  };
  
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      title={title}
      className={`${baseClasses} ${variantClasses[variant]}`}
    >
      {children}
    </motion.button>
  );
}

// =============================================================================
// STAR RATING COMPONENT
// =============================================================================

interface StarRatingProps {
  rating: number;
  onChange: (rating: number) => void;
  size?: number;
  readonly?: boolean;
}

export function StarRating({ rating, onChange, size = 16, readonly = false }: StarRatingProps) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={(e) => {
            e.stopPropagation();
            if (!readonly) {
              // Toggle off if clicking same star
              onChange(star === rating ? 0 : star);
            }
          }}
          disabled={readonly}
          className={`
            transition-colors
            ${!readonly && 'hover:scale-110 cursor-pointer'}
          `}
        >
          <Star
            size={size}
            className={
              star <= rating
                ? 'text-stellar-gold fill-stellar-gold'
                : 'text-nebula-600 hover:text-stellar-gold/50'
            }
          />
        </button>
      ))}
    </div>
  );
}


