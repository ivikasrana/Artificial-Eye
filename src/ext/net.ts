import { groupRepeats, times } from './compact';
import { api, clip } from './env';

interface Req {
  id: string;
  m: string;
  url: string;
  type: string;
  t: number;
  status?: number;
  ms?: number;
  err?: string;
}

const MAX = 300;
const byTab = new Map<number, Req[]>();
const pageStart = new Map<number, number>();
const STATIC = new Set(['image', 'font', 'stylesheet', 'media', 'imageset', 'object']);
const filter = { urls: ['<all_urls>'] };

function find(tabId: number, id: string) {
  return byTab.get(tabId)?.findLast((r) => r.id === id);
}

api.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  let list = byTab.get(d.tabId);
  if (!list) byTab.set(d.tabId, (list = []));
  if (d.type === 'main_frame' && !list.some((r) => r.id === d.requestId)) pageStart.set(d.tabId, d.timeStamp);
  list.push({ id: d.requestId, m: d.method, url: d.url, type: d.type, t: d.timeStamp });
  if (list.length > MAX) list.shift();
  return undefined;
}, filter);

api.webRequest.onBeforeRedirect.addListener((d) => {
  const r = find(d.tabId, d.requestId);
  if (r) {
    r.status = d.statusCode;
    r.ms = Math.round(d.timeStamp - r.t);
  }
}, filter);

api.webRequest.onCompleted.addListener((d) => {
  const r = find(d.tabId, d.requestId);
  if (r) {
    r.status = d.statusCode;
    r.ms = Math.round(d.timeStamp - r.t);
  }
}, filter);

api.webRequest.onErrorOccurred.addListener((d) => {
  const r = find(d.tabId, d.requestId);
  if (r) {
    r.err = d.error;
    r.ms = Math.round(d.timeStamp - r.t);
  }
}, filter);

api.tabs.onRemoved.addListener((id) => {
  byTab.delete(id);
  pageStart.delete(id);
});

api.tabs.onUpdated.addListener((id, info) => {
  const start = pageStart.get(id);
  const list = byTab.get(id);
  if (info.status !== 'loading' || start == null || !list) return;
  byTab.set(id, list.filter((r) => r.t >= start));
});

export function netLines(
  tabId: number,
  o: { q?: string; n: number; all?: boolean; failed?: boolean; clear?: boolean; since?: number },
) {
  let list = byTab.get(tabId) ?? [];
  if (o.failed) list = list.filter((r) => r.err || (r.status ?? 0) >= 400);
  else if (!o.all) list = list.filter((r) => !STATIC.has(r.type));
  if (o.q) list = list.filter((r) => r.url.includes(o.q!));
  if (o.since) list = list.filter((r) => r.t >= o.since!);
  const status = (r: Req) => (r.err ? 'ERR ' + r.err : String(r.status ?? '…'));
  const out = groupRepeats(list, (r) => `${status(r)} ${r.m} ${r.url}`)
    .slice(-o.n)
    .map(({ item: r, n }) => `${status(r)} ${r.m} ${r.ms ?? '?'}ms ${r.type} ${clip(r.url, 150)}${times(n)}`);
  if (o.clear) byTab.delete(tabId);
  return out.join('\n');
}
