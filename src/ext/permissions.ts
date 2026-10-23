import { settings } from './state';

type Access = { ok: true } | { ok: false; blocked?: string; error: string };

const matches = (host: string, list: string[]) =>
  list.some((e) => {
    const d = e.toLowerCase().replace(/:\d+$/, '');
    return host === d || host.endsWith('.' + d);
  });

export function access(url: string | undefined): Access {
  let u: URL;
  try {
    u = new URL(url ?? '');
  } catch {
    return { ok: true };
  }
  if (url === 'about:blank' || u.protocol === 'data:') return { ok: true };
  if (!['http:', 'https:', 'file:'].includes(u.protocol))
    return { ok: false, error: `Browser page ${u.protocol}//${u.host} cannot be controlled; navigate to a website first.` };
  const host = u.hostname || 'file';
  if (matches(host, settings.blocked)) return { ok: false, blocked: host, error: `${host} is blocked by the user.` };
  return { ok: true };
}

export function ensureAllowed(url: string | undefined) {
  const a = access(url);
  if (!a.ok) throw new Error(a.error);
}
