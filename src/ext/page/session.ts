export type Session = { lines?: string[]; at?: string; seq?: number; n?: number; notes?: string[]; page?: { key: string; out: string } };

const MAX_SESSIONS = 4;
const sessions = new Map<string, Session>();

export function session(sid: unknown): Session {
  const key = String(sid ?? '');
  const s = sessions.get(key) ?? {};
  sessions.delete(key);
  sessions.set(key, s);
  if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
  return s;
}

export function settle(quiet = 100, cap = 1500) {
  return new Promise<void>((done) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      obs.disconnect();
      clearTimeout(timer);
      clearTimeout(limit);
      done();
    };
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(finish, quiet);
    });
    obs.observe(document, { childList: true, subtree: true });
    timer = setTimeout(finish, quiet);
    const limit = setTimeout(finish, cap);
  });
}
