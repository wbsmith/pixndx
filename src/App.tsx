import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, ImageIcon, LogOut } from 'lucide-react';
import { useGalleryStore } from './stores/galleryStore';
import { SearchBar } from './components/Search/SearchBar';
import { LayoutSelector } from './components/UI/LayoutSelector';
import { SimilaritySlider } from './components/UI/SimilaritySlider';
import { GalleryView } from './components/Gallery/GalleryView';
import { ImageModal } from './components/Gallery/ImageModal';

// Only import auth components in production
const isLocalDev = import.meta.env.DEV && !import.meta.env.VITE_USE_AUTH;

// Lazy load auth wrapper only when needed
let AuthWrapper: React.ComponentType<{ children: React.ReactNode }> | null = null;
let UserMenu: React.ComponentType | null = null;

if (!isLocalDev) {
  // Dynamic import for production
  import('./components/Auth/AuthWrapper').then((mod) => {
    AuthWrapper = mod.AuthWrapper;
    UserMenu = mod.UserMenu;
  });
}

// Configure Amplify only in production
if (!isLocalDev) {
  // Uncomment after deployment:
  // import { Amplify } from 'aws-amplify';
  // import outputs from '../amplify_outputs.json';
  // Amplify.configure(outputs);
}

function AppContent() {
  const { 
    sidebarOpen, 
    toggleSidebar, 
    filteredImages, 
    images,
    searchQuery,
    recomputeEdges,
  } = useGalleryStore();
  
  // Compute edges on initial load
  useEffect(() => {
    recomputeEdges();
  }, []);
  
  return (
    <div className="h-screen w-screen bg-gradient-cosmos flex flex-col overflow-hidden">
      {/* Noise overlay */}
      <div className="noise-overlay" />
      
      {/* Header */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between border-b border-nebula-800/50">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="lg:hidden p-2 hover:bg-nebula-800/50 rounded-lg transition-colors"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <ImageIcon className="text-stellar-cyan" size={28} />
              <div className="absolute inset-0 text-stellar-cyan blur-md opacity-50">
                <ImageIcon size={28} />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-white text-glow">
                Nebula Gallery
              </h1>
              <p className="text-[10px] text-nebula-400 uppercase tracking-widest">
                {isLocalDev ? 'Local Dev Mode' : 'Semantic Visual Explorer'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex-1 max-w-xl mx-8 hidden md:block">
          <SearchBar />
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-xs text-nebula-400 hidden sm:block">
            <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
            <span className="mx-1">/</span>
            <span>{images.length}</span>
            <span className="ml-1">images</span>
          </div>
          
          {/* User menu with sign out - only in production */}
          {!isLocalDev && UserMenu && <UserMenu />}
          
          {/* Dev mode indicator */}
          {isLocalDev && (
            <div className="px-2 py-1 bg-stellar-gold/20 text-stellar-gold text-xs rounded">
              DEV
            </div>
          )}
        </div>
      </header>
      
      {/* Mobile search */}
      <div className="md:hidden px-4 py-3 border-b border-nebula-800/50">
        <SearchBar />
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar */}
        <motion.aside
          initial={false}
          animate={{
            width: sidebarOpen ? 280 : 0,
            opacity: sidebarOpen ? 1 : 0,
          }}
          transition={{ type: 'spring', damping: 25 }}
          className={`
            relative z-20 border-r border-nebula-800/50 overflow-hidden
            ${sidebarOpen ? 'block' : 'hidden lg:block'}
          `}
        >
          <div className="w-[280px] h-full p-4 space-y-6 overflow-y-auto">
            {/* Layout selector */}
            <div>
              <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                Layout Mode
              </h3>
              <LayoutSelector />
            </div>
            
            {/* Similarity controls */}
            <div>
              <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                Similarity
              </h3>
              <SimilaritySlider />
            </div>
            
            {/* Quick filters */}
            <div>
              <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                Quick Filters
              </h3>
              <div className="space-y-2">
                <QuickFilter label="Warm colors" query="warm golden orange" />
                <QuickFilter label="Cool colors" query="blue cool cyan" />
                <QuickFilter label="Nature" query="nature forest ocean" />
                <QuickFilter label="Urban" query="city urban skyline" />
                <QuickFilter label="Peaceful" query="peaceful calm serene" />
                <QuickFilter label="Dramatic" query="dramatic powerful" />
                <QuickFilter label="Top Rated" query="__top_rated__" />
              </div>
            </div>
            
            {/* Stats */}
            <div className="pt-4 border-t border-nebula-800/50">
              <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                Collection Stats
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-nebula-400">Total images</span>
                  <span className="text-stellar-cyan font-mono">{images.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-nebula-400">Filtered</span>
                  <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
                </div>
                {searchQuery && (
                  <div className="flex justify-between">
                    <span className="text-nebula-400">Query</span>
                    <span className="text-stellar-violet truncate max-w-[120px]">
                      "{searchQuery}"
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.aside>
        
        {/* Gallery */}
        <GalleryView />
      </div>
      
      {/* Modal */}
      <ImageModal />
    </div>
  );
}

// Quick filter button component
function QuickFilter({ label, query }: { label: string; query: string }) {
  const { setSearchQuery, searchQuery } = useGalleryStore();
  const isActive = searchQuery === query;
  
  return (
    <button
      onClick={() => setSearchQuery(isActive ? '' : query)}
      className={`
        w-full text-left px-3 py-2 rounded-lg text-sm transition-all
        ${isActive 
          ? 'bg-stellar-cyan/20 text-stellar-cyan' 
          : 'text-nebula-300 hover:bg-nebula-800/50'
        }
      `}
    >
      {label}
    </button>
  );
}

// Main App - wraps with auth in production, skips in dev
function App() {
  // In local dev mode, skip authentication
  if (isLocalDev) {
    return <AppContent />;
  }
  
  // In production, wrap with auth (lazy loaded)
  // For now, just render content - auth wrapper loads async
  // TODO: Add proper suspense boundary
  return <AppContent />;
}

export default App;
