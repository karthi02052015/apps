import { EventEmitter } from 'node:events';
import type { Client as PgClient } from 'pg';
import type { RealtimeEvent } from '@taskflow/shared';
import type { Logger } from '../lib/logger';

type Listener = (event: RealtimeEvent) => void;

/**
 * Per-user fan-out for realtime events. The in-memory implementation serves a
 * single instance; PostgresBus uses LISTEN/NOTIFY so every API replica
 * receives every event with no extra infrastructure.
 */
export interface RealtimeBus {
  publish(userId: string, event: RealtimeEvent): void;
  subscribe(userId: string, listener: Listener): () => void;
  listenerCount(userId: string): number;
  close(): Promise<void>;
}

export class InMemoryBus implements RealtimeBus {
  protected readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(userId: string, event: RealtimeEvent): void {
    this.deliver(userId, event);
  }
  protected deliver(userId: string, event: RealtimeEvent): void {
    this.emitter.emit(userId, event);
  }
  subscribe(userId: string, listener: Listener): () => void {
    this.emitter.on(userId, listener);
    return () => this.emitter.off(userId, listener);
  }
  listenerCount(userId: string): number {
    return this.emitter.listenerCount(userId);
  }
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

const CHANNEL = 'taskflow_events';

export class PostgresBus extends InMemoryBus {
  private client: PgClient | undefined;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
  ) {
    super();
  }

  async start(): Promise<void> {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: this.url });
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { u, e } = JSON.parse(msg.payload) as { u: string; e: RealtimeEvent };
        this.deliver(u, e);
      } catch (err) {
        this.logger.warn({ err }, 'dropping malformed realtime payload');
      }
    });
    const onDrop = (err?: Error) => {
      if (this.client !== client) return; // already handled
      this.client = undefined;
      this.logger.error({ err }, 'realtime LISTEN connection lost — reconnecting');
      this.scheduleReconnect();
    };
    client.on('error', onDrop);
    client.on('end', () => onDrop());
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
    this.attempt = 0;
  }

  /** Reconnect forever with capped exponential backoff — a DB failover must not silence realtime. */
  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start().catch((err) => {
        this.logger.error({ err, attempt: this.attempt }, 'realtime reconnect failed');
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  override publish(userId: string, event: RealtimeEvent): void {
    const payload = JSON.stringify({ u: userId, e: event });
    // NOTIFY payloads are capped at 8000 bytes; fall back to a lightweight invalidation.
    const safe = payload.length < 7_500 ? payload : JSON.stringify({ u: userId, e: { type: 'tasks.changed', taskIds: [] } });
    if (!this.client) {
      this.deliver(userId, event);
      return;
    }
    this.client.query('SELECT pg_notify($1, $2)', [CHANNEL, safe]).catch((err) => {
      this.logger.error({ err }, 'pg_notify failed — delivering locally');
      this.deliver(userId, event);
    });
  }

  override async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    await super.close();
    const c = this.client;
    this.client = undefined;
    await c?.end().catch(() => undefined);
  }
}
