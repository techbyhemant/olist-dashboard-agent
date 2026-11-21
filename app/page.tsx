'use client';

import { useState } from 'react';
import type { DashboardSpec } from '@/lib/spec';
import type { WidgetData } from '@/lib/run';
import type { LayoutNode } from '@/lib/layout';
import type { Draft, LogEntry, StreamEvent } from '@/lib/generateDashboard';
import { DashboardRenderer } from '@/components/DashboardRenderer';
import { EXAMPLES } from '@/lib/examples';

type FinalResult =
  | { ok: true; spec: DashboardSpec; layout: LayoutNode[]; data: WidgetData[]; log: LogEntry[]; attempts: number; drafts: Draft[] }
  | { ok: false; error: string; log?: LogEntry[]; attempts?: number; drafts?: Draft[] };

const DOT: Record<LogEntry['status'], string> = {
  info: 'bg-line',
  success: 'bg-brand',
  warn: 'bg-gold',
  error: 'bg-[#b5523b]',
};

const STAGES = ['Model writes HTML', 'Tags checked', 'SQL runs', 'Dashboard ready'];
type StageState = 'idle' | 'active' | 'done' | 'failed';

/**
 * Where the run is, read from the streamed log. Each attempt opens with an info
 * line, then: warn = draft rejected at the tag check, success = tags passed,
 * then success/warn for the SQL. An error right after the opener = model call failed.
 */
function pipelineState(log: LogEntry[], loading: boolean): { states: StageState[]; attempt: number } {
  const states: StageState[] = ['idle', 'idle', 'idle', 'idle'];
  const starts = log.flatMap((e, i) => (e.status === 'info' ? [i] : []));
  if (!starts.length) return { states, attempt: 0 };
  const seg = log.slice(starts[starts.length - 1]);
  const [, check, sql] = seg;
  if (!check) states[0] = loading ? 'active' : 'idle';
  else if (check.status === 'error') states[0] = 'failed';
  else {
    states[0] = 'done';
    if (check.status === 'warn') states[1] = 'failed';
    else {
      states[1] = 'done';
      if (!sql) states[2] = 'active';
      else if (sql.status === 'success') states[2] = states[3] = 'done';
      else states[2] = 'failed';
    }
  }
  return { states, attempt: starts.length };
}

function Pipeline({ log, loading }: { log: LogEntry[]; loading: boolean }) {
  const { states, attempt } = pipelineState(log, loading);
  return (
    <div>
      <ol className="grid grid-cols-4">
        {STAGES.map((label, i) => {
          const st = states[i];
          const lineOn = i > 0 && states[i - 1] === 'done';
          return (
            <li key={label} className="relative flex flex-col items-center text-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute top-4 h-0.5 transition-colors duration-500 motion-reduce:transition-none ${lineOn ? 'bg-brand' : 'bg-line'}`}
                  style={{ width: 'calc(100% - 2rem)', right: 'calc(50% + 1rem)' }}
                />
              )}
              <span
                className={`relative grid h-8 w-8 place-items-center rounded-full border-2 text-sm font-semibold transition-colors duration-500 motion-reduce:transition-none ${
                  st === 'done'
                    ? 'border-brand bg-brand text-white'
                    : st === 'active'
                      ? 'border-brand bg-white text-brand'
                      : st === 'failed'
                        ? 'border-gold bg-gold text-white'
                        : 'border-line bg-white text-muted'
                }`}
              >
                {st === 'active' && (
                  <span aria-hidden className="absolute inset-0 animate-ping rounded-full border-2 border-brand opacity-40 motion-reduce:hidden" />
                )}
                {st === 'done' ? '✓' : st === 'failed' ? '✕' : i + 1}
              </span>
              <span className={`mt-2 px-1 text-xs leading-4 sm:text-sm ${st === 'idle' ? 'text-muted' : 'font-medium text-ink'}`}>
                {label}
              </span>
              <span className="sr-only">{st}</span>
            </li>
          );
        })}
      </ol>
      {attempt > 1 && (
        <p className="mt-4 rounded-lg bg-gold/10 px-3 py-2 text-sm text-ink">
          Attempt {attempt} of 2. The first draft broke a rule, so the exact error went back to the model.
        </p>
      )}
    </div>
  );
}

function StatusLog({ log, loading }: { log: LogEntry[]; loading: boolean }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {log.map((e, i) => {
        const isActive = loading && i === log.length - 1;
        return (
          <li key={i} className="flex items-start gap-2.5">
            {isActive ? (
              <span className="mt-1 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand motion-reduce:animate-none" />
            ) : (
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.status]}`} />
            )}
            <span className={`break-words text-muted ${isActive ? 'font-medium text-ink' : ''}`}>{e.message}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The model's own output for each attempt, so a reader can check what the validator saw. */
function ModelOutput({ drafts }: { drafts: Draft[] }) {
  return (
    <details className="group rounded-2xl border border-line bg-white">
      <summary className="cursor-pointer select-none rounded-2xl px-5 py-4 text-sm font-medium text-ink hover:bg-canvas/60">
        Show the model’s HTML ({drafts.length} attempt{drafts.length === 1 ? '' : 's'})
      </summary>
      <div className="space-y-4 border-t border-line p-5">
        {drafts.map((d, i) => (
          <div key={i} className={`rounded-xl border p-4 ${d.error ? 'border-gold/40 bg-gold/5' : 'border-brand/30 bg-brand-soft/50'}`}>
            <p className={`text-sm font-semibold ${d.error ? 'text-[#8a5a00]' : 'text-brand'}`}>
              Attempt {i + 1}: {d.error ? 'rejected' : 'accepted'}
            </p>
            {d.error && <p className="mt-1 text-sm text-ink">{d.error}</p>}
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-ink p-3 font-mono text-xs leading-5 text-[#e6ece9]">{d.html}</pre>
            {d.queries && d.queries.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted hover:text-ink">SQL ({d.queries.length} quer{d.queries.length === 1 ? 'y' : 'ies'})</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-ink p-3 font-mono text-xs leading-5 text-[#e6ece9]">
                  {d.queries.map((q) => `-- ${q.id}\n${q.sql.trim()}`).join('\n\n')}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-8 w-72 animate-pulse rounded-lg bg-line/70" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-line/70" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-line/70" />
    </div>
  );
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [res, setRes] = useState<FinalResult | null>(null);

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setLog([]);
    setRes(null);

    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });

      // Bad-request path returns plain JSON, not a stream.
      const ct = r.headers.get('content-type') ?? '';
      if (!r.body || ct.includes('application/json')) {
        setRes((await r.json()) as FinalResult);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      const acc: LogEntry[] = [];
      let buf = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          if (ev.type === 'log') {
            acc.push(ev.entry);
            setLog([...acc]);
          } else if (ev.type === 'result') {
            setRes(ev.result);
          }
        }
      }
    } catch (e) {
      setRes({ ok: false, error: `Request failed: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Olist Dashboard Agent</h1>
          <p className="mt-3 text-base leading-7 text-muted">
            Ask a question about a Brazilian online marketplace in plain English. The model writes the
            dashboard as HTML from a closed set of tags, every tag is checked, its SQL runs against
            the data, and a broken draft goes back to the model once with the exact error.
          </p>
          <p className="mt-3 text-sm text-muted">
            Data: a 4,000-order sample of the public Olist dataset.{' '}
            <a
              href="https://github.com/techbyhemant/olist-dashboard-agent"
              className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
            >
              Source on GitHub
            </a>
          </p>
        </header>

        <div className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(question);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <label htmlFor="q" className="sr-only">Your question</label>
            <input
              id="q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Top product categories by revenue"
              className="min-w-0 flex-1 rounded-xl border border-line bg-canvas/50 px-4 py-3 text-ink outline-none placeholder:text-muted/70 focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-[#0b6a4d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
            >
              {loading ? 'Building…' : 'Build dashboard'}
            </button>
          </form>

          <p className="mt-5 mb-2 text-sm text-muted">Or pick one of these:</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setQuestion(ex);
                  void submit(ex);
                }}
                disabled={loading}
                className={`rounded-xl border px-4 py-3 text-left text-sm leading-5 transition-colors hover:border-brand hover:bg-brand-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${
                  question === ex ? 'border-brand bg-brand-soft/50 text-ink' : 'border-line text-ink'
                }`}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-line bg-white p-4 sm:p-6" aria-label="What the system did">
          <Pipeline log={log} loading={loading} />
          {log.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <StatusLog log={log} loading={loading} />
            </div>
          )}
        </section>

        <section className="mt-8 space-y-6">
          {loading && !res && <Skeleton />}

          {res?.ok === false && (
            <p className="rounded-2xl border border-gold/40 bg-gold/10 p-4 text-sm text-ink">
              Couldn’t build a valid dashboard: {res.error}
            </p>
          )}

          {res?.ok === true && <DashboardRenderer spec={res.spec} data={res.data} layout={res.layout} />}

          {res?.drafts && res.drafts.length > 0 && <ModelOutput drafts={res.drafts} />}
        </section>
      </div>
    </main>
  );
}
