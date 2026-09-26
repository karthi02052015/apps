/**
 * Entry point.
 *
 * Mounts the app and registers the service worker. Nothing else belongs here —
 * every decision about routing, state and storage lives in the modules that
 * own it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('The #root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * The service worker makes the app work offline, which matters more here than
 * in most apps: with no server, being offline changes nothing about what the
 * app can do. Updates are applied silently on the next load rather than
 * interrupting someone mid-entry with a reload prompt.
 */
registerSW({ immediate: true });
