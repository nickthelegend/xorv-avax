import './polyfills';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WalletProvider } from './lib/wallet';
import './styles.css';

// The Snowtrace (Routescan) API sits behind a Cloudflare cache keyed by URL, and the SDK asks for
// toBlock=latest, so a reply cached before new events existed can be served for an hour. Give explorer
// requests a 15-second bucket so each read sees fresh logs.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.routescan.io/')) return nativeFetch(`${url}&fresh=${Math.floor(Date.now() / 15_000)}`, init);
  return nativeFetch(input, init);
};

createRoot(document.getElementById('root')!).render(<WalletProvider><App /></WalletProvider>);
