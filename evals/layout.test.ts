import { describe, it, expect } from 'vitest';
import { parseLayout } from '@/lib/layout';

/**
 * EVAL LAYER 1b — html allow-list (deterministic, no model, no DB).
 * The model writes the layout as html in a closed vocabulary. Anything outside
 * it is rejected with a sentence the retry loop can hand back to the model.
 */
const queries = [
  { id: 'q_rev', sql: 'SELECT 1 AS revenue' },
  { id: 'q_cat', sql: "SELECT 'a' AS category, 1 AS revenue" },
];
const run = (html: string, qs = queries) => parseLayout({ title: 'T', queries: qs, html });
const error = (html: string) => {
  const r = run(html);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
};

describe('Layer 1b — html layout allow-list', () => {
  it('accepts a good layout and converts it to widgets + layout tree', () => {
    const r = run(`
      <!-- note -->
      <h2>Revenue</h2>
      <p>Delivered orders only &amp; prices in BRL.</p>
      <grid-row>
        <kpi-tile title="Revenue" query="q_rev" metric="revenue" />
        <kpi-group title="More"><kpi-tile title="Again" query="q_rev" metric="revenue"></kpi-tile></kpi-group>
      </grid-row>
      <section><bar-chart title="By category" query="q_cat" x="category" series="revenue"></bar-chart></section>`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.widgets.map((w) => w.type)).toEqual(['tile', 'tileGroup', 'chart']);
    expect(r.layout).toEqual([
      { kind: 'text', tag: 'h2', text: 'Revenue' },
      { kind: 'text', tag: 'p', text: 'Delivered orders only & prices in BRL.' },
      { kind: 'row', children: [{ kind: 'widget', index: 0 }, { kind: 'widget', index: 1 }] },
      { kind: 'section', children: [{ kind: 'widget', index: 2 }] },
    ]);
  });

  it.each([
    ['script', '<script>alert(1)</script><kpi-tile title="R" query="q_rev" metric="revenue"/>', '<script> is not allowed'],
    ['event handler', '<kpi-tile title="R" query="q_rev" metric="revenue" onclick="x()"/>', 'does not allow the attribute "onclick"'],
    ['style', '<grid-row style="color:red"><kpi-tile title="R" query="q_rev" metric="revenue"/></grid-row>', 'it takes none'],
    ['link', '<p>hi <a href="https://x.y">x</a></p>', '<a> is not allowed'],
    ['div', '<div><kpi-tile title="R" query="q_rev" metric="revenue"/></div>', '<div> is not allowed'],
    ['unknown query', '<kpi-tile title="R" query="q_nope" metric="revenue"/>', 'points at no query; known ids: q_rev, q_cat'],
    ['missing attribute', '<bar-chart title="C" query="q_cat" x="category"/>', 'needs a non-empty "series"'],
    ['unclosed tag', '<section><kpi-tile title="R" query="q_rev" metric="revenue"/>', '<section> is never closed'],
    ['mismatched close', '<section><kpi-tile title="R" query="q_rev" metric="revenue"/></grid-row></section>', '</grid-row> does not close'],
    ['group with a chart', '<kpi-group title="G"><bar-chart title="C" query="q_cat" x="category" series="revenue"/></kpi-group>', 'may only contain <kpi-tile>'],
    ['loose text', 'hello <kpi-tile title="R" query="q_rev" metric="revenue"/>', 'must sit inside <h2>, <h3> or <p>'],
    ['tag inside text', '<p><kpi-tile title="R" query="q_rev" metric="revenue"/></p>', '<p> cannot contain <kpi-tile>'],
    ['unquoted attribute', '<kpi-tile title=R query="q_rev" metric="revenue"/>', 'malformed attribute'],
    ['stray <', '<p>a < b</p><kpi-tile title="R" query="q_rev" metric="revenue"/>', 'does not start a tag'],
    ['half a delta', '<kpi-tile title="R" query="q_rev" metric="revenue" delta-query="q_rev"/>', 'delta-query and delta-label together'],
    ['no widgets', '<p>nothing here</p>', 'has no widgets'],
  ])('rejects %s', (_, html, message) => {
    expect(error(html)).toContain(message);
  });

  it('rejects unsafe SQL in the queries list', () => {
    const r = run('<kpi-tile title="R" query="q_rev" metric="revenue"/>', [{ id: 'q_rev', sql: 'DROP TABLE orders' }]);
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate query ids', () => {
    const r = run('<kpi-tile title="R" query="q_rev" metric="revenue"/>', [queries[0], queries[0]]);
    expect(r.ok ? '' : r.error).toContain('used twice');
  });

  it('rejects the old widgets-only JSON shape', () => {
    const r = parseLayout({ title: 'T', widgets: [] });
    expect(r.ok).toBe(false);
  });
});
