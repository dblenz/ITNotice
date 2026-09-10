import { useAuth } from 'react-oidc-context';
import { config } from './config';
import { setTokenProvider } from './api';

export interface Session {
  ready: boolean;
  authenticated: boolean;
  username: string;
  roles: string[];
  login: () => void;
  logout: () => void;
}

const allRoles = ['admin', 'approver', 'author', 'employee'];

/** Wraps react-oidc-context; falls back to a dev session when auth is disabled. */
export function useSession(): Session {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const auth = config.authDisabled ? null : useAuth();

  if (!auth) {
    setTokenProvider(() => undefined);
    return {
      ready: true,
      authenticated: true,
      username: 'dev.user',
      roles: allRoles,
      login: () => {},
      logout: () => {},
    };
  }

  setTokenProvider(() => auth.user?.access_token);

  const profile = auth.user?.profile as Record<string, any> | undefined;
  const realmRoles: string[] = profile?.realm_access?.roles || [];

  return {
    ready: !auth.isLoading,
    authenticated: auth.isAuthenticated,
    username: (profile?.preferred_username as string) || '',
    roles: realmRoles.filter((role) => allRoles.includes(role)),
    login: () => void auth.signinRedirect(),
    logout: () => void auth.signoutRedirect(),
  };
}
