import { motion } from 'motion/react';

export function ProgressRing({ value, total, size = 44 }: { value: number; total: number; size?: number }) {
  const pct = total ? value / total : 0;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${total} done`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pct === 1 ? 'var(--success)' : 'var(--accent)'}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}
