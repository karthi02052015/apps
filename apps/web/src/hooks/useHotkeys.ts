import { useEffect, useRef } from 'react';

type Handler = (e: KeyboardEvent) => void;

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};

/**
 * Global keyboard shortcuts. Combos: "mod+k" (⌘ on Mac, Ctrl elsewhere),
 * or single keys like "n", "?" which are ignored while typing in a field.
 */
export function useHotkeys(bindings: Record<string, Handler>) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [combo, handler] of Object.entries(ref.current)) {
        const parts = combo.toLowerCase().split('+');
        const key = parts.at(-1)!;
        const needsMod = parts.includes('mod');
        const mod = e.metaKey || e.ctrlKey;
        if (needsMod !== mod) continue;
        if (!needsMod && (isTyping(e.target) || e.altKey)) continue;
        if (e.key.toLowerCase() === key) {
          e.preventDefault();
          handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
