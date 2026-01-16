import { useEffect, useState, createContext, useContext } from 'react';
import { Authenticator, ThemeProvider, Theme } from '@aws-amplify/ui-react';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import '@aws-amplify/ui-react/styles.css';
import { APP_NAME, APP_TAGLINE } from '../../config';
import { ImageIcon, Lock } from 'lucide-react';
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
    return (
      <div className="text-center py-8 px-4">
        {/* Logo */}
        <div className="relative inline-block mb-4">
          <ImageIcon className="text-stellar-cyan" size={48} />
          <div className="absolute inset-0 text-stellar-cyan blur-xl opacity-40">
            <ImageIcon size={48} />
          </div>
        </div>
        
        <h1 className="text-3xl font-display font-bold text-white mb-2">
          {APP_NAME}
        </h1>
        <p className="text-nebula-400 text-sm">
          {APP_TAGLINE}
        </p>
      </div>
    );
  },
  
  Footer() {
    return (
      <div className="text-center py-4 px-4">
        <p className="text-xs text-nebula-500">
          Private photo gallery • All rights reserved
        </p>
      </div>
    );
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
// AUTH WRAPPER
// =============================================================================

interface AuthWrapperProps {
  children: React.ReactNode;
}

export function AuthWrapper({ children }: AuthWrapperProps) {
  return (
    <div className="min-h-screen bg-gradient-cosmos flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="noise-overlay" />
      <div className="fixed inset-0 bg-gradient-to-br from-stellar-cyan/5 via-transparent to-stellar-violet/5 pointer-events-none" />
      
      <ThemeProvider theme={theme}>
        <Authenticator
          formFields={formFields}
          components={components}
          loginMechanisms={['email']}
          signUpAttributes={[]}  // Don't require extra attributes
          variation="modal"
        >
          {({ signOut, user }) => (
            <AuthenticatedApp signOut={signOut} user={user}>
              {children}
            </AuthenticatedApp>
          )}
        </Authenticator>
      </ThemeProvider>
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

  if (!user) return null;

  const email = user.signInDetails?.loginId || user.username || 'User';
  const initials = email.charAt(0).toUpperCase();

  return (
    <div className="relative z-[100]">
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-nebula-800 transition-colors relative z-[101]"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stellar-cyan to-stellar-violet flex items-center justify-center text-cosmos-void font-bold text-sm">
          {initials}
        </div>
        <span className="text-sm text-nebula-300 hidden md:block max-w-[150px] truncate">
          {email}
        </span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop - blocks all clicks */}
          <div
            className="fixed inset-0 z-[102] bg-transparent"
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-56 glass rounded-xl py-2 z-[103] border border-nebula-700/50">
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
        </>
      )}
    </div>
  );
}
