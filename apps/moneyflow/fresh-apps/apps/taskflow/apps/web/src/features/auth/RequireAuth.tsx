import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LogoMark } from '../../components/ui/Logo';
import { useAuth } from './AuthProvider';

export function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading TaskFlow">
      <LogoMark className="size-10 animate-pulse" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'authenticated') return <Navigate to="/today" replace />;
  return <>{children}</>;
}
