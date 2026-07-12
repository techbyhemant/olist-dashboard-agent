import { describe, it, expect } from 'vitest';
import { validateSpec } from '@/lib/spec';
import { SAMPLE_SPEC } from '@/lib/sampleSpec';

/**
 * EVAL LAYER 1 — schema validity (deterministic, no model, no DB).
 * The contract is the first guardrail: well-formed specs pass, malformed and
 * unsafe ones are rejected with an actionable reason (which is what the retry
 * loop feeds back to the model).
 */
describe('Layer 1 — spec schema validity', () => {
  it('accepts a well-formed spec', () => {
    const r = validateSpec(SAMPLE_SPEC);
    expect(r.ok).toBe(true);
  });

  const base = (sql = 'SELECT 1 AS revenue') => ({
    title: 'T',
    widgets: [{ type: 'tile', title: 'Rev', metric: 'revenue', sql }],
  });

  const cases: { name: string; input: unknown; reason: RegExp }[] = [
    { name: 'missing metric', input: { title: 'T', widgets: [{ type: 'tile', title: 'x', sql: 'SELECT 1 AS a' }] }, reason: /metric/ },
    { name: 'bad chartType', input: { title: 'T', widgets: [{ type: 'chart', chartType: 'donut', title: 'x', sql: 'SELECT 1 AS a', x: 'a', series: ['a'] }] }, reason: /chartType/ },
    { name: 'unknown key (strict)', input: { title: 'T', widgets: [{ type: 'tile', title: 'x', metric: 'a', sql: 'SELECT 1 AS a', extra: 1 }] }, reason: /Unrecognized key|extra/ },
    { name: 'empty widgets', input: { title: 'T', widgets: [] }, reason: /at least one widget/ },
    { name: 'unknown widget type', input: { title: 'T', widgets: [{ type: 'pie', title: 'x' }] }, reason: /.+/ },
    // SQL safety — enforced via the contract refinement:
    { name: 'unsafe: DELETE', input: base('DELETE FROM orders'), reason: /unsafe sql/ },
    { name: 'unsafe: multi-statement', input: base('SELECT 1 AS revenue; DROP TABLE orders'), reason: /unsafe sql/ },
    { name: 'unsafe: file function', input: base("SELECT * FROM read_csv_auto('/etc/passwd') t(revenue)"), reason: /unsafe sql/ },
    { name: 'unsafe: not a select', input: base('PRAGMA database_list'), reason: /unsafe sql/ },
  ];

  for (const c of cases) {
    it(`rejects ${c.name}`, () => {
      const r = validateSpec(c.input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(c.reason);
    });
  }
});
