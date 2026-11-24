import { NO_BROWSER, type Msg, type Role } from '../shared/protocol';

export interface Peer {
  id: string;
  role: Role;
  name: string;
  send(m: Msg): void;
}

export const RELEASE_AFTER = 5 * 60_000;

/** Routes tool calls from agents to a browser and results back. One hub per machine. */
export class Hub {
  private browsers = new Map<string, Peer>();
  private agents = new Map<string, Peer>();
  private pending = new Map<number, { agent: Peer; id: number; browser: string }>();
  private bound = new Map<string, string>();
  private groupOf = new Map<string, string>();
  private releases = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  constructor(private releaseAfter = RELEASE_AFTER) {}

  add(p: Peer) {
    this.of(p.role).set(p.id, p);
  }

  remove(p: Peer) {
    this.of(p.role).delete(p.id);
    for (const [k, q] of this.pending) {
      if (q.browser === p.id) {
        q.agent.send({ t: 'res', id: q.id, ok: false, error: 'Browser disconnected during the call.' });
        this.pending.delete(k);
      } else if (q.agent === p) this.pending.delete(k);
    }
    if (p.role === 'browser') {
      for (const [g, b] of this.bound) if (b === p.id) this.bound.delete(g);
      return;
    }
    const g = this.groupOf.get(p.id);
    this.groupOf.delete(p.id);
    if (g != null && ![...this.groupOf.values()].includes(g)) this.scheduleRelease(g);
  }

  peers(role: Role) {
    return [...this.of(role).values()];
  }

  handle(p: Peer, m: Msg) {
    switch (m.t) {
      case 'hello':
        p.name = m.name;
        return;
      case 'call': {
        if (p.role !== 'agent') return;
        if (m.tool === '__status') {
          p.send({ t: 'res', id: m.id, ok: true, result: { text: this.status() } });
          return;
        }
        const group = m.sid ?? p.id;
        this.join(p, group);
        const b = this.pick(group, m.prefer);
        if (!b) {
          p.send({ t: 'res', id: m.id, ok: false, error: NO_BROWSER });
          return;
        }
        const hid = ++this.seq;
        this.pending.set(hid, { agent: p, id: m.id, browser: b.id });
        b.send({ ...m, id: hid, sid: group });
        return;
      }
      case 'res': {
        if (p.role !== 'browser') return;
        const q = this.pending.get(m.id);
        if (!q) return;
        this.pending.delete(m.id);
        q.agent.send({ ...m, id: q.id });
        return;
      }
    }
  }

  private join(p: Peer, group: string) {
    this.groupOf.set(p.id, group);
    clearTimeout(this.releases.get(group));
    this.releases.delete(group);
  }

  private scheduleRelease(group: string) {
    clearTimeout(this.releases.get(group));
    const t = setTimeout(() => {
      this.releases.delete(group);
      if ([...this.groupOf.values()].includes(group)) return;
      for (const b of this.browsers.values()) b.send({ t: 'release', sid: group });
      this.bound.delete(group);
    }, this.releaseAfter);
    t.unref?.();
    this.releases.set(group, t);
  }

  /** The browser this group already uses, else the latest whose name matches `prefer`, else the most recent. */
  private pick(group: string, prefer?: string): Peer | undefined {
    const want = prefer?.toLowerCase();
    const cur = this.browsers.get(this.bound.get(group) ?? '');
    if (cur && (!want || cur.name.toLowerCase().includes(want))) return cur;
    const list = this.peers('browser');
    const b = (want && list.findLast((x) => x.name.toLowerCase().includes(want))) || list.at(-1);
    if (b) this.bound.set(group, b.id);
    return b;
  }

  private status() {
    const names = (r: Role) => this.peers(r).map((p) => p.name).join(', ') || 'none';
    const groups = [...new Set(this.groupOf.values())]
      .map((g) => `${g} -> ${this.browsers.get(this.bound.get(g) ?? '')?.name ?? 'none'}`)
      .join(', ');
    return `hub pid ${process.pid}\nbrowsers: ${names('browser')}\nagents: ${names('agent')}\ngroups: ${groups || 'none'}`;
  }

  private of(role: Role) {
    return role === 'browser' ? this.browsers : this.agents;
  }
}
