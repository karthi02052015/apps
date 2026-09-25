import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Visually hide the title (still announced to screen readers). */
  hideTitle?: boolean;
}

export function Modal({ open, onOpenChange, title, description, children, className, hideTitle }: BaseProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-2xl border border-border bg-surface p-6 shadow-pop outline-none data-[state=open]:animate-fade-in',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className={cn(hideTitle && 'sr-only')}>
              <RD.Title className="text-[17px] font-semibold tracking-tight">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-[13.5px] text-muted">{description}</RD.Description> : null}
            </div>
            {!description && !hideTitle ? <RD.Description className="sr-only">{title}</RD.Description> : null}
            <RD.Close className="-mr-2 -mt-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </RD.Close>
          </div>
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Right-hand sheet on desktop, full-height bottom sheet on mobile. */
export function Sheet({ open, onOpenChange, title, children, className }: BaseProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-fade-in md:bg-black/10" />
        <RD.Content
          className={cn(
            'fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col rounded-t-2xl border border-border bg-surface shadow-pop outline-none md:inset-y-2 md:left-auto md:right-2 md:top-2 md:w-[480px] md:rounded-2xl md:data-[state=open]:animate-slide-in',
            className,
          )}
        >
          <RD.Title className="sr-only">{title}</RD.Title>
          <RD.Description className="sr-only">{title}</RD.Description>
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export const SheetClose = RD.Close;
