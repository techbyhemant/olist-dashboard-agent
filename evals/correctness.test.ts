import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parquetPath } from '@/lib/db';
import { validateSpec } from '@/lib/spec';
import { runSpec } from '@/lib/run';
import { generateDashboard } from '@/lib/generateDashboard';
import { getGenerator, hasRecording } from '@/lib/llm';
import { EXAMPLES } from '@/lib/examples';
import { SAMPLE_SPEC } from '@/lib/sampleSpec';

/**
 * EVAL LAYER 2 — spec correctness (deterministic, real DuckDB, no model).
 * A valid spec is necessary but not sufficient: every widget's SQL must run and
 * return rows whose columns match what the widget declares. Plus an end-to-end
 * check that the retry loop self-corrects, driven by the deterministic mock.
 */
// Runs against the committed Parquet files (data/parquet/); skips only if they are missing.
const DATA_READY = fs.existsSync(parquetPath('orders'));

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

    // mock fails attempt 1 (html allow-list), succeeds on the retry
    expect(result.attempts).toBe(2);
    expect(result.log.some((e) => e.status === 'warn' && e.message.includes('<div> is not allowed'))).toBe(true);
    expect(result.log.at(-1)?.status).toBe('success');
    expect(result.data.length).toBe(result.spec.widgets.length);
    expect(result.layout.some((n) => n.kind === 'row')).toBe(true);

    // each attempt's html is kept, the rejected one with its reason
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].html).toContain('<div class="grid">');
    expect(result.drafts[0].error).toContain('<div> is not allowed');
    expect(result.drafts[1].error).toBeUndefined();
    expect(result.drafts[1].queries?.map((q) => q.id)).toEqual(['q_revenue', 'q_orders', 'q_top']);
  });
  // The live demo replays these recordings; each must still end in a valid dashboard on the current data.
  it.each(EXAMPLES.filter((q) => hasRecording(q)))('recorded run still renders: %s', async (q) => {
    process.env.MOCK_LLM = '';
    process.env.RECORDED_RUNS = '1';
    const result = await generateDashboard(q, getGenerator());
    expect(result.ok ? 'ok' : result.error).toBe('ok');
  });
});
