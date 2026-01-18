import { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { IS_LOCAL_DEV } from '@/config';

/**
 * Hook to check if the current user is an admin (member of "Admins" Cognito group)
 * In local dev mode, always returns true for testing.
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const [isAdmin, setIsAdmin] = useState(IS_LOCAL_DEV);
  const [isLoading, setIsLoading] = useState(!IS_LOCAL_DEV);

  useEffect(() => {
    // In local dev, skip checking - already set to true
    if (IS_LOCAL_DEV) return;

    async function checkAdminStatus() {
      try {
        const session = await fetchAuthSession();
        const groups = session.tokens?.accessToken?.payload['cognito:groups'] as string[] | undefined;
        setIsAdmin(groups?.includes('Admins') ?? false);
      } catch {
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkAdminStatus();
  }, []);

  return { isAdmin, isLoading };
}
