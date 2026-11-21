import { query } from './db';
import { assertSafeSelect } from './sql-safety';
import type { DashboardSpec, Tile, Widget } from './spec';

/** Filter values by parameter name; null (or missing) means "All". */
export type Params = Record<string, string | null>;
const filtered = (params: Params) => Object.values(params).some((v) => v != null);

/**
 * Executes the SQL each widget owns and shapes the results into serializable
 * data the client components render. Runs server-side only (DuckDB native).
 *
 * Shared by the checkpoint page and (later) the /api/generate retry loop.
 */

export type TileData = {
  value: unknown; // null when the filters leave nothing to count
  delta: { value: unknown; label: string } | null;
};

export type WidgetData =
  | { kind: 'tile'; tile: TileData }
  | { kind: 'tileGroup'; tiles: TileData[] }
  | { kind: 'rows'; rows: Record<string, unknown>[] };

/** Thrown when a widget's SQL errors or returns nothing usable. */
export class WidgetRunError extends Error {}

async function runScalar(sql: string, params: Params): Promise<unknown> {
  assertSafeSelect(sql);
  const rows = await query(sql, params);
  if (rows.length === 0) {
    if (filtered(params)) return null;
    throw new WidgetRunError(`query returned 0 rows: ${sql}`);
  }
  return rows[0];
}

async function runTile(t: Tile, params: Params): Promise<TileData> {
  const first = (await runScalar(t.sql, params)) as Record<string, unknown> | null;
  if (!first) return { value: null, delta: null };
  if (!(t.metric in first)) {
    throw new WidgetRunError(
      `tile "${t.title}": result has no column "${t.metric}" (got: ${Object.keys(first).join(', ')})`,
    );
  }
  let delta: TileData['delta'] = null;
  if (t.delta) {
    const drow = (await runScalar(t.delta.sql, params)) as Record<string, unknown> | null;
    delta = drow ? { value: Object.values(drow)[0] ?? null, label: t.delta.label } : null;
  }
  return { value: first[t.metric], delta };
}

async function runRows(
  sql: string,
  needed: string[],
  label: string,
  params: Params,
): Promise<Record<string, unknown>[]> {
  assertSafeSelect(sql, label);
  const rows = await query(sql, params);
  // Unfiltered, an empty result means the SQL is wrong; filtered, it can be a real answer.
  if (rows.length === 0) {
    if (filtered(params)) return rows;
    throw new WidgetRunError(`${label}: query returned 0 rows`);
  }
  const have = new Set(Object.keys(rows[0]));
  const missing = needed.filter((c) => !have.has(c));
  if (missing.length) {
    throw new WidgetRunError(
      `${label}: result missing column(s) ${missing.join(', ')} (got: ${[...have].join(', ')})`,
    );
  }
  return rows;
}

export async function runWidget(w: Widget, params: Params = {}): Promise<WidgetData> {
  switch (w.type) {
    case 'tile':
      return { kind: 'tile', tile: await runTile(w, params) };
    case 'tileGroup':
      return { kind: 'tileGroup', tiles: await Promise.all(w.tiles.map((t) => runTile(t, params))) };
    case 'chart':
      return { kind: 'rows', rows: await runRows(w.sql, [w.x, ...w.series], `chart "${w.title}"`, params) };
    case 'table':
      return { kind: 'rows', rows: await runRows(w.sql, w.columns, `table "${w.title}"`, params) };
  }
}

export async function runSpec(spec: DashboardSpec, params: Params = {}): Promise<WidgetData[]> {
  return Promise.all(spec.widgets.map((w) => runWidget(w, params)));
}

/** The choices for each select filter, from its options query's `value` column. */
export async function runOptions(spec: DashboardSpec): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const f of spec.filters ?? []) {
    if (f.type !== 'select') continue;
    const label = `filter "${f.name}"`;
    assertSafeSelect(f.sql, label);
    const rows = await query(f.sql);
    if (rows.length === 0) throw new WidgetRunError(`${label}: options query returned 0 rows`);
    if (!('value' in rows[0])) {
      throw new WidgetRunError(`${label}: options query must return a column named value (got: ${Object.keys(rows[0]).join(', ')})`);
    }
    out[f.name] = rows.map((r) => r.value).filter((v) => v != null).map(String);
  }
  return out;
}
