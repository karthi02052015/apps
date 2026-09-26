import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface State {
  error: Error | null;
}

/** Last line of defence: users see a calm recovery screen, never a stack trace. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Hook for an error-reporting service (Sentry etc.) — keep console output for local debugging.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-[20px] font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-[14px] text-muted">An unexpected error occurred. Your data is safe — reloading usually fixes it.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Reload TaskFlow
          </Button>
        </div>
      </div>
    );
  }
}
