import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton } from './Ui';

/** Plain text of rendered children (for the code block copy button). */
function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return '';
}

const components: Components = {
  pre({ children }) {
    const code = Children.toArray(children)[0];
    const cls = isValidElement(code) ? String((code.props as { className?: string }).className ?? '') : '';
    const lang = cls.match(/language-([\w+-]+)/)?.[1] ?? '';
    const text = textOf(children).replace(/\n$/, '');
    return (
      <div className="md-code">
        <div className="md-code-h"><span>{lang || 'code'}</span><CopyButton text={text} className="btn btn-sm btn-ghost" /></div>
        <pre>{children}</pre>
      </div>
    );
  },
  table({ children }) { return <div className="md-table"><table>{children}</table></div>; },
  a({ href, children }) { return <a href={href} target="_blank" rel="noreferrer noopener" className="link">{children}</a>; },
  img({ alt }) { return <span className="faint">[image: {alt || 'no description'}]</span>; },
};

/**
 * A model answer rendered as GitHub-flavoured markdown: headings, lists, tables, inline code,
 * links and fenced code with a copy button. Raw HTML in the answer is never rendered (no rehype-raw),
 * unsafe link protocols are dropped by react-markdown's default URL filter, and images are not loaded.
 */
export function Md({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{text}</ReactMarkdown></div>;
}
