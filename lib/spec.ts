import { z } from 'zod';
import { checkSafeSelect } from './sql-safety';

/**
 * THE WIDGET CONTRACT.
 *
 * The model writes HTML in a closed vocabulary (lib/layout.ts); that HTML is
 * converted into this typed list of widgets and validated here with Zod before
 * any SQL runs. Each widget owns the SQL that fetches its own data. Column-name
 * fields (tile.metric, chart.x, chart.series, table.columns) refer to columns in
 * that widget's SQL result. Layout (rows, sections, text) lives in lib/layout.ts.
 */

export const SqlSchema = z
  .string()
  .min(1, 'sql must be a non-empty string')
  .superRefine((value, ctx) => {
    const check = checkSafeSelect(value);
    if (!check.ok) {
      ctx.addIssue({ code: 'custom', message: `unsafe sql — ${check.reason}` });
    }
  })
  .describe('A single read-only DuckDB SELECT statement.');

/** Optional delta: a second scalar query plus a human label e.g. "vs last month". */
const DeltaSchema = z
  .object({
    sql: SqlSchema,
    label: z.string().min(1),
  })
  .strict();

/** A single KPI tile. `metric` is the result column to display as the big number. */
export const TileSchema = z
  .object({
    title: z.string().min(1),
    metric: z.string().min(1),
    sql: SqlSchema,
    delta: DeltaSchema.optional(),
  })
  .strict();

const TileWidget = TileSchema.extend({ type: z.literal('tile') }).strict();

const TileGroupWidget = z
  .object({
    type: z.literal('tileGroup'),
    title: z.string().min(1),
    tiles: z.array(TileSchema).min(1, 'tileGroup needs at least one tile'),
  })
  .strict();

const ChartWidget = z
  .object({
    type: z.literal('chart'),
    chartType: z.enum(['bar', 'line']),
    title: z.string().min(1),
    sql: SqlSchema,
    x: z.string().min(1).describe('result column for the x-axis / category'),
    series: z
      .array(z.string().min(1))
      .min(1, 'chart needs at least one series column'),
  })
  .strict();

const TableWidget = z
  .object({
    type: z.literal('table'),
    title: z.string().min(1),
    sql: SqlSchema,
    columns: z.array(z.string().min(1)).min(1, 'table needs at least one column'),
  })
  .strict();

export const WidgetSchema = z.discriminatedUnion('type', [
  TileWidget,
  TileGroupWidget,
  ChartWidget,
  TableWidget,
]);

export const DashboardSpecSchema = z
  .object({
    title: z.string().min(1),
    widgets: z.array(WidgetSchema).min(1, 'a dashboard needs at least one widget'),
  })
  .strict();

// Inferred types — these ARE the contract used across the app.
export type Tile = z.infer<typeof TileSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

export type ValidateResult =
  | { ok: true; spec: DashboardSpec }
  | { ok: false; error: string };

/**
 * Validate raw (parsed-JSON) input against the contract.
 *
 * Returns a discriminated result rather than throwing, because the retry loop
 * needs the error STRING to feed back to the LLM. The message is flattened into
 * `path: message` lines the model can act on directly.
 */
export function validateSpec(raw: unknown): ValidateResult {
  const result = DashboardSpecSchema.safeParse(raw);
  if (result.success) return { ok: true, spec: result.data };
  return { ok: false, error: formatIssues(result.error) };
}

/** Flatten Zod issues into `path: message` pairs the model can act on. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}
