import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateSpec } from '@/lib/spec';
import { runSpec } from '@/lib/run';
import { generateDashboard } from '@/lib/generateDashboard';
import { getGenerator } from '@/lib/llm';
import { SAMPLE_SPEC } from '@/lib/sampleSpec';

/**
 * EVAL LAYER 2 — spec correctness (deterministic, real DuckDB, no model).
 * A valid spec is necessary but not sufficient: every widget's SQL must run and
 * return rows whose columns match what the widget declares. Plus an end-to-end
 * check that the retry loop self-corrects, driven by the deterministic mock.
 */
// Runs against the full CSVs locally, or the committed sample (data/sample/) in
// CI — matching lib/db.ts's fallback. Skips only if neither is present.
const DATA_READY =
  fs.existsSync(path.join(process.cwd(), 'data', 'olist_orders_dataset.csv')) ||
  fs.existsSync(path.join(process.cwd(), 'data', 'sample', 'olist_orders_dataset.csv'));

describe.skipIf(!DATA_READY)('Layer 2 — spec correctness against real data', () => {
  it('every SAMPLE_SPEC widget runs and returns correctly-shaped data', async () => {
    const v = validateSpec(SAMPLE_SPEC);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    const data = await runSpec(v.spec);
    expect(data.length).toBe(v.spec.widgets.length);

    v.spec.widgets.forEach((w, i) => {
      const d = data[i];
      if (w.type === 'tile') {
        expect(d.kind).toBe('tile');
        if (d.kind === 'tile') expect(d.tile.value).not.toBeNull();
      } else if (w.type === 'tileGroup') {
        expect(d.kind).toBe('tileGroup');
        if (d.kind === 'tileGroup') expect(d.tiles.length).toBe(w.tiles.length);
      } else if (w.type === 'chart') {
        expect(d.kind).toBe('rows');
        if (d.kind === 'rows') {
          expect(d.rows.length).toBeGreaterThan(0);
          for (const col of [w.x, ...w.series]) expect(d.rows[0]).toHaveProperty(col);
        }
      } else if (w.type === 'table') {
        expect(d.kind).toBe('rows');
        if (d.kind === 'rows') {
          expect(d.rows.length).toBeGreaterThan(0);
          for (const col of w.columns) expect(d.rows[0]).toHaveProperty(col);
        }
      }
    });
  });

  it('the generate→validate→run→retry loop self-corrects (mock)', async () => {
    process.env.MOCK_LLM = '1';
    const result = await generateDashboard('anything', getGenerator());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // mock fails attempt 1 (SQL shape), succeeds on the retry
    expect(result.attempts).toBe(2);
    expect(result.log.some((e) => e.status === 'warn')).toBe(true);
    expect(result.log.at(-1)?.status).toBe('success');
    expect(result.data.length).toBe(result.spec.widgets.length);
  });
});
