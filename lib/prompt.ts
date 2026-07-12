/**
 * System + retry prompts for the dashboard generator. The schema summary mirrors
 * the compact block in scripts/exploration.md (kept here so the prompt is
 * self-contained).
 */

const SCHEMA_SUMMARY = `
Tables are DuckDB views over the Olist CSVs (query in place). DuckDB SQL dialect.
Available tables (use these names directly): orders, order_items, products,
customers, payments, reviews, category_translation. (geolocation & sellers excluded.)

orders(order_id PK, customer_id FK->customers, order_status, order_purchase_timestamp,
       order_approved_at, order_delivered_carrier_date, order_delivered_customer_date,
       order_estimated_delivery_date)  -- TIMESTAMPs; status in:
       delivered|shipped|canceled|unavailable|invoiced|processing|created|approved
order_items(order_id FK->orders, order_item_id [per-order line no, NOT global id],
       product_id FK->products, seller_id, shipping_limit_date, price DOUBLE, freight_value DOUBLE)
products(product_id PK, product_category_name [Portuguese, may be NULL], product_weight_g,
       product_length_cm, product_height_cm, product_width_cm, product_photos_qty, ...)
customers(customer_id PK [1:1 with an order], customer_unique_id [person across orders],
       customer_zip_code_prefix, customer_city, customer_state)
payments(order_id FK->orders, payment_sequential, payment_type
       [credit_card|boleto|voucher|debit_card|not_defined], payment_installments, payment_value DOUBLE)
reviews(review_id, order_id FK->orders, review_score 1..5,
       review_comment_title/message [often NULL], review_creation_date, review_answer_timestamp)
category_translation(product_category_name [Portuguese] -> product_category_name_english)

RULES THE SQL MUST RESPECT:
- Revenue = SUM(order_items.price) at item grain. Add freight_value only if asked for "billed/gross".
- order_items and payments have MULTIPLE rows per order. To count orders use COUNT(DISTINCT order_id);
  aggregate before joining so revenue/counts don't double-count.
- product_category_name is Portuguese -> LEFT JOIN category_translation for English labels.
- For completed-business KPIs filter order_status = 'delivered'. Delivery timestamps can be NULL.
- Data spans 2016-09..2018-10 but edges are sparse; the healthy window is 2017-01..2018-08.
- Every query MUST be a single read-only SELECT. No DDL/DML, no semicolons-joined statements.
`.trim();

const CONTRACT = `
You output ONLY a JSON object (a DashboardSpec). No prose, no markdown fences.

DashboardSpec = { "title": string, "widgets": Widget[] }   // vertical stack; NO layout/grid fields
Widget is one of (discriminated by "type"):
- { "type":"tile",      "title":string, "metric":string, "sql":string, "delta"?:{ "sql":string, "label":string } }
- { "type":"tileGroup", "title":string, "tiles": Tile[] }      // Tile = same fields as a tile minus "type"
- { "type":"chart",     "chartType":"bar"|"line", "title":string, "sql":string, "x":string, "series":string[] }
- { "type":"table",     "title":string, "sql":string, "columns":string[] }

Field semantics (CRITICAL — these must line up with the SQL result columns):
- tile.metric  = the exact column name in that tile's SQL result to show as the big number.
                 The tile SQL must return ONE row containing that column.
- tile.delta   = optional; its SQL returns ONE row with a single number (the change). label describes it.
- chart.x      = result column for the x-axis/category. chart.series = result column(s) to plot.
- table.columns= result column names to show, in order.
- Each widget runs its OWN sql. Column names you reference (metric/x/series/columns) MUST exist in the
  result of that widget's sql (alias them in SELECT to match).
- Prefer a tileGroup for 2-4 related KPIs; a bar chart for category comparisons; a line chart for
  time series (x = a month/day string); a table for multi-column breakdowns.
`.trim();

export function buildSystemPrompt(): string {
  return `You are a dashboard generator for an Olist Brazilian e-commerce dataset.
Given an operator's plain-English question, design a small, useful dashboard and
return it as a typed JSON spec whose SQL runs on DuckDB.

${SCHEMA_SUMMARY}

${CONTRACT}

Keep it focused: 1-4 widgets that directly answer the question. Always alias SQL
output columns to match the metric/x/series/columns names you put in the spec.
Return ONLY the JSON object.`;
}

/** First-attempt user message. */
export function buildUserPrompt(question: string): string {
  return `Operator question: ${question}\n\nReturn the DashboardSpec JSON now.`;
}

/** Retry message: feeds the specific failure back so the model self-corrects. */
export function buildRetryPrompt(question: string, priorError: string): string {
  return `Operator question: ${question}

Your previous response was rejected. Fix it and return a corrected DashboardSpec JSON.
Failure reason:
${priorError}

Common fixes: ensure metric/x/series/columns names EXACTLY match the columns your SQL
SELECTs (add aliases), ensure each SQL is a single read-only SELECT that returns rows,
respect the multi-row-per-order and Portuguese-category rules. Return ONLY the JSON object.`;
}
