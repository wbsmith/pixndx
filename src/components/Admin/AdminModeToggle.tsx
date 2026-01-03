/**
 * Admin Mode Toggle
 * 
 * Button to toggle admin/curation mode.
 * Shows in the header next to user menu.
 */

import { motion } from 'framer-motion';
import { Settings, X } from 'lucide-react';
import { useCurationStore } from '@/stores/curationStore';

export function AdminModeToggle() {
  const { isAdminMode, toggleAdminMode } = useCurationStore();
  
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={toggleAdminMode}
      className={`
        px-3 py-1.5 rounded-lg text-xs font-medium
        flex items-center gap-2
        transition-colors duration-200
        ${isAdminMode
          ? 'bg-stellar-violet/20 text-stellar-violet border border-stellar-violet/50'
          : 'bg-nebula-800/50 text-nebula-400 hover:text-white hover:bg-nebula-800'
        }
      `}
      title={isAdminMode ? 'Exit admin mode' : 'Enter admin mode'}
    >
      {isAdminMode ? (
        <>
          <X size={14} />
          <span>Exit Admin</span>
        </>
      ) : (
        <>
          <Settings size={14} />
          <span>Admin</span>
        </>
      )}
    </motion.button>
  );
}


