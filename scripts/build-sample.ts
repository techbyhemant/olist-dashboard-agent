/**
 * Build a small, referentially-consistent sample of the Olist dataset from the
 * full CSVs in data/, writing it to data/sample/ (committed to git so a
 * deployment has data). Run with native Node TypeScript stripping (Node >= 23):
 *
 *   npm run build:sample      # (node scripts/build-sample.ts)
 *
 * Strategy: take a deterministic reservoir sample of orders, then filter every
 * dependent table to rows that reference the sampled orders (and products to
 * those referenced by the sampled order_items). This keeps every join in the
 * app producing coherent results instead of dangling foreign keys.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FULL = path.join(ROOT, 'data');
const SAMPLE = path.join(ROOT, 'data', 'sample');

const FILES = {
  orders: 'olist_orders_dataset.csv',
  order_items: 'olist_order_items_dataset.csv',
  products: 'olist_products_dataset.csv',
  customers: 'olist_customers_dataset.csv',
  payments: 'olist_order_payments_dataset.csv',
  reviews: 'olist_order_reviews_dataset.csv',
  category_translation: 'product_category_name_translation.csv',
} as const;
type Name = keyof typeof FILES;

const ORDER_SAMPLE = 4000; // orders to keep; dependents derive from these
const SEED = 42; // deterministic reservoir sample

const esc = (p: string) => p.replace(/'/g, "''");

async function viewsOverDir(dir: string) {
  const db = await DuckDBInstance.create(':memory:');
  const c = await db.connect();
  for (const [name, file] of Object.entries(FILES)) {
    await c.run(
      `CREATE OR REPLACE VIEW ${name} AS ` +
        `SELECT * FROM read_csv_auto('${esc(path.join(dir, file))}');`,
    );
  }
  return c;
}

async function main() {
  const ordersFull = path.join(FULL, FILES.orders);
  if (!fs.existsSync(ordersFull)) {
    throw new Error(
      `Full dataset not found at ${ordersFull}.\n` +
        `Download the Olist CSVs into data/ before building the sample (see README).`,
    );
  }
  fs.mkdirSync(SAMPLE, { recursive: true });

  const c = await viewsOverDir(FULL);

  // 1. Deterministic order sample.
  await c.run(
    `CREATE TEMP TABLE s_orders AS ` +
      `SELECT * FROM orders USING SAMPLE ${ORDER_SAMPLE} ROWS (reservoir, ${SEED});`,
  );
  // 2. Dependents filtered to the sampled orders (preserves referential integrity).
  await c.run(
    `CREATE TEMP TABLE s_order_items AS ` +
      `SELECT * FROM order_items WHERE order_id IN (SELECT order_id FROM s_orders);`,
  );
  await c.run(
    `CREATE TEMP TABLE s_payments AS ` +
      `SELECT * FROM payments WHERE order_id IN (SELECT order_id FROM s_orders);`,
  );
  await c.run(
    `CREATE TEMP TABLE s_reviews AS ` +
      `SELECT * FROM reviews WHERE order_id IN (SELECT order_id FROM s_orders);`,
  );
  await c.run(
    `CREATE TEMP TABLE s_customers AS ` +
      `SELECT * FROM customers WHERE customer_id IN (SELECT customer_id FROM s_orders);`,
  );
  await c.run(
    `CREATE TEMP TABLE s_products AS ` +
      `SELECT * FROM products WHERE product_id IN (SELECT DISTINCT product_id FROM s_order_items);`,
  );

  // 3. Write each out. category_translation is tiny — keep it whole.
  const out: [string, Name][] = [
    ['s_orders', 'orders'],
    ['s_order_items', 'order_items'],
    ['s_products', 'products'],
    ['s_customers', 'customers'],
    ['s_payments', 'payments'],
    ['s_reviews', 'reviews'],
    ['category_translation', 'category_translation'],
  ];
  for (const [rel, name] of out) {
    const dest = path.join(SAMPLE, FILES[name]);
    await c.run(`COPY (SELECT * FROM ${rel}) TO '${esc(dest)}' (HEADER, DELIMITER ',');`);
  }

  // 4. Verify: re-open a fresh DuckDB over the written sample and run the
  //    headline queries the app relies on. If joins were broken, revenue would
  //    be zero or the category chart empty.
  console.log('\nSample written to data/sample/. Verifying...\n');
  const v = await viewsOverDir(SAMPLE);

  for (const name of Object.keys(FILES) as Name[]) {
    const [{ n }] = (await (await v.runAndReadAll(
      `SELECT COUNT(*) AS n FROM ${name}`,
    )).getRowObjectsJS()) as { n: bigint }[];
    const bytes = fs.statSync(path.join(SAMPLE, FILES[name])).size;
    console.log(`  ${name.padEnd(22)} ${String(Number(n)).padStart(6)} rows   ${(bytes / 1024).toFixed(0)} KB`);
  }

  const rev = await (await v.runAndReadAll(
    `SELECT ROUND(SUM(oi.price), 2) AS revenue
       FROM order_items oi JOIN orders o USING (order_id)
      WHERE o.order_status = 'delivered'`,
  )).getRowObjectsJS();
  const cats = await (await v.runAndReadAll(
    `SELECT t.product_category_name_english AS category, ROUND(SUM(oi.price), 2) AS revenue
       FROM order_items oi
       JOIN orders o USING (order_id)
       JOIN products p USING (product_id)
       LEFT JOIN category_translation t USING (product_category_name)
      WHERE o.order_status = 'delivered'
      GROUP BY 1 ORDER BY revenue DESC LIMIT 5`,
  )).getRowObjectsJS();

  console.log(`\n  delivered revenue: R$ ${Number(rev[0].revenue).toLocaleString()}`);
  console.log('  top categories:');
  for (const r of cats) console.log(`    ${String(r.category).padEnd(24)} R$ ${Number(r.revenue).toLocaleString()}`);

  if (!rev[0].revenue || cats.length === 0) {
    throw new Error('Verification failed: sample produced empty revenue/categories — joins are broken.');
  }
  const total = (Object.keys(FILES) as Name[]).reduce(
    (s, n) => s + fs.statSync(path.join(SAMPLE, FILES[n])).size,
    0,
  );
  console.log(`\n  total sample size: ${(total / 1024).toFixed(0)} KB — OK to commit.\n`);
}

await main();
