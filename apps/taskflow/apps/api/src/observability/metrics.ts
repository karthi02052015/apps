import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'taskflow_' });

export const metrics = {
  httpDuration: new client.Histogram({
    name: 'taskflow_http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),
  sseConnections: new client.Gauge({
    name: 'taskflow_sse_connections',
    help: 'Open realtime connections',
    registers: [registry],
  }),
  authEvents: new client.Counter({
    name: 'taskflow_auth_events_total',
    help: 'Authentication events',
    labelNames: ['event'] as const,
    registers: [registry],
  }),
  notificationsSent: new client.Counter({
    name: 'taskflow_notifications_sent_total',
    help: 'Notifications created by the scheduler',
    labelNames: ['type'] as const,
    registers: [registry],
  }),
  schedulerRuns: new client.Counter({
    name: 'taskflow_scheduler_runs_total',
    help: 'Scheduler ticks',
    labelNames: ['outcome'] as const,
    registers: [registry],
  }),
};
