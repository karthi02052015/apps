import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-pop data-[state=open]:animate-fade-in',
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  shortcut,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: string;
}) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {icon ? <span className="text-muted [&>svg]:size-4">{icon}</span> : null}
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="text-[11.5px] text-subtle">{shortcut}</span> : null}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium uppercase tracking-wide text-subtle">{children}</DM.Label>
);
