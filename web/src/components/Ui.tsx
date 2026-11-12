import { useEffect, useState, type ReactNode } from 'react';

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

const paths: Record<string, string> = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  chevD: 'M6 9l6 6 6-6',
  jobs: 'M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z',
  nodes: 'M5 4h14v6H5zM5 14h14v6H5zM8 7h.01M8 17h.01',
  index: 'M4 19h16M6 15l4-5 3 3 5-7',
  book: 'M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h9',
  seal: 'M4 7l8 6 8-6M4 7v11h16V7zM12 13v0',
  envelope: 'M3 7h18v12H3zM3 7l9 7 9-7',
  play: 'M8 5l11 7-11 7z',
  scale: 'M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z',
  bug: 'M9 7a3 3 0 0 1 6 0M8 9h8v6a4 4 0 0 1-8 0zM4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  shield: 'M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  filter: 'M4 6h16M7 12h10M10 18h4',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  zap: 'M13 3L5 14h6l-1 7 8-11h-6z',
  gauge: 'M4 15a8 8 0 1 1 16 0M12 15l4-5',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 1.9-3 .9-3 1.9 1.3 1.8 3 1.8 3-.8 3-1.8M12 6v1.7M12 16.3V18',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  sort: 'M8 5v14M5 8l3-3 3 3M16 19V5M13 16l3 3 3-3',
  slash: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM6 18L18 6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  key: 'M14 10a4 4 0 1 0-3.5 4H12v2h2v2h3v-3l-3-3.5A4 4 0 0 0 14 10zM8.5 10.5h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  side: 'M4 5h16v14H4zM9 5v14',
  wallet: 'M4 7h15v12H4zM4 7l11-3v3M15 13h.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** The Xorv mark (interlocking chevrons around a square node), drawn white. */
export function Mark({ size = 26 }: { size?: number }) {
  return <img className="mark" src="/brand/xorv-mark-white.png" width={size} height={size} alt="" aria-hidden="true" />;
}
export function Wordmark() {
  return <span className="wordmark"><Mark /><span>Xorv</span></span>;
}

/** Copy text to the clipboard with a short "Copied" confirmation. */
export function CopyButton({ text, label = 'Copy', className = 'btn btn-sm' }: { text: string; label?: string; className?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return <button type="button" className={className} title={status === 'failed' ? 'Clipboard unavailable. Select the text and copy it manually, or retry.' : undefined} onClick={async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 1400);
    } catch { setStatus('failed'); }
  }}>{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}</button>;
}

/** The monochrome 3D object kit (docs/ART-3D.md). Decorative next to a heading, so alt text is only read when asked. */
const ART = {
  gpu: 'Graphics card', chat: 'Chat bubble', envelope: 'Sealed envelope', gavel: 'Gavel on its block', rack: 'Server rack',
  coin: 'Coin', key: 'Key', magnifier: 'Magnifying glass', shield: 'Cracked shield', empty: 'Empty tray',
  success: 'Check-mark badge', warning: 'Warning sign', trophy: 'Trophy',
  hero: 'A chat bubble on an auction block, with a gavel', pay: 'A coin going into a slot', bids: 'Three sealed envelopes',
  index: 'A rising price line on a stand', app: 'A laptop showing a chat',
} as const;
export type ArtName = keyof typeof ART;
export function Art({ name, size = 96, label, className = '' }: { name: ArtName; size?: number; label?: boolean; className?: string }) {
  return (
    <span className={`art3d ${className}`} style={{ width: size, height: size }} aria-hidden={label ? undefined : true}>
      <img src={`/art/3d/xorv-3d-${name}.webp`} width={size} height={size} alt={label ? ART[name] : ''} loading="lazy" decoding="async" />
    </span>
  );
}

export function State({ kind, title, children, action, art }: { kind: 'loading' | 'empty' | 'error' | 'setup'; title: string; children?: ReactNode; action?: ReactNode; art?: ArtName }) {
  return (
    <div className={`state state-${kind}${art ? ' state-art' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      {art ? <Art name={art} size={72} /> : <span className="state-mark" aria-hidden="true">{kind === 'loading' ? <i className="pulse" /> : kind === 'error' ? '!' : kind === 'setup' ? '◇' : '○'}</span>}
      <div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
    </div>
  );
}
