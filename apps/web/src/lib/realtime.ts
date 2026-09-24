import type { RealtimeEvent } from '@taskflow/shared';
import { authStore } from './authStore';
import { refreshSession, timeZone } from './api';

/**
 * Realtime client over Server-Sent Events, read with fetch() so the access
 * token goes in a header (EventSource can't set headers, and tokens in URLs
 * leak into logs). Reconnects with capped exponential backoff + jitter.
 */
export function connectRealtime(onEvent: (e: RealtimeEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt) * (0.5 + Math.random() / 2);
    attempt++;
    timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (stopped) return;
    const token = authStore.get().accessToken;
    if (!token) return schedule();
    controller = new AbortController();
    try {
      const res = await fetch('/api/v1/events', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'X-Timezone': timeZone },
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        await refreshSession().catch(() => null);
        return schedule();
      }
      if (!res.ok || !res.body) return schedule();
      attempt = 0;
      onStatus?.(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data) continue;
          try {
            onEvent(JSON.parse(data) as RealtimeEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch {
      /* network drop or abort */
    }
    onStatus?.(false);
    // The server closes the stream when the access token expires; the next
    // attempt gets a 401 (or a fresh token from the proactive refresh) and recovers.
    schedule();
  };

  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
