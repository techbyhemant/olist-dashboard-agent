import { query } from './db';
import { assertSafeSelect } from './sql-safety';
import type { DashboardSpec, Tile, Widget } from './spec';

/**
 * Executes the SQL each widget owns and shapes the results into serializable
 * data the client components render. Runs server-side only (DuckDB native).
 *
 * Shared by the checkpoint page and (later) the /api/generate retry loop.
 */

export type TileData = {
  value: unknown;
  delta: { value: unknown; label: string } | null;
};

export type WidgetData =
  | { kind: 'tile'; tile: TileData }
  | { kind: 'tileGroup'; tiles: TileData[] }
  | { kind: 'rows'; rows: Record<string, unknown>[] };

/** Thrown when a widget's SQL errors or returns nothing usable. */
export class WidgetRunError extends Error {}

async function runScalar(sql: string): Promise<unknown> {
  assertSafeSelect(sql);
  const rows = await query(sql);
  if (rows.length === 0) throw new WidgetRunError(`query returned 0 rows: ${sql}`);
  return rows[0];
}

async function runTile(t: Tile): Promise<TileData> {
  const first = (await runScalar(t.sql)) as Record<string, unknown>;
  if (!(t.metric in first)) {
    throw new WidgetRunError(
      `tile "${t.title}": result has no column "${t.metric}" (got: ${Object.keys(first).join(', ')})`,
    );
  }
  let delta: TileData['delta'] = null;
  if (t.delta) {
    const drow = (await runScalar(t.delta.sql)) as Record<string, unknown>;
    delta = { value: Object.values(drow)[0] ?? null, label: t.delta.label };
  }
  return { value: first[t.metric], delta };
}

async function runRows(
  sql: string,
  needed: string[],
  label: string,
): Promise<Record<string, unknown>[]> {
  assertSafeSelect(sql, label);
  const rows = await query(sql);
  if (rows.length === 0) throw new WidgetRunError(`${label}: query returned 0 rows`);
  const have = new Set(Object.keys(rows[0]));
  const missing = needed.filter((c) => !have.has(c));
  if (missing.length) {
    throw new WidgetRunError(
      `${label}: result missing column(s) ${missing.join(', ')} (got: ${[...have].join(', ')})`,
    );
  }
  return rows;
}

export async function runWidget(w: Widget): Promise<WidgetData> {
  switch (w.type) {
    case 'tile':
      return { kind: 'tile', tile: await runTile(w) };
    case 'tileGroup':
      return { kind: 'tileGroup', tiles: await Promise.all(w.tiles.map(runTile)) };
    case 'chart':
      return { kind: 'rows', rows: await runRows(w.sql, [w.x, ...w.series], `chart "${w.title}"`) };
    case 'table':
      return { kind: 'rows', rows: await runRows(w.sql, w.columns, `table "${w.title}"`) };
  }
}

export async function runSpec(spec: DashboardSpec): Promise<WidgetData[]> {
  return Promise.all(spec.widgets.map(runWidget));
}
