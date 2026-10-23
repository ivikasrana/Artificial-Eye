import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapse, diffLines, groupRepeats, KEEP_RUN, paginate } from '../src/ext/compact.ts';

test('paginate cuts on a line break and reports the next offset', () => {
  const s = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const out = paginate(s, 0, 100);
  assert.match(out, /more chars \(offset=\d+\)$/);
  const next = Number(out.match(/offset=(\d+)/)![1]);
  assert.equal(s[next], '\n');
  assert.equal(paginate('', 0, 100), '(empty)');
});

test('diffLines reports only what changed, counting duplicates', () => {
  const prev = ['e1 button "Save"', 'e2 link "Home"', 'e3 link "Home"', 'dialog "Confirm"'];
  const next = ['e1 button "Save" disabled', 'e2 link "Home"', 'e3 link "Home"', 'status "Saved"'];
  const d = diffLines(prev, next);
  assert.deepEqual(d.removed, ['e1 button "Save"', 'dialog "Confirm"']);
  assert.deepEqual(d.added, ['e1 button "Save" disabled', 'status "Saved"']);
  assert.deepEqual(diffLines(['a', 'a'], ['a']), { added: [], removed: ['a'] });
  assert.deepEqual(diffLines(['a'], ['a']), { added: [], removed: [] });
});

test('collapse keeps short runs untouched', () => {
  const lines = ['# Title', 'e1 link "a"', 'e2 link "b"', 'e3 button "go"'];
  const sigs = ['0 #', '0 link', '0 link', '0 button'];
  const c = collapse(lines, sigs, () => '');
  assert.equal(c.hidden, 0);
  assert.deepEqual(c.lines, lines);
});

test('collapse folds repeated single rows and multi-row cards', () => {
  const rows = Array.from({ length: 40 }, (_, i) => `e${i} link "item ${i}"`);
  const c1 = collapse(rows, rows.map(() => '0 link'), () => '');
  assert.equal(c1.lines.length, KEEP_RUN + 1);
  assert.equal(c1.lines.at(-1), `… +${40 - KEEP_RUN} similar`);

  const lines: string[] = [];
  const sigs: string[] = [];
  for (let i = 0; i < 20; i++) {
    lines.push(`## Result ${i}`, `e${i * 2} link "Open ${i}"`, `e${i * 2 + 1} button "Save"`);
    sigs.push('0 ##', '0 link', '0 button');
  }
  const c2 = collapse(lines, sigs, () => '  ');
  assert.equal(c2.hidden, (20 - KEEP_RUN) * 3);
  assert.equal(c2.lines.length, KEEP_RUN * 3 + 1);
  assert.equal(c2.lines.at(-1), `  … +${20 - KEEP_RUN} similar`);
});

test('token budget: a 300-result listing stays small after collapse', () => {
  const lines = ['e0 input "Search" ="shoes"'];
  const sigs = ['0 input'];
  for (let i = 1; i <= 300; i++) {
    lines.push(`### Product number ${i} with a fairly long name`, `e${i} link "Buy now" →/p/${i}`);
    sigs.push('0 ###', '0 link');
  }
  const full = lines.join('\n');
  const out = collapse(lines, sigs, () => '').lines.join('\n');
  assert.ok(full.length > 15_000);
  assert.ok(out.length < 400, `collapsed output is ${out.length} chars`);
});

test('groupRepeats merges by key and keeps the latest position', () => {
  const reqs = ['GET /poll', 'GET /a', 'GET /poll', 'POST /save', 'GET /poll'];
  const g = groupRepeats(reqs, (r) => r);
  assert.deepEqual(g, [
    { item: 'GET /a', n: 1 },
    { item: 'POST /save', n: 1 },
    { item: 'GET /poll', n: 3 },
  ]);
});
