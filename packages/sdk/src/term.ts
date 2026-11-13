/** Terminal styling for the xorv CLIs: ANSI only on a TTY (or FORCE_COLOR=1), plain text otherwise (NO_COLOR wins). */
const on = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR === '1' || !!process.stdout.isTTY);
const wrap = (a: string, b = '0') => (s: string | number) => (on() ? `\x1b[${a}m${s}\x1b[${b}m` : String(s));

export const t = {
  b: wrap('1', '22'),
  dim: wrap('2', '22'),
  ok: wrap('32', '39'),
  bad: wrap('31', '39'),
  warn: wrap('33', '39'),
  acc: wrap('36', '39'),
};

export const tick = () => t.ok('✓');
export const cross = () => t.bad('✗');

/** Word-wraps text to `width` columns, each line prefixed by `indent`. */
export function wrapText(text: string, width = 88, indent = '  ') {
  const out: string[] = [];
  for (const para of text.trim().split(/\n+/)) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > width - indent.length) {
        out.push(indent + line.trim());
        line = w;
      } else line += ' ' + w;
    }
    if (line.trim()) out.push(indent + line.trim());
  }
  return out.join('\n');
}
