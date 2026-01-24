import { useEffect, useState, lazy, Suspense, useRef } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, ImageIcon } from 'lucide-react';
import { useGalleryStore } from './stores/galleryStore';
import { useRatingStore } from './stores/ratingStore';
import { subscribeToNewImages } from './lib/dataLoader';
import { SearchBar } from './components/Search/SearchBar';
import { LayoutSelector } from './components/UI/LayoutSelector';
import { SimilaritySlider } from './components/UI/SimilaritySlider';
import { GalleryView } from './components/Gallery/GalleryView';
import { ImageModal } from './components/Gallery/ImageModal';
import { AdminModeToggle, CurationToolbar, ImageUpload } from './components/Admin';
import { useCurationStore } from './stores/curationStore';
import { APP_NAME, IS_LOCAL_DEV } from './config';
import { useIsAdmin } from './hooks/useIsAdmin';
import { configureAmplify } from './lib/amplify';

// Use config for local dev detection
const isLocalDev = IS_LOCAL_DEV;

// Lazy load auth components only when needed (production)
const AuthWrapper = lazy(() => import('./components/Auth/AuthWrapper').then(mod => ({ default: mod.AuthWrapper })));
const UserMenu = lazy(() => import('./components/Auth/AuthWrapper').then(mod => ({ default: mod.UserMenu })));

function AppContent() {
  const {
    sidebarOpen,
    toggleSidebar,
    filteredImages,
    images,
    searchQuery,
    loading,
    loadProgress,
    ready,
    layout,
    initializeData,
    addImages,
    applyDefaultSort,
  } = useGalleryStore();

  const { fetchRatingsForImages } = useRatingStore();
  const { isAdmin } = useIsAdmin();
  const { isAdminMode } = useCurationStore();
  const initCompleteRef = useRef(false);

  // Load data progressively on mount
  useEffect(() => {
    initializeData();
  }, []);

  // After images loaded: fetch ratings (prod) or mark ready (dev)
  useEffect(() => {
    // Wait until images are fully loaded
    if (images.length === 0 || loading) return;
    // Only run once
    if (initCompleteRef.current) return;
    initCompleteRef.current = true;

    if (IS_LOCAL_DEV) {
      // Local dev: no ratings, mark ready immediately
      applyDefaultSort();
    } else {
      // Production: fetch ratings, then apply sort
      fetchRatingsForImages([]).then(() => {
        applyDefaultSort();
      });
    }
  }, [images.length, loading, fetchRatingsForImages, applyDefaultSort]);

  // Subscribe to new images (real-time updates from GPU processing)
  useEffect(() => {
    if (IS_LOCAL_DEV) return;

    let unsubscribe: (() => void) | null = null;

    subscribeToNewImages((newImage) => {
      console.log('New image received:', newImage.id);
      addImages([newImage]);
    }).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [addImages]);
  
  return (
    <div className="h-screen w-screen bg-gradient-cosmos flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative z-30 px-6 py-4 flex items-center justify-between border-b border-nebula-800/50">
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
                {APP_NAME}
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
            {loading && loadProgress ? (
              <>
                <span className="text-stellar-gold font-mono animate-pulse">
                  Loading {loadProgress.loaded}
                </span>
                <span className="mx-1">/</span>
                <span>{loadProgress.total}</span>
              </>
            ) : (
              <>
                <span className="text-stellar-cyan font-mono">{filteredImages.length}</span>
                <span className="mx-1">/</span>
                <span>{images.length}</span>
                <span className="ml-1">images</span>
              </>
            )}
          </div>
          
          {/* Admin mode toggle - for admins (Cognito Admins group or local dev) */}
          {isAdmin && <AdminModeToggle />}
          
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

            {/* Similarity controls - only for Graph layout */}
            {layout.type === 'network' && (
              <div>
                <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                  Graph Controls
                </h3>
                <SimilaritySlider />
              </div>
            )}

            {/* Quick filters */}
            <div>
              <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                Quick Filters
              </h3>
              <div className="space-y-2">
                <QuickFilter label="Sunsets" query="sunset" />
                <QuickFilter label="Bridges" query="bridge" />
                <QuickFilter label="Flowers" query="flower" />
                <QuickFilter label="City" query="city" />
                <QuickFilter label="Hummingbirds" query="hummingbird" />
                <QuickFilter label="Peaceful" query="peaceful" />
                <QuickFilter label="Dramatic" query="dramatic" />
                <QuickFilter label="Top Rated" query="__top_rated__" />
              </div>
            </div>
            
            {/* Admin: Image Upload - only in admin mode */}
            {isAdmin && isAdminMode && (
              <div>
                <h3 className="text-xs text-nebula-400 uppercase tracking-wider mb-3">
                  Upload Images
                </h3>
                <ImageUpload />
              </div>
            )}

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
        
        {/* Gallery - conditional render: loading spinner OR gallery view */}
        {!ready ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-stellar-cyan/30 border-t-stellar-cyan rounded-full animate-spin mx-auto mb-4" />
              <p className="text-nebula-300 text-lg">
                {loading ? 'Loading images...' : 'Preparing gallery...'}
              </p>
              {loadProgress && (
                <p className="text-nebula-500 text-sm mt-2 font-mono">
                  {loadProgress.loaded} / {loadProgress.total}
                </p>
              )}
            </div>
          </div>
        ) : (
          <GalleryView />
        )}
      </div>
      
      {/* Modal */}
      <ImageModal />
      
      {/* Admin mode curation toolbar (fixed at bottom) */}
      <CurationToolbar />
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

// Loading fallback for auth wrapper
function AuthLoadingFallback() {
  return (
    <div className="min-h-screen bg-cosmos-void flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-stellar-cyan/30 border-t-stellar-cyan rounded-full animate-spin mx-auto mb-4" />
        <p className="text-nebula-300">Loading {APP_NAME}...</p>
      </div>
    </div>
  );
}

// Main App - wraps with auth in production, skips in dev
function App() {
  const [amplifyReady, setAmplifyReady] = useState(isLocalDev);
  
  // Configure Amplify on mount (production only)
  useEffect(() => {
    if (!isLocalDev) {
      configureAmplify().then((configured: boolean) => {
        console.log(`[App] Amplify configuration complete: ${configured}`);
        setAmplifyReady(true);
      });
    }
  }, []);
  
  // In local dev mode, skip authentication
  if (isLocalDev) {
    return <AppContent />;
  }
  
  // Wait for Amplify to be configured
  if (!amplifyReady) {
    return <AuthLoadingFallback />;
  }
  
  // In production, wrap with Amplify authentication
  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <AuthWrapper>
        <AppContent />
      </AuthWrapper>
    </Suspense>
  );
}

export default App;
