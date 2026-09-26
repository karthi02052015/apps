import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function FullPageSpinner({ inline = false, label = 'Loading' }: { inline?: boolean; label?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        inline ? 'min-h-[40vh]' : 'min-h-dvh bg-canvas',
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
