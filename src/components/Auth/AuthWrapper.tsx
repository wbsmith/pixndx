import { useEffect, useState, useCallback, createContext, useContext, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Authenticator, ThemeProvider, Theme } from '@aws-amplify/ui-react';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { motion } from 'framer-motion';
import '@aws-amplify/ui-react/styles.css';
import { APP_NAME, APP_TAGLINE } from '../../config';
import { Lock, ChevronLeft, ChevronRight } from 'lucide-react';
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
          backgroundColor: { value: 'transparent' },
          borderColor: { value: 'transparent' },
          borderWidth: { value: '0' },
          boxShadow: { value: 'none' },
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
// SCREENSHOT CAROUSEL
// =============================================================================

const screenshots = [
  { src: '/screenshots/screenshot-grid.jpg', caption: 'Browse your collection in a rich grid view' },
  { src: '/screenshots/screenshot-graph-lod.jpg', caption: 'See the big picture with level-of-detail clustering' },
  { src: '/screenshots/screenshot-graph-force.jpg', caption: 'Explore visual similarity with force-directed graphs' },
  { src: '/screenshots/screenshot-graph-zoom.jpg', caption: 'Zoom in to discover visual connections' },
];

function ScreenshotCarousel() {
  // Track cumulative rotation so we never snap back
  const [rotation, setRotation] = useState(0);
  const current = ((Math.round(-rotation / 90) % screenshots.length) + screenshots.length) % screenshots.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const [cubeSize, setCubeSize] = useState({ w: 600, h: 400 });

  // Measure container to size the cube
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = Math.round(w / 1.5); // 3:2 aspect
      setCubeSize({ w, h });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    setRotation((prev) => prev + dir * -90);
  }, []);

  // Auto-advance every 5s, reset timer on manual nav
  useEffect(() => {
    const timer = setInterval(() => go(1), 5000);
    return () => clearInterval(timer);
  }, [go, rotation]);

  // Half-width is the translateZ for cube faces
  const tz = cubeSize.w / 2;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* 3D scene container */}
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: cubeSize.h, perspective: cubeSize.w * 2 }}
      >
        {/* Cube */}
        <motion.div
          className="absolute inset-0"
          style={{
            transformStyle: 'preserve-3d',
            transformOrigin: `${cubeSize.w / 2}px ${cubeSize.h / 2}px`,
          }}
          animate={{ rotateY: rotation }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
          {screenshots.map((shot, i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-xl overflow-hidden border border-nebula-700/30"
              style={{
                backfaceVisibility: 'hidden',
                transform: `rotateY(${i * 90}deg) translateZ(${tz}px)`,
              }}
            >
              <img
                src={shot.src}
                alt={shot.caption}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
            </div>
          ))}
        </motion.div>

        {/* Nav arrows */}
        <button
          onClick={() => go(-1)}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors backdrop-blur-sm"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={() => go(1)}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors backdrop-blur-sm"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Caption + dots row */}
      <div className="flex items-center justify-center gap-4">
        <div className="flex gap-2">
          {screenshots.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                // Find shortest rotation to target
                const diff = i - current;
                const steps = ((diff % screenshots.length) + screenshots.length) % screenshots.length;
                const shortest = steps <= 2 ? steps : steps - screenshots.length;
                setRotation((prev) => prev + shortest * -90);
              }}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === current
                  ? 'bg-stellar-cyan w-6'
                  : 'bg-nebula-600 hover:bg-nebula-400 w-2'
              }`}
            />
          ))}
        </div>
        <motion.p
          key={current}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-sm text-nebula-300"
        >
          {screenshots[current].caption}
        </motion.p>
      </div>
    </div>
  );
}

// =============================================================================
// AUTH WRAPPER
// =============================================================================

interface AuthWrapperProps {
  children: React.ReactNode;
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  return (
    <div className="h-screen bg-gradient-cosmos flex flex-col overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-stellar-cyan/5 via-transparent to-stellar-violet/5 pointer-events-none" />

      {/* Header */}
      <header className="relative z-20 text-center py-4 shrink-0">
        <h1 className="text-2xl font-display font-bold text-white">
          {APP_NAME}
          <span className="text-nebula-400 font-normal text-base ml-3">
            {APP_TAGLINE}
          </span>
        </h1>
      </header>

      {/* Main area: carousel with overlaid auth */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-8 pb-6 min-h-0">
        {/* Carousel fills this area */}
        <div className="w-full max-w-4xl">
          <ScreenshotCarousel />
        </div>

        {/* Auth form overlaid on carousel */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="pointer-events-auto backdrop-blur-md bg-cosmos-deep/70 rounded-2xl border border-nebula-700/40 shadow-2xl shadow-black/50">
            <ThemeProvider theme={theme}>
              <Authenticator
                formFields={formFields}
                components={components}
                loginMechanisms={['email']}
                signUpAttributes={[]}
              >
                {({ signOut, user }) => (
                  <AuthenticatedApp signOut={signOut} user={user}>
                    {children}
                  </AuthenticatedApp>
                )}
              </Authenticator>
            </ThemeProvider>
          </div>
        </div>
      </div>
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
