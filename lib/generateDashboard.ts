import { validateSpec, type DashboardSpec } from './spec';
import { runSpec, WidgetRunError, type WidgetData } from './run';
import { getGenerator, type SpecGenerator } from './llm';

/**
 * THE CORE FEATURE: one-shot generate -> validate -> run SQL -> (on any failure)
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

export type GenerateResult =
  | { ok: true; spec: DashboardSpec; data: WidgetData[]; log: LogEntry[]; attempts: number }
  | { ok: false; error: string; log: LogEntry[]; attempts: number };

export type StreamEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'result'; result: GenerateResult };

const MAX_ATTEMPTS = 2; // initial try + one retry

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
        : `Generating dashboard spec (${generator.name})…`,
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
    if (!parsed.ok) {
      priorError = `Response was not valid JSON: ${parsed.error}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }

    // 3. Validate against the Zod contract
    const validated = validateSpec(parsed.value);
    if (!validated.ok) {
      priorError = `Spec failed schema validation — ${validated.error}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }
    yield step(
      'success',
      `Spec valid: "${validated.spec.title}" with ${validated.spec.widgets.length} widget(s).`,
    );

    // 4. Execute each widget's SQL (validates non-empty + correct-shaped rows)
    try {
      const data = await runSpec(validated.spec);
      yield step('success', 'All widget SQL executed and returned rows. ✓');
      yield { type: 'result', result: { ok: true, spec: validated.spec, data, log, attempts: attempt } };
      return;
    } catch (e) {
      const detail = e instanceof WidgetRunError ? e.message : (e as Error).message;
      priorError = `SQL execution failed — ${detail}`;
      yield step('warn', priorError);
      if (retrying) break;
      continue;
    }
  }

  const finalError = priorError ?? 'Unknown failure';
  yield step('error', `Gave up after ${MAX_ATTEMPTS} attempts. Last error: ${finalError}`);
  yield { type: 'result', result: { ok: false, error: finalError, log, attempts: MAX_ATTEMPTS } };
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
  return result ?? { ok: false, error: 'No result produced', log: [], attempts: 0 };
}
