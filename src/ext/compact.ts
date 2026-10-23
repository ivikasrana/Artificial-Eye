export function paginate(s: string, off: number, max: number) {
  let chunk = s.slice(off, off + max);
  if (off + max < s.length) {
    const nl = chunk.lastIndexOf('\n');
    if (nl > max * 0.5) chunk = chunk.slice(0, nl);
    const next = off + chunk.length;
    return `${chunk}\n…${s.length - next} more chars (offset=${next})`;
  }
  return chunk || '(empty)';
}

export function diffLines(prev: string[], next: string[]) {
  const left = new Map<string, number>();
  for (const l of prev) left.set(l, (left.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of next) {
    const n = left.get(l) ?? 0;
    if (n) left.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const l of prev) {
    const n = left.get(l) ?? 0;
    if (n) {
      left.set(l, n - 1);
      removed.push(l);
    }
  }
  return { added, removed };
}

export const MIN_RUN = 6;
export const KEEP_RUN = 3;
const MAX_PERIOD = 4;

function same(sigs: string[], a: number, b: number, p: number) {
  for (let j = 0; j < p; j++) if (sigs[a + j] !== sigs[b + j]) return false;
  return true;
}

function bestRun(sigs: string[], i: number) {
  let span = 0;
  let period = 0;
  for (let p = 1; p <= MAX_PERIOD; p++) {
    let r = 1;
    while (i + (r + 1) * p <= sigs.length && same(sigs, i, i + r * p, p)) r++;
    if (r >= MIN_RUN && r * p > span) {
      span = r * p;
      period = p;
    }
  }
  return { span, period };
}

export function collapse(lines: string[], sigs: string[], indent: (i: number) => string) {
  const out: string[] = [];
  let hidden = 0;
  let i = 0;
  while (i < lines.length) {
    const { span, period } = bestRun(sigs, i);
    if (!period) {
      out.push(lines[i++]);
      continue;
    }
    const keep = KEEP_RUN * period;
    out.push(...lines.slice(i, i + keep), `${indent(i)}… +${(span - keep) / period} similar`);
    hidden += span - keep;
    i += span;
  }
  return { lines: out, hidden };
}

export function groupRepeats<T>(items: T[], key: (t: T) => string): { item: T; n: number }[] {
  const groups = new Map<string, { item: T; n: number }>();
  for (const item of items) {
    const k = key(item);
    const n = (groups.get(k)?.n ?? 0) + 1;
    groups.delete(k);
    groups.set(k, { item, n });
  }
  return [...groups.values()];
}

export const times = (n: number) => (n > 1 ? ` (x${n})` : '');
