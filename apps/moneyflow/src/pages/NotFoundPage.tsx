import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Compass className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-ink">That page does not exist</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-2">
        The link may be out of date, or the page may have moved.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand/90"
      >
        Back to the dashboard
      </Link>
      <Button variant="link" className="mt-3" onClick={() => window.history.back()}>
        Or go back
      </Button>
    </div>
  );
}
