import { lazy, Suspense } from 'react';

// The markdown renderer (react-markdown + remark-gfm) loads only when an answer is on screen.
const Inner = lazy(() => import('./Md').then((m) => ({ default: m.Md })));

/** Markdown answer; shows the plain text while the renderer loads. */
export function Md({ text }: { text: string }) {
  return <Suspense fallback={<div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}><Inner text={text} /></Suspense>;
}
