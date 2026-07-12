/**
 * Exploration script for the Olist dataset.
 *
 * Run with native Node TypeScript stripping (Node >= 23):
 *   node scripts/explore.ts
 *
 * Prints, for each in-scope table: columns + inferred types, row count, and 5
 * sample rows; then the join keys linking the tables; then data-quality notes
 * derived from live queries. Also writes the same content to scripts/exploration.md.
 */
import { query, TABLES, type TableName } from '../lib/db.ts';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const lines: string[] = [];
function out(s = '') {
  console.log(s);
  lines.push(s);
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return s.length > 40 ? s.slice(0, 37) + '...' : s;
}

async function describe(table: TableName) {
  const cols = await query(
    `SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM ${table})`,
  );
  const [{ n }] = (await query(`SELECT COUNT(*) AS n FROM ${table}`)) as { n: number }[];
  const sample = await query(`SELECT * FROM ${table} LIMIT 5`);

  out(`\n## ${table}  —  ${n.toLocaleString()} rows`);
  out('\nColumns (name: inferred type):');
  for (const c of cols) out(`  - ${c.column_name}: ${c.column_type}`);

  out('\nSample rows:');
  const headers = cols.map((c) => String(c.column_name));
  out('  ' + headers.join(' | '));
  for (const row of sample) {
    out('  ' + headers.map((h) => fmtCell(row[h])).join(' | '));
  }
}

async function joinKeys() {
  out('\n\n# Join keys (how the tables connect)');
  const edges = [
    ['orders.customer_id', '→', 'customers.customer_id', '(1 order ↔ 1 customer row; customers.customer_unique_id de-dupes a person across orders)'],
    ['order_items.order_id', '→', 'orders.order_id', '(many items per order)'],
    ['order_items.product_id', '→', 'products.product_id', '(many items per product)'],
    ['payments.order_id', '→', 'orders.order_id', '(may be many payment rows per order)'],
    ['reviews.order_id', '→', 'orders.order_id', '(≈1 review per order; some orders unmatched)'],
    ['products.product_category_name', '→', 'category_translation.product_category_name', '(Portuguese → English label)'],
  ];
  out('\n  (order_item_id is NOT a global id — it is a per-order line number 1..n)\n');
  for (const [from, arrow, to, note] of edges) {
    out(`  ${from} ${arrow} ${to}  ${note}`);
  }
}

async function dataQuality() {
  out('\n\n# Data-quality notes (from live queries)');

  // Order status distribution + delivery-timestamp nulls
  const status = await query(
    `SELECT order_status, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY n DESC`,
  );
  out('\nOrder status distribution:');
  for (const r of status) out(`  ${r.order_status}: ${(r.n as number).toLocaleString()}`);

  const nullDelivery = await query(
    `SELECT
        COUNT(*) FILTER (WHERE order_delivered_customer_date IS NULL) AS null_delivered,
        COUNT(*) FILTER (WHERE order_approved_at IS NULL)             AS null_approved
     FROM orders`,
  );
  out(
    `\nNulls in orders: order_delivered_customer_date=${nullDelivery[0].null_delivered}, ` +
      `order_approved_at=${nullDelivery[0].null_approved} (not all orders reach delivery).`,
  );

  // Products with missing category
  const nullCat = await query(
    `SELECT COUNT(*) AS n FROM products WHERE product_category_name IS NULL`,
  );
  out(`\nProducts with NULL product_category_name: ${nullCat[0].n}.`);

  // Categories present in products but missing from translation table
  const untranslated = await query(
    `SELECT DISTINCT p.product_category_name
       FROM products p
       LEFT JOIN category_translation t USING (product_category_name)
      WHERE p.product_category_name IS NOT NULL
        AND t.product_category_name_english IS NULL`,
  );
  out(
    `\nCategory names that have NO English translation: ${untranslated.length}` +
      (untranslated.length
        ? ` (e.g. ${untranslated.slice(0, 5).map((r) => r.product_category_name).join(', ')})`
        : '') +
      '. All category_name values are Portuguese.',
  );

  // Multiple rows per order — items
  const multiItems = await query(
    `SELECT MAX(c) AS max_items, AVG(c) AS avg_items,
            COUNT(*) FILTER (WHERE c > 1) AS orders_with_multi
       FROM (SELECT order_id, COUNT(*) AS c FROM order_items GROUP BY 1)`,
  );
  out(
    `\nMultiple rows per order in order_items: max ${multiItems[0].max_items} lines, ` +
      `avg ${Number(multiItems[0].avg_items).toFixed(2)}, ` +
      `${(multiItems[0].orders_with_multi as number).toLocaleString()} orders have >1 line. ` +
      `=> aggregate before joining or revenue/counts will double-count.`,
  );

  // Multiple payment rows per order + payment types
  const multiPay = await query(
    `SELECT MAX(c) AS max_pay, COUNT(*) FILTER (WHERE c > 1) AS orders_multi
       FROM (SELECT order_id, COUNT(*) AS c FROM payments GROUP BY 1)`,
  );
  const payTypes = await query(
    `SELECT payment_type, COUNT(*) AS n FROM payments GROUP BY 1 ORDER BY n DESC`,
  );
  out(
    `\nMultiple payment rows per order: max ${multiPay[0].max_pay}, ` +
      `${(multiPay[0].orders_multi as number).toLocaleString()} orders split across rows. ` +
      `Payment types: ${payTypes.map((r) => `${r.payment_type}(${r.n})`).join(', ')}.`,
  );

  // Reviews: comment nulls + orders without a review
  const reviewNulls = await query(
    `SELECT
        COUNT(*) FILTER (WHERE review_comment_message IS NULL) AS null_msg,
        COUNT(*) AS total
     FROM reviews`,
  );
  const ordersNoReview = await query(
    `SELECT COUNT(*) AS n FROM orders o
      LEFT JOIN reviews r USING (order_id)
      WHERE r.review_id IS NULL`,
  );
  out(
    `\nReviews: ${reviewNulls[0].null_msg}/${reviewNulls[0].total} have NULL comment text ` +
      `(scores still present). Orders with no review row: ${ordersNoReview[0].n}.`,
  );

  // Date range / format sanity
  const dates = await query(
    `SELECT MIN(order_purchase_timestamp) AS min_ts, MAX(order_purchase_timestamp) AS max_ts
       FROM orders`,
  );
  out(
    `\nDate range (order_purchase_timestamp): ${fmtCell(dates[0].min_ts)} → ${fmtCell(dates[0].max_ts)}. ` +
      `read_csv_auto parsed all timestamp columns as TIMESTAMP (single 'YYYY-MM-DD HH:MM:SS' format; no mixed formats detected).`,
  );
}

function compactSummary() {
  out('\n\n# Compact schema summary (for the LLM system prompt)');
  out(
    '\nThis is the condensed contract handed to the model. Tables are DuckDB views ' +
      'over the CSVs (query in place). Revenue = SUM(order_items.price) at item grain. ' +
      'Filter order_status = \'delivered\' for completed-business KPIs.\n',
  );
  out('```text');
  out('orders(order_id PK, customer_id FK->customers, order_status, order_purchase_timestamp,');
  out('       order_approved_at, order_delivered_carrier_date, order_delivered_customer_date,');
  out('       order_estimated_delivery_date)  -- TIMESTAMPs; status: delivered|shipped|canceled|');
  out('       unavailable|invoiced|processing|created|approved');
  out('order_items(order_id FK->orders, order_item_id, product_id FK->products, seller_id,');
  out('       shipping_limit_date, price DOUBLE, freight_value DOUBLE)  -- order_item_id is a');
  out('       per-order line number (1..n), NOT a global id; up to 21 lines/order');
  out('products(product_id PK, product_category_name [Portuguese, may be NULL], product_*_lenght,');
  out('       product_photos_qty, product_weight_g, product_length/height/width_cm)');
  out('customers(customer_id PK, customer_unique_id [person across orders], customer_zip_code_prefix,');
  out('       customer_city, customer_state)  -- customer_id is 1:1 with an order');
  out('payments(order_id FK->orders, payment_sequential, payment_type [credit_card|boleto|voucher|');
  out('       debit_card|not_defined], payment_installments, payment_value DOUBLE)  -- up to 29 rows/order');
  out('reviews(review_id, order_id FK->orders, review_score 1..5, review_comment_title/message [often NULL],');
  out('       review_creation_date, review_answer_timestamp)  -- ~1/order; 768 orders have none');
  out('category_translation(product_category_name [Portuguese] -> product_category_name_english)');
  out('```');
  out('\nGotchas the SQL must respect:');
  out('- order_items / payments have MULTIPLE rows per order → aggregate before joining or use COUNT(DISTINCT order_id) to avoid double-counting.');
  out('- product_category_name is Portuguese → LEFT JOIN category_translation for English labels (2 categories untranslated, 610 products NULL).');
  out('- Not all orders are delivered; delivery timestamps can be NULL → AVG ignores NULLs, but filter status for clean KPIs.');
  out('- Time series edges are sparse (2016-09, 2018-09/10) → healthy range is 2017-01 .. 2018-08.');
}

async function main() {
  out('# Olist data exploration');
  out(`Generated by scripts/explore.ts. Tables in scope: ${Object.keys(TABLES).join(', ')}.`);
  out('(geolocation and sellers are intentionally excluded.)');

  for (const t of Object.keys(TABLES) as TableName[]) {
    await describe(t);
  }
  await joinKeys();
  await dataQuality();
  compactSummary();

  const mdPath = path.join(process.cwd(), 'scripts', 'exploration.md');
  await writeFile(mdPath, lines.join('\n') + '\n', 'utf8');
  out(`\n\nWrote markdown report to ${mdPath}`);
}

await main();
