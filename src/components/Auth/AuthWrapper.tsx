import { useEffect, useState, useCallback, createContext, useContext, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Authenticator, ThemeProvider, Theme } from '@aws-amplify/ui-react';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { AnimatePresence, motion } from 'framer-motion';
import '@aws-amplify/ui-react/styles.css';
import { APP_NAME } from '../../config';
import { Lock, Info, ShieldCheck, Server, Eye, Cookie, X } from 'lucide-react';
import { startSessionRefresh, stopSessionRefresh, refreshImageCookies, clearImageCookies } from '@/lib/amplify';

// =============================================================================
// THEME
// =============================================================================

const theme: Theme = {
  name: 'picgraf-theme',
  tokens: {
    colors: {
      background: {
        primary: { value: '#0a0a0f' },
        secondary: { value: '#1a1a2e' },
      },
      font: {
        primary: { value: '#ffffff' },
        secondary: { value: '#a0aec0' },
        interactive: { value: '#22d3ee' },
      },
      brand: {
        primary: {
          10: { value: '#0a2c33' },
          20: { value: '#0e4a55' },
          40: { value: '#156e7d' },
          60: { value: '#1e9aab' },
          80: { value: '#22d3ee' },
          90: { value: '#67e8f9' },
          100: { value: '#a5f3fc' },
        },
      },
      border: {
        primary: { value: 'rgba(99, 102, 241, 0.3)' },
        secondary: { value: 'rgba(99, 102, 241, 0.2)' },
        focus: { value: '#22d3ee' },
      },
    },
    components: {
      authenticator: {
        router: {
          backgroundColor: { value: 'rgba(26, 26, 46, 0.95)' },
          borderColor: { value: 'rgba(99, 102, 241, 0.2)' },
          borderWidth: { value: '1px' },
          borderStyle: { value: 'solid' },
          boxShadow: { value: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' },
        },
      },
      button: {
        primary: {
          backgroundColor: { value: '#22d3ee' },
          color: { value: '#0a0a0f' },
          _hover: {
            backgroundColor: { value: '#06b6d4' },
          },
          _focus: {
            backgroundColor: { value: '#06b6d4' },
          },
        },
        link: {
          color: { value: '#22d3ee' },
          _hover: {
            color: { value: '#67e8f9' },
          },
        },
      },
      fieldcontrol: {
        borderColor: { value: 'rgba(99, 102, 241, 0.3)' },
        color: { value: '#ffffff' },
        _focus: {
          borderColor: { value: '#22d3ee' },
        },
      },
      tabs: {
        item: {
          color: { value: '#a0aec0' },
          _hover: {
            color: { value: '#ffffff' },
          },
          _active: {
            color: { value: '#22d3ee' },
            borderColor: { value: '#22d3ee' },
          },
        },
      },
    },
    radii: {
      small: { value: '0.5rem' },
      medium: { value: '0.75rem' },
      large: { value: '1rem' },
    },
  },
};


// =============================================================================
// CUSTOM COMPONENTS
// =============================================================================

const components = {
  Header() {
    return null;
  },

  Footer() {
    return null;
  },
  
  SignUp: {
    Header() {
      return (
        <div className="text-center pb-4">
          <h2 className="text-xl font-semibold text-white">Create Account</h2>
          <p className="text-sm text-nebula-400 mt-1">
            Sign up to explore the gallery
          </p>
        </div>
      );
    },
    FormFields() {
      return (
        <>
          {/* Default form fields */}
          <Authenticator.SignUp.FormFields />
          
          {/* Password requirements hint - shown statically */}
          <div className="mt-2 p-3 rounded-lg bg-nebula-900/50 border border-nebula-700/50">
            <p className="text-xs text-nebula-400 mb-2 font-medium">Password must have:</p>
            <ul className="space-y-1 text-xs text-nebula-400">
              <li>• At least 8 characters</li>
              <li>• One uppercase letter</li>
              <li>• One lowercase letter</li>
              <li>• One number</li>
              <li>• One special character (!@#$%^&*)</li>
            </ul>
          </div>
        </>
      );
    },
  },
  
  SignIn: {
    Header() {
      return (
        <div className="text-center pb-4">
          <h2 className="text-xl font-semibold text-white">Welcome Back</h2>
          <p className="text-sm text-nebula-400 mt-1">
            Sign in to continue to {APP_NAME}
          </p>
        </div>
      );
    },
  },
  
  ConfirmSignUp: {
    Header() {
      return (
        <div className="text-center pb-4">
          <h2 className="text-xl font-semibold text-white">Check Your Email</h2>
          <p className="text-sm text-nebula-400 mt-1">
            We sent a verification code to your email
          </p>
        </div>
      );
    },
  },
  
  ResetPassword: {
    Header() {
      return (
        <div className="text-center pb-4">
          <h2 className="text-xl font-semibold text-white">Reset Password</h2>
          <p className="text-sm text-nebula-400 mt-1">
            Enter your email to receive a reset code
          </p>
        </div>
      );
    },
  },
};

// =============================================================================
// FORM FIELDS CONFIG
// =============================================================================

const formFields = {
  signIn: {
    username: {
      label: 'Email',
      placeholder: 'your@email.com',
      isRequired: true,
      labelHidden: false,
    },
    password: {
      label: 'Password',
      placeholder: 'Enter your password',
      isRequired: true,
      labelHidden: false,
    },
  },
  signUp: {
    email: {
      order: 1,
      label: 'Email',
      placeholder: 'your@email.com',
      isRequired: true,
      labelHidden: false,
    },
    password: {
      order: 2,
      label: 'Password',
      placeholder: 'Create a strong password',
      isRequired: true,
      labelHidden: false,
    },
    confirm_password: {
      order: 3,
      label: 'Confirm Password',
      placeholder: 'Confirm your password',
      isRequired: true,
      labelHidden: false,
    },
  },
  confirmSignUp: {
    confirmation_code: {
      label: 'Verification Code',
      placeholder: 'Enter the 6-digit code',
      isRequired: true,
    },
  },
  resetPassword: {
    username: {
      label: 'Email',
      placeholder: 'your@email.com',
      isRequired: true,
    },
  },
  confirmResetPassword: {
    confirmation_code: {
      label: 'Verification Code',
      placeholder: 'Enter the code from your email',
      isRequired: true,
    },
    password: {
      label: 'New Password',
      placeholder: 'Enter your new password',
      isRequired: true,
    },
    confirm_password: {
      label: 'Confirm New Password',
      placeholder: 'Confirm your new password',
      isRequired: true,
    },
  },
};

// =============================================================================
// SCREENSHOT SLIDESHOW
// =============================================================================

const screenshots = [
  { src: '/screenshots/screenshot-grid.jpg', caption: 'Browse your collection in a rich grid view' },
  { src: '/screenshots/screenshot-graph-lod.jpg', caption: 'Zoom in to discover visual connections' },
  { src: '/screenshots/screenshot-graph-force.jpg', caption: 'Explore visual similarity with force-directed graphs' },
  { src: '/screenshots/screenshot-graph-zoom.jpg', caption: 'See the big picture with level-of-detail clustering' },
];

// 3s visible + 1s fade out + 1s fade in = 5s per cycle
const DISPLAY_MS = 3000;
const FADE_S = 1;

function ScreenshotSlideshow() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % screenshots.length);
    }, DISPLAY_MS + FADE_S * 2 * 1000); // total cycle time
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      {/* Image container — 2/3 of viewport width, preserves aspect ratio */}
      <div className="relative w-2/3 max-h-full" style={{ aspectRatio: '3 / 2' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FADE_S, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-xl overflow-hidden border border-nebula-700/30"
          >
            <img
              src={screenshots[current].src}
              alt={screenshots[current].caption}
              className="w-full h-full object-contain bg-cosmos-deep"
            />
            {/* Caption overlaid at bottom */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-6 py-4">
              <p className="text-sm text-white/90 text-center">{screenshots[current].caption}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Dot indicators */}
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {screenshots.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === current
                  ? 'bg-stellar-cyan w-5'
                  : 'bg-nebula-600 w-1.5'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ABOUT MODAL
// =============================================================================

function AboutModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto w-full max-w-lg bg-cosmos-deep/95 backdrop-blur-xl rounded-2xl border border-nebula-700/40 shadow-2xl shadow-black/50 p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-display font-bold text-white">About {APP_NAME}</h2>
            <button onClick={onClose} className="p-1 hover:bg-nebula-800/50 rounded-lg transition-colors">
              <X size={20} className="text-nebula-400" />
            </button>
          </div>

          <div className="space-y-4 text-sm text-nebula-300">
            <p>
              {APP_NAME} is a privacy-focused semantic photo gallery that uses AI to understand
              and organize your images — without ever sending them to public AI services.
            </p>

            <div className="space-y-3">
              <div className="flex gap-3">
                <ShieldCheck size={18} className="text-stellar-cyan shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">Private AI Processing</p>
                  <p>All image analysis runs on dedicated infrastructure. Your photos never
                  leave your private environment or touch third-party AI APIs.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Eye size={18} className="text-stellar-cyan shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">Authenticated Access Only</p>
                  <p>Every image is protected behind authentication. Only signed-in users
                  with valid session credentials can view the gallery.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Cookie size={18} className="text-stellar-cyan shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">Signed Session Cookies</p>
                  <p>Images are served through a CDN using cryptographically signed cookies
                  that expire automatically. No permanent tokens or public URLs.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Server size={18} className="text-stellar-cyan shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">Semantic Understanding</p>
                  <p>Search by description, mood, or visual similarity. AI-generated
                  embeddings let you explore your collection in ways traditional galleries can't.</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </>,
    document.body
  );
}

// =============================================================================
// AUTH MODAL
// =============================================================================

function AuthModal({ initialState, onClose, onAuth, children }: {
  initialState: 'signIn' | 'signUp';
  onClose: () => void;
  onAuth: (signOut: (() => void) | undefined, user: any) => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9998]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Centered auth — let Authenticator control its own size */}
      <div className="relative z-[9999] flex items-center justify-center min-h-screen p-4">
        {/* Close button floated above */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-nebula-800/50 rounded-lg transition-colors z-[10000]"
        >
          <X size={20} className="text-nebula-400 hover:text-white" />
        </button>

        <ThemeProvider theme={theme}>
          <Authenticator
            formFields={formFields}
            components={components}
            loginMechanisms={['email']}
            signUpAttributes={[]}
            initialState={initialState}
          >
            {({ signOut, user }) => {
              onAuth(signOut, user);
              return <>{children}</>;
            }}
          </Authenticator>
        </ThemeProvider>
      </div>
    </div>,
    document.body
  );
}

// =============================================================================
// AUTH WRAPPER
// =============================================================================

interface AuthWrapperProps {
  children: React.ReactNode;
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  const [showAbout, setShowAbout] = useState(false);
  const [authModal, setAuthModal] = useState<'signIn' | 'signUp' | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authProps, setAuthProps] = useState<{ signOut?: () => void; user?: any }>({});

  const handleAuth = useCallback((signOut: (() => void) | undefined, user: any) => {
    if (!authenticated) {
      setAuthenticated(true);
      setAuthProps({ signOut, user });
      setAuthModal(null);
    }
  }, [authenticated]);

  // If authenticated, render the app
  if (authenticated && authProps.user) {
    return (
      <AuthenticatedApp signOut={authProps.signOut} user={authProps.user}>
        {children}
      </AuthenticatedApp>
    );
  }

  return (
    <div className="h-screen bg-gradient-cosmos flex flex-col overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-stellar-cyan/5 via-transparent to-stellar-violet/5 pointer-events-none" />

      {/* Header */}
      <header className="relative z-20 text-center py-5 shrink-0">
        <h1 className="text-2xl font-display font-bold text-white">
          {APP_NAME}
          <span className="text-nebula-400 font-normal text-base ml-2">
            : a privacy-focused semantic photo gallery
          </span>
          <button
            onClick={() => setShowAbout(true)}
            className="inline-flex ml-2 p-1 rounded-full hover:bg-nebula-800/50 text-nebula-400 hover:text-stellar-cyan transition-colors align-middle"
            title="About"
          >
            <Info size={14} />
          </button>
        </h1>

        {/* Auth links */}
        <div className="mt-2 flex items-center justify-center gap-4 text-sm">
          <button
            onClick={() => setAuthModal('signIn')}
            className="text-stellar-cyan hover:text-stellar-cyan/80 transition-colors font-medium"
          >
            Sign In
          </button>
          <span className="text-nebula-600">|</span>
          <button
            onClick={() => setAuthModal('signUp')}
            className="text-stellar-cyan hover:text-stellar-cyan/80 transition-colors font-medium"
          >
            Create Account
          </button>
        </div>
      </header>

      {/* Slideshow fills remaining space */}
      <div className="relative z-10 flex-1 min-h-0 pb-8">
        <ScreenshotSlideshow />
      </div>

      {/* Auth modal */}
      {authModal && (
        <AuthModal
          initialState={authModal}
          onClose={() => setAuthModal(null)}
          onAuth={handleAuth}
        >
          {children}
        </AuthModal>
      )}

      {/* About modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}

// =============================================================================
// AUTH CONTEXT & HOOKS
// =============================================================================

interface AuthContextType {
  user: any;
  signOut?: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null });

interface AuthenticatedAppProps {
  children: React.ReactNode;
  signOut?: () => void;
  user?: any;
}

function AuthenticatedApp({ children, signOut, user }: AuthenticatedAppProps) {
  // Start proactive session refresh and fetch image cookies when authenticated
  useEffect(() => {
    if (user) {
      startSessionRefresh();
      // Fetch CloudFront signed cookies for image access
      refreshImageCookies().catch(console.error);
    }

    // Stop refresh and clear cookies on unmount (logout)
    return () => {
      stopSessionRefresh();
      clearImageCookies();
    };
  }, [user]);
  
  return (
    <AuthContext.Provider value={{ user, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useCurrentUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserId() {
      try {
        const user = await getCurrentUser();
        setUserId(user.userId);
      } catch {
        setUserId(null);
      }
    }
    fetchUserId();
  }, []);

  return userId;
}

export function useIsAuthenticated(): boolean {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await fetchAuthSession();
        setIsAuthenticated(!!session.tokens);
      } catch {
        setIsAuthenticated(false);
      }
    }
    checkAuth();
  }, []);

  return isAuthenticated;
}

// =============================================================================
// USER MENU
// =============================================================================

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0 });

  // Update dropdown position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8, // 8px gap (mt-2)
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  if (!user) return null;

  const email = user.signInDetails?.loginId || user.username || 'User';
  const initials = email.charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-nebula-800 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stellar-cyan to-stellar-violet flex items-center justify-center text-cosmos-void font-bold text-sm">
          {initials}
        </div>
        <span className="text-sm text-nebula-300 hidden md:block max-w-[150px] truncate">
          {email}
        </span>
      </button>

      {isOpen && createPortal(
        <>
          {/* Backdrop - blocks all clicks, rendered at document root */}
          <div
            className="fixed inset-0 z-[9998] bg-transparent"
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
          />

          {/* Dropdown menu - rendered at document root */}
          <div
            className="fixed w-56 glass rounded-xl py-2 z-[9999] border border-nebula-700/50"
            style={{ top: dropdownPosition.top, right: dropdownPosition.right }}
          >
            <div className="px-4 py-3 border-b border-nebula-700/50">
              <p className="text-sm text-white font-medium truncate">{email}</p>
              <p className="text-xs text-nebula-400 mt-0.5">Signed in</p>
            </div>

            <button
              onClick={() => {
                setIsOpen(false);
                signOut?.();
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-nebula-300 hover:bg-nebula-700/50 hover:text-white transition-colors flex items-center gap-2"
            >
              <Lock className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
