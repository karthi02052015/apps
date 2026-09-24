import type { UserDTO } from '@taskflow/shared';

/**
 * Access token lives in memory only (never localStorage) so XSS can't
 * exfiltrate a long-lived credential. The refresh token is an httpOnly cookie.
 */
export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: UserDTO | null;
  accessToken: string | null;
}

let state: AuthState = { status: 'loading', user: null, accessToken: null };
const listeners = new Set<() => void>();

export const authStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(next: Partial<AuthState>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  },
  signIn(user: UserDTO, accessToken: string) {
    this.set({ status: 'authenticated', user, accessToken });
  },
  signOut() {
    this.set({ status: 'anonymous', user: null, accessToken: null });
  },
};
