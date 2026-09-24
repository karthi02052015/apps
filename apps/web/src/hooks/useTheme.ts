import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { storage } from '../lib/storage';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'taskflow.theme';
const listeners = new Set<() => void>();

const read = (): ThemePref => {
  const v = storage.get(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
};

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'system' as ThemePref,
  );

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setTheme = useCallback((next: ThemePref) => {
    storage.set(KEY, next);
    listeners.forEach((l) => l());
  }, []);

  const resolved: 'light' | 'dark' =
    pref === 'system' ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;

  return { theme: pref, resolved, setTheme };
}
