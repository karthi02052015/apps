import { CheckCircle2, Sparkles, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '../../components/ui/Logo';

const highlights = [
  { icon: Sparkles, text: 'Type naturally — "Ship deck friday 3pm #work !high" just works.' },
  { icon: Zap, text: 'Today, Upcoming and Board views that keep you in flow.' },
  { icon: CheckCircle2, text: 'Reminders, recurring tasks and streaks that help you finish.' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0d0d1a] p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, rgba(124,124,248,0.35), transparent 60%), radial-gradient(50% 40% at 90% 90%, rgba(236,72,153,0.18), transparent 60%)',
          }}
        />
        <div className="relative">
          <Logo className="[&>span:last-child]:text-white" />
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
            Plan it.
            <br />
            Do it.
            <br />
            <span className="bg-gradient-to-r from-[#a5a5fb] to-[#f0abfc] bg-clip-text text-transparent">Finish it.</span>
          </h2>
          <ul className="mt-10 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-[14.5px] leading-relaxed text-white/75">
                <Icon className="mt-0.5 size-5 shrink-0 text-[#a5a5fb]" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-[12.5px] text-white/40">© {new Date().getFullYear()} TaskFlow</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-[13.5px] text-muted">{footer}</div>
        </div>
      </main>
    </div>
  );
}
