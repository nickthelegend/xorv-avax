import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth') as ScrollBehavior;

/** Scroll to an element id once it exists (data-driven sections can render a moment after navigation). */
export function scrollToId(id: string, tries = 20) {
  const el = document.getElementById(id);
  if (el) { el.scrollIntoView({ behavior: smooth(), block: 'start' }); return; }
  if (tries > 0) setTimeout(() => scrollToId(id, tries - 1), 150);
}

export function navigate(to: string) {
  const hash = to.split('#')[1];
  if (to !== location.pathname + location.search + location.hash) {
    history.pushState(null, '', to);
    listeners.forEach((l) => l());
  }
  if (hash) requestAnimationFrame(() => scrollToId(hash));
  else window.scrollTo({ top: 0 });
}

export function usePath() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    listeners.add(on);
    window.addEventListener('popstate', on);
    return () => { listeners.delete(on); window.removeEventListener('popstate', on); };
  }, []);
  return path;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || (rest.target && rest.target !== '_self')) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={click} {...rest} />;
}
