import { cn } from '../../lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id="tf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b8bfa" />
          <stop offset="1" stopColor="#5b5bf0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#tf-g)" />
      <path d="M19 33.5l8.5 8.5L45 24.5" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">TaskFlow</span>
    </span>
  );
}
