import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';

interface State {
  error: Error | null;
}

/**
 * The last line of defence.
 *
 * A render-time crash in one screen must not leave the user staring at a white
 * page with their financial data apparently gone. The raw error is logged to
 * the console for a developer but never shown — the user sees a plain
 * explanation and a way out (section 37).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production this is where a reporter (Sentry et al.) would be called.
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-negative-soft text-negative">
            <AlertTriangle className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-2">
            This screen ran into a problem. Your data is safe — nothing was changed.
            Reloading usually fixes it.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            <Button variant="outline" onClick={() => { window.location.href = '/'; }}>
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
