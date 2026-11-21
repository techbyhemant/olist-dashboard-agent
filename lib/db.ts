import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import path from 'node:path';

/**
 * Clean table name -> the Olist CSV it is built from. `npm run build:data` turns
 * each CSV into data/parquet/<name>.parquet (committed, ~zstd), which is what the
 * app queries. geolocation is left out: 1M rows of zip-code points and no map widget.
 */
export const TABLES = {
  orders: 'olist_orders_dataset.csv',
  order_items: 'olist_order_items_dataset.csv',
  products: 'olist_products_dataset.csv',
  customers: 'olist_customers_dataset.csv',
  sellers: 'olist_sellers_dataset.csv',
  payments: 'olist_order_payments_dataset.csv',
  reviews: 'olist_order_reviews_dataset.csv',
  category_translation: 'product_category_name_translation.csv',
} as const;

export type TableName = keyof typeof TABLES;

export const PARQUET_DIR = path.join(process.cwd(), 'data', 'parquet');

/** Absolute path to a table's Parquet file. */
export function parquetPath(table: TableName): string {
  return path.join(PARQUET_DIR, `${table}.parquet`);
}

/** Exposes each Parquet file as a view under its clean name, e.g. `SELECT * FROM orders`. */
function buildViewPrelude(): string {
  return (Object.keys(TABLES) as TableName[])
    .map(
      (name) =>
        `CREATE OR REPLACE VIEW ${name} AS ` +
        `SELECT * FROM read_parquet('${parquetPath(name).replace(/'/g, "''")}');`,
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
 * Run a read-only SQL query against the Parquet views and return plain
 * row objects. Table names are the keys of TABLES.
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
