import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, RegisterInput, UserDTO } from '@taskflow/shared';
import { api, refreshSession, timeZone } from '../../lib/api';
import { authStore, type AuthState } from '../../lib/authStore';

interface AuthContextValue extends AuthState {
  login(input: LoginInput): Promise<void>;
  register(input: Omit<RegisterInput, 'timezone'>): Promise<void>;
  logout(): Promise<void>;
  setUser(user: UserDTO): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
  const queryClient = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Refresh a minute before the access token expires so requests never hit a 401. */
  const scheduleRefresh = useCallback((expiresIn: number) => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(
      () => {
        void refreshSession()
          .then((r) => r && scheduleRefresh(r.expiresIn))
          .catch(() => scheduleRefresh(30));
      },
      Math.max(expiresIn - 60, 10) * 1000,
    );
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((r) => {
        if (!cancelled && r) scheduleRefresh(r.expiresIn);
      })
      .catch(() => {
        // Offline on boot: we can't know yet — show the sign-in screen; it recovers when online.
        if (!cancelled) authStore.signOut();
      });
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer.current);
    };
  }, [scheduleRefresh]);

  const onAuthed = useCallback(
    (r: AuthResponse) => {
      queryClient.clear(); // never show a previous user's cached data
      authStore.signIn(r.user, r.accessToken);
      scheduleRefresh(r.expiresIn);
    },
    [queryClient, scheduleRefresh],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: async (input) => onAuthed(await api<AuthResponse>('/auth/login', { method: 'POST', body: input })),
      register: async (input) =>
        onAuthed(await api<AuthResponse>('/auth/register', { method: 'POST', body: { ...input, timezone: timeZone } })),
      logout: async () => {
        clearTimeout(refreshTimer.current);
        try {
          await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'taskflow' }, credentials: 'same-origin' });
        } finally {
          authStore.signOut();
          queryClient.clear();
        }
      },
      setUser: (user) => authStore.set({ user }),
    }),
    [state, onAuthed, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
