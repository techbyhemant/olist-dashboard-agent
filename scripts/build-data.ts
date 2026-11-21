/**
 * Convert the Olist CSVs into the Parquet files the app queries (data/parquet/,
 * committed so deployments and CI have the full dataset).
 *
 *   node scripts/build-data.ts <folder with the Kaggle CSVs>    (npm run build:data -- <folder>)
 *
 * Get the CSVs from https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce
 */
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, PARQUET_DIR, parquetPath, query, type TableName } from '../lib/db.ts';

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, TABLES.orders))) {
  throw new Error(`Pass the folder holding ${TABLES.orders} and the other Olist CSVs.`);
}
fs.mkdirSync(PARQUET_DIR, { recursive: true });

const esc = (p: string) => p.replace(/'/g, "''");
const c = await (await DuckDBInstance.create(':memory:')).connect();
for (const [name, csv] of Object.entries(TABLES)) {
  await c.run(
    `COPY (SELECT * FROM read_csv_auto('${esc(path.join(src, csv))}')) ` +
      `TO '${esc(parquetPath(name as TableName))}' (FORMAT parquet, COMPRESSION zstd);`,
  );
}

// Read back through the app's own views: every table has rows, and the joins hold.
let total = 0;
for (const name of Object.keys(TABLES) as TableName[]) {
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${name}`);
  const bytes = fs.statSync(parquetPath(name)).size;
  total += bytes;
  console.log(`${name.padEnd(22)} ${String(n).padStart(7)} rows  ${(bytes / 1e6).toFixed(1)} MB`);
}
const [{ revenue, orphans }] = await query(`
  SELECT ROUND(SUM(oi.price), 2) AS revenue,
         COUNT(*) FILTER (WHERE s.seller_id IS NULL OR p.product_id IS NULL) AS orphans
  FROM order_items oi JOIN orders o USING (order_id)
  LEFT JOIN sellers s USING (seller_id) LEFT JOIN products p USING (product_id)
  WHERE o.order_status = 'delivered'`);
console.log(`\ndelivered revenue R$ ${Number(revenue).toLocaleString()}, orphan item rows ${orphans}, total ${(total / 1e6).toFixed(1)} MB`);
if (!revenue || orphans) throw new Error('Joins are broken: no revenue or items without a seller/product.');
