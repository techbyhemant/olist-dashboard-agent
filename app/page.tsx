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
  info: 'bg-zinc-400',
  success: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
};

function StatusLog({ log, loading }: { log: LogEntry[]; loading: boolean }) {
  return (
    <ol className="space-y-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm">
      {log.map((e, i) => {
        const isActive = loading && i === log.length - 1;
        return (
          <li key={i} className="flex items-start gap-2">
            {isActive ? (
              <span className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            ) : (
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.status]}`} />
            )}
            <span className={`text-zinc-700 ${isActive ? 'font-medium' : ''}`}>{e.message}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The model's own output for each attempt, so a reader can check what the validator saw. */
function ModelOutput({ drafts }: { drafts: Draft[] }) {
  return (
    <details className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700">
        Show the model’s HTML ({drafts.length} attempt{drafts.length === 1 ? '' : 's'})
      </summary>
      <div className="space-y-4 border-t border-zinc-200 p-4">
        {drafts.map((d, i) => (
          <div key={i} className={`rounded-lg border p-3 ${d.error ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide ${d.error ? 'text-red-700' : 'text-emerald-700'}`}>
              Attempt {i + 1}: {d.error ? 'rejected' : 'accepted'}
            </p>
            {d.error && <p className="mt-1 text-sm text-red-700">{d.error}</p>}
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs leading-5 text-zinc-100">{d.html}</pre>
            {d.queries && d.queries.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-600">SQL ({d.queries.length} quer{d.queries.length === 1 ? 'y' : 'ies'})</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs leading-5 text-zinc-100">
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
      <div className="h-7 w-64 animate-pulse rounded bg-zinc-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-200" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-zinc-200" />
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
    <main className="min-h-screen w-full bg-zinc-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">Olist Dashboard Agent</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Ask a question in plain English. The model writes the dashboard as HTML from a
            closed set of tags; we check every tag, run its SQL, and retry once if anything fails.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Top product categories by revenue"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 shadow-sm outline-none focus:border-zinc-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQuestion(ex);
                void submit(ex);
              }}
              disabled={loading}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>

        <section className="mt-8 space-y-6">
          {log.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                What the system did
              </h2>
              <StatusLog log={log} loading={loading} />
            </div>
          )}

          {loading && !res && <Skeleton />}

          {res?.ok === false && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
