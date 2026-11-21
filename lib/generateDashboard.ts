import type { DashboardSpec } from './spec';
import { parseLayout, type LayoutNode } from './layout';
import { runOptions, runSpec, WidgetRunError, type WidgetData } from './run';
import { getGenerator, type SpecGenerator } from './llm';

/**
 * THE CORE FEATURE: one-shot generate -> validate the html layout + spec -> run SQL -> (on any failure)
 * feed the specific error back to the model ONCE -> re-validate. After one retry,
 * fail gracefully.
 *
 * `streamDashboard` is the source of truth — an async generator that YIELDS each
 * log step the moment it happens, then a final result event. The route streams
 * these to the browser so the self-correction is watchable live. `generateDashboard`
 * is a thin wrapper that drains the stream and returns the final result (used by
 * the evals and any non-streaming caller).
 */

export type LogStatus = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  status: LogStatus;
  message: string;
}

/** What the model wrote on one attempt, and why it was rejected (if it was). */
export interface Draft {
  html: string; // the html field, or the raw text when the reply wasn't usable JSON
  queries?: { id: string; sql: string }[];
  error?: string;
}

export type GenerateResult =
  | {
      ok: true;
      spec: DashboardSpec;
      layout: LayoutNode[];
      data: WidgetData[];
      options: Record<string, string[]>; // choices per select filter
      log: LogEntry[];
      attempts: number;
      drafts: Draft[];
    }
  | { ok: false; error: string; log: LogEntry[]; attempts: number; drafts: Draft[] };

export type StreamEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'result'; result: GenerateResult };

const MAX_ATTEMPTS = 2; // initial try + one retry

/**
 * The last validated spec per question, so /api/run can re-run it with filter
 * values without trusting a spec sent back by the browser. On globalThis because
 * Next may load this module once per route bundle.
 * ponytail: in-process only; a live-mode rerun that lands on another serverless
 * instance gets a 409 and the page asks for a regenerate. A KV store fixes that.
 */
type Accepted = { spec: DashboardSpec; options: Record<string, string[]> };
const g = globalThis as { __acceptedSpecs?: Map<string, Accepted> };
const accepted = (g.__acceptedSpecs ??= new Map());
const questionKey = (q: string) => q.trim().toLowerCase();
export const acceptedSpec = (question: string) => accepted.get(questionKey(question));

/** Strip an accidental ```json fence, then JSON.parse. */
function parseSpecJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function* streamDashboard(
  question: string,
  generator: SpecGenerator = getGenerator(),
): AsyncGenerator<StreamEvent, void, unknown> {
  const log: LogEntry[] = [];
  const drafts: Draft[] = [];
  let priorError: string | undefined;

  // Record a step and emit it immediately.
  function step(status: LogStatus, message: string): StreamEvent {
    const entry: LogEntry = { status, message };
    log.push(entry);
    return { type: 'log', entry };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const retrying = attempt > 1;
    yield step(
      'info',
      retrying
        ? `Retrying with the error fed back to the model (attempt ${attempt}/${MAX_ATTEMPTS})…`
        : `Generating dashboard (${generator.name})…`,
    );

    // 1. Generate
    let rawText: string;
    try {
      rawText = await generator.generate({ question, priorError });
    } catch (e) {
      priorError = `Model call failed: ${(e as Error).message}`;
      yield step('error', priorError);
      if (retrying) break;
      continue;
    }

    // 2. Parse JSON
    const parsed = parseSpecJson(rawText);
    const env = parsed.ok ? (parsed.value as { html?: unknown; queries?: unknown }) : undefined;
    const draft: Draft =
      typeof env?.html === 'string'
        ? { html: env.html, queries: Array.isArray(env.queries) ? (env.queries as Draft['queries']) : undefined }
        : { html: rawText };
    drafts.push(draft);
    if (!parsed.ok) {
      priorError = draft.error = `Response was not valid JSON: ${parsed.error}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }

    // 3. Validate the envelope, the html allow-list and the widget contract
    const validated = parseLayout(parsed.value);
    if (!validated.ok) {
      priorError = draft.error = `Layout failed validation — ${validated.error}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }
    yield step(
      'success',
      `Layout valid: "${validated.spec.title}" with ${validated.spec.widgets.length} widget(s).`,
    );

    // 4. Execute each widget's SQL (validates non-empty + correct-shaped rows)
    try {
      const [data, options] = await Promise.all([runSpec(validated.spec), runOptions(validated.spec)]);
      accepted.set(questionKey(question), { spec: validated.spec, options });
      yield step('success', 'All widget SQL executed and returned rows. ✓');
      yield {
        type: 'result',
        result: { ok: true, spec: validated.spec, layout: validated.layout, data, options, log, attempts: attempt, drafts },
      };
      return;
    } catch (e) {
      const detail = e instanceof WidgetRunError ? e.message : (e as Error).message;
      priorError = draft.error = `SQL execution failed — ${detail}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }
  }

  const finalError = priorError ?? 'Unknown failure';
  yield step('error', `Gave up after ${MAX_ATTEMPTS} attempts. Last error: ${finalError}`);
  yield { type: 'result', result: { ok: false, error: finalError, log, attempts: MAX_ATTEMPTS, drafts } };
}

/** Drain the stream and return the final result (non-streaming callers + evals). */
export async function generateDashboard(
  question: string,
  generator: SpecGenerator = getGenerator(),
): Promise<GenerateResult> {
  let result: GenerateResult | undefined;
  for await (const ev of streamDashboard(question, generator)) {
    if (ev.type === 'result') result = ev.result;
  }
  return result ?? { ok: false, error: 'No result produced', log: [], attempts: 0, drafts: [] };
}
