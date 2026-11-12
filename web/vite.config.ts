import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api and /v1 go to the local Xorv gateway (packages/gateway). When it is down the proxy answers
// with a small JSON status so the app shows "Setup required" instead of a console error per poll.
// Every page that does not need the gateway reads Avalanche Fuji directly.
const gateway = process.env.XORV_GATEWAY_URL ?? 'http://127.0.0.1:5421';
const offline = (proxy: any) =>
  proxy.on('error', (_e: unknown, _req: unknown, res: any) => {
    if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
    res.writeHead(200, { 'content-type': 'application/json', 'x-xorv-gateway': 'offline' });
    res.end(JSON.stringify({ gateway_offline: true, error: { message: `The Xorv gateway is not running at ${gateway}.` } }));
  });
const proxy = {
  '/api': { target: gateway, changeOrigin: true, timeout: 200_000, proxyTimeout: 200_000, configure: offline },
  '/v1': { target: gateway, changeOrigin: true, timeout: 200_000, proxyTimeout: 200_000, configure: offline },
};
export default defineConfig({ plugins: [react()], server: { fs: { allow: ['..'] }, proxy }, preview: { proxy }, build: { chunkSizeWarningLimit: 900 } });
