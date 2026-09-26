import { Link } from 'react-router-dom';
import { LogoMark } from '../components/ui/Logo';

export function NotFoundPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="text-center">
        <LogoMark className="mx-auto size-10 opacity-60" />
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1.5 text-[14px] text-muted">The page you're looking for doesn't exist or was moved.</p>
        <Link to="/today" className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-contrast">
          Back to Today
        </Link>
      </div>
    </div>
  );
}
