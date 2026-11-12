import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Connect } from 'vite';

// Vite's static middleware otherwise throws a URIError and returns a raw 500 for a
// malformed bookmark. Send those requests to the app's existing not-found page.
const validPath: Connect.NextHandleFunction = (req, res, next) => {
  try { decodeURIComponent((req.url ?? '/').split('?')[0]); }
  catch { res.writeHead(302, { location: '/missing' }); res.end(); return; }
  next();
};
const safeAddresses = {
  name: 'safe-addresses',
  configureServer(server: { middlewares: Connect.Server }) { server.middlewares.use(validPath); },
  configurePreviewServer(server: { middlewares: Connect.Server }) { server.middlewares.use(validPath); },
};

// The chat, credits and API-key pages talk to the local Xorv gateway (packages/gateway) through this proxy.
// Without a running gateway those pages show "Setup required"; every other page reads the contract directly.
const gateway = process.env.XORV_GATEWAY_URL ?? 'http://127.0.0.1:5421';
// When the gateway process is down the proxy answers with a small JSON status instead of a 500,
// so the app can show "Setup required: start the gateway" without a console error on every poll.
const offline = (proxy: any) => proxy.on('error', (_e: unknown, _req: unknown, res: any) => {
  if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
  res.writeHead(200, { 'content-type': 'application/json', 'x-xorv-gateway': 'offline' });
  res.end(JSON.stringify({ gateway_offline: true, error: { message: `The Xorv gateway is not running at ${gateway}.`, setup: 'gateway' } }));
});
const proxy = {
  '/api': { target: gateway, changeOrigin: true, configure: offline },
  '/v1': { target: gateway, changeOrigin: true, timeout: 200_000, proxyTimeout: 200_000, configure: offline },
};
export default defineConfig({ plugins: [safeAddresses, react()], server: { fs: { allow: ['../..'] }, proxy }, preview: { proxy } });
