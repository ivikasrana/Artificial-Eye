import { parseKeys } from '../shared/keys';
import { cdp, cdpDrag, cdpEnabled, cdpKeys, cdpMouse, cdpWheel } from './cdp';
import { cs, type Pt } from './tab';

type Via = 'cdp' | 'dom';

async function either(run: () => Promise<unknown>, fallback: () => Promise<unknown>): Promise<Via> {
  if (cdpEnabled() && (await run().then(() => true, () => false))) return 'cdp';
  await fallback();
  return 'dom';
}

export const input = {
  mouse: (id: number, kind: string, p: Pt, ref?: string) =>
    either(
      () => cdpMouse(id, kind, p),
      () => cs(id, { op: 'mouse', kind, ref, x: p.x, y: p.y }),
    ),
  text: (id: number, text: string) =>
    either(
      () => cdp(id, 'Input.insertText', { text }),
      () => cs(id, { op: 'type', text }),
    ),
  keys: (id: number, text: string) =>
    either(
      () => cdpKeys(id, parseKeys(text)),
      () => cs(id, { op: 'key', text }),
    ),
  wheel: (id: number, s: Pt & { dx: number; dy: number }) =>
    either(
      () => cdpWheel(id, s, s.dx, s.dy),
      () => cs(id, { op: 'scroll', ...s }),
    ),
  drag: (id: number, from: Pt, to: Pt) =>
    either(
      () => cdpDrag(id, from, to),
      () => cs(id, { op: 'mouseDrag', from, to }),
    ),
};
