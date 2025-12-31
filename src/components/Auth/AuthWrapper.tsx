import { useEffect, useState } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import '@aws-amplify/ui-react/styles.css';

interface AuthWrapperProps {
  children: React.ReactNode;
}

/**
 * Wraps the entire app to require authentication.
 * Shows Amplify's built-in Authenticator UI if not logged in.
 */
export function AuthWrapper({ children }: AuthWrapperProps) {
  return (
    <Authenticator
      // Customize the sign-in/sign-up form
      formFields={{
        signUp: {
          email: {
            order: 1,
            placeholder: 'Enter your email',
            label: 'Email',
            isRequired: true,
          },
          password: {
            order: 2,
            placeholder: 'Create a password',
            label: 'Password',
            isRequired: true,
          },
          confirm_password: {
            order: 3,
            placeholder: 'Confirm your password',
            label: 'Confirm Password',
            isRequired: true,
          },
        },
      }}
      // Custom components for branding
      components={{
        Header() {
          return (
            <div className="text-center py-8">
              <h1 className="text-3xl font-display font-bold text-white mb-2">
                Nebula Gallery
              </h1>
              <p className="text-nebula-400">
                Sign in to explore the collection
              </p>
            </div>
          );
        },
        Footer() {
          return (
            <div className="text-center py-4 text-xs text-nebula-500">
              <p>Protected photo gallery. All rights reserved.</p>
            </div>
          );
        },
      }}
      // Hide sign-up if you want invite-only
      // hideSignUp={true}
    >
      {({ signOut, user }) => (
        <AuthenticatedApp signOut={signOut} user={user}>
          {children}
        </AuthenticatedApp>
      )}
    </Authenticator>
  );
}

interface AuthenticatedAppProps {
  children: React.ReactNode;
  signOut?: () => void;
  user?: any;
}

/**
 * Wrapper for authenticated content
 */
function AuthenticatedApp({ children, signOut, user }: AuthenticatedAppProps) {
  return (
    <AuthContext.Provider value={{ user, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// Auth context for accessing user info throughout the app
import { createContext, useContext } from 'react';

interface AuthContextType {
  user: any;
  signOut?: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null });

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Hook to get current user's ID (for ratings, etc.)
 */
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

/**
 * Hook to check if user is authenticated
 */
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

/**
 * User menu component for header
 */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  const email = user.signInDetails?.loginId || user.username || 'User';
  const initials = email.charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-nebula-800 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-stellar-cyan flex items-center justify-center text-cosmos-void font-bold">
          {initials}
        </div>
        <span className="text-sm text-nebula-300 hidden md:block max-w-[150px] truncate">
          {email}
        </span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-48 glass rounded-lg py-2 z-50">
            <div className="px-4 py-2 border-b border-nebula-700">
              <p className="text-sm text-white truncate">{email}</p>
              <p className="text-xs text-nebula-400">Signed in</p>
            </div>

            <button
              onClick={() => {
                setIsOpen(false);
                signOut?.();
              }}
              className="w-full px-4 py-2 text-left text-sm text-nebula-300 hover:bg-nebula-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Custom styles for the Authenticator
 * Add this to your index.css or a separate file
 */
export const authenticatorStyles = `
  /* Override Amplify UI styles to match Nebula theme */
  [data-amplify-authenticator] {
    --amplify-components-authenticator-router-background-color: rgba(26, 26, 46, 0.9);
    --amplify-components-authenticator-router-border-color: rgba(99, 102, 241, 0.3);
    --amplify-components-button-primary-background-color: #22d3ee;
    --amplify-components-button-primary-color: #0a0a0f;
    --amplify-components-button-primary-hover-background-color: #06b6d4;
    --amplify-components-fieldcontrol-border-color: rgba(99, 102, 241, 0.3);
    --amplify-components-fieldcontrol-focus-border-color: #22d3ee;
    --amplify-components-tabs-item-active-color: #22d3ee;
    --amplify-components-tabs-item-active-border-color: #22d3ee;
    --amplify-colors-background-primary: #0a0a0f;
    --amplify-colors-background-secondary: #1a1a2e;
    --amplify-colors-font-primary: #ffffff;
    --amplify-colors-font-secondary: #a0aec0;
  }

  [data-amplify-authenticator] [data-amplify-router] {
    background: linear-gradient(135deg, rgba(26, 26, 46, 0.95), rgba(10, 10, 15, 0.98));
    backdrop-filter: blur(20px);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }

  [data-amplify-authenticator] input {
    background: rgba(26, 26, 46, 0.8);
    border-color: rgba(99, 102, 241, 0.3);
    color: white;
  }

  [data-amplify-authenticator] input:focus {
    border-color: #22d3ee;
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.2);
  }

  [data-amplify-authenticator] label {
    color: #a0aec0;
  }

  [data-amplify-authenticator] a {
    color: #22d3ee;
  }

  [data-amplify-authenticator] a:hover {
    color: #06b6d4;
  }
`;
