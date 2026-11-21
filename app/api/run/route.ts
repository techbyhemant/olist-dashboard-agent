import { acceptedSpec, generateDashboard } from '@/lib/generateDashboard';
import { replayMode } from '@/lib/llm';
import { runSpec, type Params } from '@/lib/run';
import { filterParams } from '@/lib/spec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// a real calendar day: Date.parse gives NaN for month 13, and 2017-02-30 rolls over to March
const isDay = (v: string) => {
  const t = DAY.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
};
const nextDay = (v: string) => new Date(Date.parse(`${v}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

/**
 * POST { question, params } -> { ok, data }
 * Re-runs the dashboard already validated for this question with new filter
 * values. The SQL comes from the server's copy of the spec; the browser only
 * sends values, which are checked against the filter declarations and bound
 * as DuckDB parameters.
 */
export async function POST(request: Request) {
  let body: { question?: unknown; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad('Body must be JSON.');
  }
  const { question, params } = body;
  if (typeof question !== 'string' || !question.trim()) return bad('Provide the dashboard\'s "question".');
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return bad('"params" must be an object.');

  let entry = acceptedSpec(question);
  // Mock and replay cost nothing to regenerate, so a cold instance rebuilds the spec.
  const free = replayMode() || process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true';
  if (!entry && free) {
    await generateDashboard(question.trim());
    entry = acceptedSpec(question);
  }
  if (!entry) return bad('This dashboard is no longer on the server. Generate it again.', 409);

  const input = params as Record<string, unknown>;
  const bound: Params = {};
  for (const f of entry.spec.filters ?? []) {
    if (f.type === 'select') {
      const v = input[f.name];
      if (v == null || v === '') bound[f.name] = null;
      else if (typeof v === 'string' && entry.options[f.name]?.includes(v)) bound[f.name] = v;
      else return bad(`"${v}" is not one of the choices for ${f.label}.`);
    } else {
      const [from, to] = filterParams(f);
      for (const p of [from, to]) {
        const v = input[p];
        if (v == null || v === '') bound[p] = null;
        else if (typeof v === 'string' && isDay(v)) bound[p] = v;
        else return bad(`${f.label}: dates must be YYYY-MM-DD.`);
      }
      if (bound[from] && bound[to] && bound[from]! > bound[to]!) return bad(`${f.label}: the start date is after the end date.`);
      // The viewer picks an inclusive end date; queries compare with < $to.
      if (bound[to]) bound[to] = nextDay(bound[to]!);
    }
  }
  const unknown = Object.keys(input).filter((k) => !(k in bound));
  if (unknown.length) return bad(`Unknown filter(s): ${unknown.join(', ')}.`);

  try {
    return Response.json({ ok: true, data: await runSpec(entry.spec, bound) });
  } catch (e) {
    return bad(`Query failed: ${(e as Error).message}`, 500);
  }
}
