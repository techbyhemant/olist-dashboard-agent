import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Map of clean table names -> CSV file on disk.
 *
 * We deliberately query the CSVs *in place* with read_csv_auto rather than
 * importing them into a persistent database. geolocation and sellers are
 * intentionally omitted for now.
 */
export const TABLES = {
  orders: 'olist_orders_dataset.csv',
  order_items: 'olist_order_items_dataset.csv',
  products: 'olist_products_dataset.csv',
  customers: 'olist_customers_dataset.csv',
  payments: 'olist_order_payments_dataset.csv',
  reviews: 'olist_order_reviews_dataset.csv',
  category_translation: 'product_category_name_translation.csv',
} as const;

export type TableName = keyof typeof TABLES;

/**
 * The full ~120MB dataset lives in `data/` (gitignored — for local dev). A small
 * referentially-consistent sample lives in `data/sample/` (committed) so a
 * deployment has data. Prefer the full set when present, else the sample.
 * Regenerate the sample from the full CSVs with `npm run build:sample`.
 */
const FULL_DIR = path.join(process.cwd(), 'data');
const SAMPLE_DIR = path.join(FULL_DIR, 'sample');
const DATA_DIR = fs.existsSync(path.join(FULL_DIR, TABLES.orders)) ? FULL_DIR : SAMPLE_DIR;

/** Absolute path to a table's CSV. */
export function csvPath(table: TableName): string {
  return path.join(DATA_DIR, TABLES[table]);
}

/**
 * A SQL prelude that exposes each CSV as a queryable view under its clean name,
 * e.g. `SELECT * FROM orders`. Re-created per connection; views are cheap and
 * read_csv_auto handles type inference + header detection.
 */
function buildViewPrelude(): string {
  return (Object.keys(TABLES) as TableName[])
    .map(
      (name) =>
        `CREATE OR REPLACE VIEW ${name} AS ` +
        `SELECT * FROM read_csv_auto('${csvPath(name).replace(/'/g, "''")}');`,
    )
    .join('\n');
}

let connectionPromise: Promise<DuckDBConnection> | null = null;

async function getConnection(): Promise<DuckDBConnection> {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const instance = await DuckDBInstance.create(':memory:');
      const connection = await instance.connect();
      await connection.run(buildViewPrelude());
      return connection;
    })();
  }
  return connectionPromise;
}

/**
 * DuckDB returns BIGINT/HUGEINT as JS BigInt, which breaks JSON.stringify and
 * charting libs. Olist magnitudes (~100k rows, R$ millions) fit safely in a JS
 * number, so we coerce BigInt -> Number. Other JS values pass through unchanged.
 */
function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/**
 * Run a read-only SQL query against the in-place CSV views and return plain
 * row objects. Table names available: orders, order_items, products, customers,
 * payments, reviews, category_translation.
 */
export async function query(sql: string): Promise<Record<string, unknown>[]> {
  const connection = await getConnection();
  const reader = await connection.runAndReadAll(sql);
  const rows = reader.getRowObjectsJS();
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) out[key] = normalize(row[key]);
    return out;
  });
}
