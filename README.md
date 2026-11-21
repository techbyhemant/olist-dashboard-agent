# Olist Dashboard Agent

Ask a plain-English question about the Olist Brazilian e-commerce dataset and get
back a **validated, real dashboard**. The model writes the dashboard as HTML in a
small closed set of tags, plus the DuckDB SQL behind each widget. Every tag,
attribute and query is checked before anything renders, and a retry loop hands
the exact error back to the model once before giving up.

**Live demo: https://olist-dashboard-agent.vercel.app** Pick an example question,
watch the validator log, then open "Show the model's HTML" to see exactly what the
model wrote on each attempt, including any draft the validator rejected and why.
The public demo replays real recorded model runs for the example questions, so it
costs nothing to visit; the parsing, tag checks and SQL still run live on every click.

## 1. The problem

Operators ask questions like *"which categories drive the most revenue?"* or
*"where are deliveries slowest?"*. The data to answer them is real but messy:
Portuguese category names, multiple rows per order (items and payments), nullable
delivery timestamps, sparse months at the dataset edges. Letting an LLM free-write
HTML or SQL against that is unreliable: it can hallucinate columns, double-count
revenue, or emit markup and scripts you can't check.

The goal here is **trustworthy** dashboards. The model decides what to show and
how to arrange it, and every piece it produces is validated before anything renders.

## 2. Architecture: HTML is verifiable when its vocabulary is closed

Models are good at writing HTML. Open HTML is impossible to verify, because any
tag, attribute or script could appear. So the model gets HTML with a closed
vocabulary: three layout and text tags, five widget tags, and a fixed attribute
list for each. It answers with one JSON object:

```json
{
  "title": "Revenue overview",
  "queries": [
    { "id": "q_revenue", "sql": "SELECT ROUND(SUM(price), 2) AS revenue FROM order_items" },
    { "id": "q_top", "sql": "SELECT ... AS category, ... AS revenue ... LIMIT 8" }
  ],
  "html": "<p>Delivered orders only.</p>
           <grid-row>
             <kpi-tile title=\"Revenue\" query=\"q_revenue\" metric=\"revenue\"></kpi-tile>
             ...
           </grid-row>
           <bar-chart title=\"Top categories\" query=\"q_top\" x=\"category\" series=\"revenue\"></bar-chart>"
}
```

| Tags | Attributes | May contain |
|---|---|---|
| `section`, `grid-row` | none | layout, text, widgets |
| `h2`, `h3`, `p` | none | plain text only |
| `kpi-tile` | title, query, metric, delta-query, delta-label | nothing |
| `kpi-group` | title | `kpi-tile` only |
| `bar-chart`, `line-chart` | title, query, x, series | nothing |
| `data-table` | title, query, columns | nothing |

What that buys:

- **The layout is checked, not trusted.** `lib/layout.ts` tokenizes the html and
  rejects any tag or attribute outside the table above (`<script>`, `<div>`,
  `onclick`, `style`, `href`), unclosed or mismatched tags, bad nesting, loose
  text, and query ids that don't exist. Each rejection is a sentence the model
  can act on, such as `<div> is not allowed; allowed tags: section, grid-row, …`.
- **The html is never injected.** It is reduced to a tree of text nodes,
  containers and widget references. React renders that tree with our own
  components (`DashboardRenderer`), so there is no `innerHTML` and no iframe.
- **SQL stays out of the markup.** Widgets point at queries by id, so the html
  never carries SQL. The widgets are converted into a typed spec and checked
  against the Zod contract in `lib/spec.ts`.
- **Every query is run before rendering.** Each widget's SQL runs via DuckDB
  (`lib/db.ts`, reading the CSVs in place with `read_csv_auto`), and `lib/run.ts`
  confirms it returns rows whose columns match the widget's `metric`, `x`,
  `series` or `columns`. A widget that names a column its SQL doesn't produce is
  caught here, not in the browser.
- **Generated SQL is sandboxed.** Model SQL is untrusted input. `lib/sql-safety.ts`
  allows a single read-only SELECT or CTE and blocks file-access functions. It runs
  as a Zod refinement (so a violation becomes an error the retry loop can fix) and
  again right before execution.

### The validate → retry loop (`lib/generateDashboard.ts`)

```
question
   │
   ▼
generate ──► parse JSON ──► check html + spec ──► run each widget's SQL
   ▲              │                │                     │
   │          fail │            fail │                fail │  (error / empty / wrong shape)
   │              ▼                ▼                     ▼
   └──────── feed the SPECIFIC error back to the model, retry ONCE
                                                        │
                                                     success ──► render
                        (still failing after 1 retry) ──► graceful failure message
```

Every step is recorded in a `log[]` that the UI shows as **"What the system
did"**, so the self-correction is visible. A typical run when the model first slips:

```
● Generating dashboard (mock)…
▲ Layout failed validation — html: <div> is not allowed; allowed tags: section, grid-row, h2, …
● Retrying with the error fed back to the model (attempt 2/2)…
● Layout valid: "Mock dashboard (corrected)" with 3 widget(s).
● All widget SQL executed and returned rows. ✓
```

### Stack & layout

- **Next.js 16 (App Router) + TypeScript strict**, Tailwind v4, Recharts v3.
- **`@duckdb/node-api`** queries the CSVs in `/data` in place (no import step).
  Marked in `serverExternalPackages` so its native addon isn't bundled.
- **LLM via the Anthropic Messages API (`@anthropic-ai/sdk`)** behind a provider
  boundary (`lib/llm.ts`), so the loop is provider-agnostic and testable. A
  `MOCK_LLM=1` stub runs the entire pipeline with no model call and no spend.

```
lib/db.ts                  CSV-backed DuckDB query()
lib/layout.ts              tag allow-list, html → widgets + layout tree
lib/spec.ts                Zod widget contract + validateSpec()
lib/sql-safety.ts          read-only-SELECT enforcement for model SQL
lib/run.ts                 execute each widget's SQL, validate shape
lib/prompt.ts              system prompt (schema summary + tag vocabulary) + retry prompt
lib/llm.ts                 Messages API generator + deterministic mock
lib/generateDashboard.ts   the generate→validate→run→retry loop
app/api/generate/route.ts  POST { question } → streamed log, then { ok, spec, layout, data, attempts }
components/widgets/*       Tile, TileGroup, Chart, Table
components/DashboardRenderer.tsx  renders the layout tree with the widgets
evals/                     schema + layout (L1), correctness (L2), judge (L3, gated)
scripts/explore.ts         data exploration → scripts/exploration.md
```

### Run it

```bash
npm run build:sample     # regenerate data/sample/ from the full CSVs (committed)
npm run explore          # regenerate scripts/exploration.md from the CSVs
npm run dev              # http://localhost:3051
npm test                 # vitest: schema + DuckDB loop evals (MOCK_LLM, no spend)
npm run record           # call the real model for the example questions → lib/recorded-runs.json
RECORD_VIA=cli npm run record  # same, through your Claude Code login instead of an API key
```

Auth: the route calls the Anthropic Messages API (`@anthropic-ai/sdk`). Set a
Console API key in `.env.local` (`ANTHROPIC_API_KEY=sk-ant-...`); see
`.env.local.example`. `MOCK_LLM=1` runs the whole pipeline with no model call / no spend.

Data: the full ~120MB Olist CSVs (gitignored) go in `data/` for local dev; a small
referentially-consistent sample lives in `data/sample/` (committed) so deployments
and CI have data. `lib/db.ts` uses the full set when present, else the sample;
`npm run build:sample` regenerates the sample.

Deploying (Vercel): runs as-is on the Node runtime — set `ANTHROPIC_API_KEY` and
deploy. Since a public demo calls the model per request, the route is rate-limited
(`RATE_LIMIT_PER_MIN` per IP + `DAILY_REQUEST_CAP` global, in `lib/rateLimit.ts`).
Those are best-effort in-memory; set a **monthly budget limit on the API key in the
Anthropic Console** as the hard spend ceiling. Or deploy with `RECORDED_RUNS=1`
for a zero-spend demo: the generator replays the model output saved by `npm run record`
for the example questions, and the route turns away any other question with a note
on how to run it yourself. Only the model's text is replayed; a recorded draft that
broke the rules is rejected again by the live validator. `MOCK_LLM=1` is the
deterministic stub the evals use.

## 3. Eval strategy

The loop is the thing worth testing, so the evals target it — not the rendering.
Three layers, cheapest-first, wired into CI (`.github/workflows/ci.yml`):

- **Layer 1 — contract validity** (`evals/schema.test.ts`, `evals/layout.test.ts`,
  deterministic, no model or DB). Good layouts pass. Scripts, event handlers, styles,
  links, unknown tags, unknown query ids, missing attributes, broken nesting and
  **unsafe SQL** (DELETE, multi-statement, file functions, non-SELECT) are rejected
  with the same sentence the retry loop feeds back.
- **Layer 2 — spec correctness** (`evals/correctness.test.ts`, deterministic, real
  DuckDB). Every widget's SQL must run and return rows whose columns match what the
  widget declares; plus an end-to-end check that the loop self-corrects (driven by
  the mock). Runs against the full CSVs locally or the committed sample in CI.
- **Layer 3 — LLM-as-judge** (`evals/judge.test.ts`, real model, **gated**). For each
  golden question the model generates a dashboard and a second model call scores how
  well it answers (1–5). Off by default — run with `RUN_LLM_EVALS=1 npm test` — so CI
  stays free and deterministic.

```bash
npm test                  # Layers 1 + 2 (Layer 3 skipped)
RUN_LLM_EVALS=1 npm test  # add Layer 3 (needs a credential; unset MOCK_LLM)
```

### Design note — generated SQL vs. a tool/semantic layer

A common alternative is to *not* let the model write SQL: expose a fixed set of
tools / a metrics layer and have it pick a tool + params. That's safer and more
reliable, and is the right call for a polished product. This repo deliberately
generates SQL behind a validation + retry guardrail because the harder, more
demonstrative problem is *making generated SQL reliable* — and the self-correction
loop only has something to correct when real SQL can fail. A constrained semantic
layer is the natural v2 (see Future Work).

## Future Work (explicitly out of v1 scope)

Deliberately **not** built — v1 is one-shot generate → validate → render, with one
retry:

- save / refresh / edit dashboards; preview-then-apply
- insights & recommendations (the layout has `p` notes, but nothing checks them
  against the data)
- column spans and explicit grid placement (`grid-row` only places items side by side)
- donut & combo charts; nested tables
- multi-step tool routing; streaming responses
- structured-output enforcement (unsupported on the current `claude-sonnet-4-6`
  default; we parse text and let the retry loop catch malformed JSON)
- a constrained tool / semantic-metrics layer as a safer alternative to generated
  SQL (see the design note above)
- richer eval coverage: retry-efficacy metrics (first-try vs after-retry success by
  failure class), contract fuzzing
