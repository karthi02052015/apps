import type { ReactNode } from 'react';

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent [&>svg]:size-6">{icon}</div>
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {description ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
