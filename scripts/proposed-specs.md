# Proposed dashboard specs (3)

Three dashboard questions an Olist e-commerce operator would actually ask, each
with a concrete spec and **DuckDB SQL verified to run against the real CSVs**
(via `lib/db.ts`). Variety: one bar, one time-series line, one table.

Conventions used across all three:
- Revenue is `SUM(order_items.price)` at item granularity (one row per line
  item) — this avoids the order-level double-counting risk noted in
  `exploration.md` (9,803 orders have >1 line; orders can also have multiple
  payment rows). Freight is excluded from "revenue"; add `freight_value` if the
  operator wants gross billed.
- All three filter to `order_status = 'delivered'` so KPIs reflect completed
  business, not canceled/unavailable orders.

---

## Spec 1 — Bar: Top product categories by revenue

> "Which product categories bring in the most money?"

```json
{
  "chartType": "bar",
  "dimension": "product_category (English label)",
  "measure": "revenue (SUM of order_items.price)",
  "aggregation": "sum",
  "filter": "order_status = 'delivered'",
  "drilldown": "category → individual products (product_id) within that category"
}
```

Notes: `product_category_name` is Portuguese; we `LEFT JOIN category_translation`
to get English labels. 610 products have a NULL category and 2 categories have no
English translation (`pc_gamer`, `portateis_cozinha_e_preparadores_de_alimentos`) —
the LEFT JOIN keeps them (category shows as NULL) rather than silently dropping them.

```sql
SELECT t.product_category_name_english AS category,
       ROUND(SUM(oi.price), 2) AS revenue,
       COUNT(*)               AS items_sold
FROM order_items oi
JOIN orders   o USING (order_id)
JOIN products p USING (product_id)
LEFT JOIN category_translation t USING (product_category_name)
WHERE o.order_status = 'delivered'
GROUP BY 1
ORDER BY revenue DESC
LIMIT 10;
```

Verified — returns 10 rows. Top 5:

| category | revenue | items_sold |
|---|---|---|
| health_beauty | 1,233,131.72 | 9,465 |
| watches_gifts | 1,166,176.98 | 5,859 |
| bed_bath_table | 1,023,434.76 | 10,953 |
| sports_leisure | 954,852.55 | 8,431 |
| computers_accessories | 888,724.61 | 7,644 |

---

## Spec 2 — Line: Monthly revenue trend

> "How is monthly revenue trending over time?"

```json
{
  "chartType": "line",
  "dimension": "month (date_trunc('month', order_purchase_timestamp))",
  "measure": "revenue (SUM of order_items.price); secondary: distinct orders",
  "aggregation": "sum",
  "filter": "order_status = 'delivered' AND purchase month BETWEEN 2017-01 and 2018-08",
  "drilldown": "month → day, or month → category"
}
```

Notes: the raw series spans 2016-09 → 2018-10 but the **edges are sparse/partial**
(2016-09 = 1 order, 2016-12 = 1 order; 2018-09/10 trail off). For a clean trend,
restrict to **2017-01 through 2018-08**. The SQL below returns the full series so
the messiness is visible; apply the date filter in the UI/query layer.

```sql
SELECT strftime(date_trunc('month', o.order_purchase_timestamp), '%Y-%m') AS month,
       ROUND(SUM(oi.price), 2)        AS revenue,
       COUNT(DISTINCT o.order_id)     AS orders
FROM orders o
JOIN order_items oi USING (order_id)
WHERE o.order_status = 'delivered'
GROUP BY 1
ORDER BY 1;
```

Verified — returns 23 monthly rows. Edge vs. healthy months:

| month | revenue | orders |
|---|---|---|
| 2016-09 | 134.97 | 1 (sparse — exclude) |
| 2016-10 | 40,325.11 | 265 |
| … | … | … |
| 2018-07 | 867,953.46 | 6,159 |
| 2018-08 | 838,576.64 | 6,351 |

---

## Spec 3 — Table: Delivery & satisfaction by customer state

> "Where are we delivering slowly or disappointing customers?"

```json
{
  "chartType": "table",
  "dimension": "customer_state",
  "measure": "orders, avg_review_score, avg_delivery_days, on_time_pct",
  "aggregation": "count distinct orders; avg review score; avg delivery days; % delivered on/before estimate",
  "filter": "order_status = 'delivered'",
  "drilldown": "state → city (customer_city), or state → individual late orders"
}
```

Notes: multi-measure operational table. `COUNT(DISTINCT order_id)` guards against
the reviews join inflating order counts; `AVG(review_score)` ignores the 768 orders
with no review row and the ~58k NULL comment texts (scores are still present).
`on_time_pct` compares `order_delivered_customer_date` to
`order_estimated_delivery_date`.

```sql
SELECT c.customer_state AS state,
       COUNT(DISTINCT o.order_id) AS orders,
       ROUND(AVG(r.review_score), 2) AS avg_review_score,
       ROUND(AVG(date_diff('day', o.order_purchase_timestamp,
                                  o.order_delivered_customer_date)), 1) AS avg_delivery_days,
       ROUND(100.0 * AVG(CASE WHEN o.order_delivered_customer_date
                                 <= o.order_estimated_delivery_date
                              THEN 1 ELSE 0 END), 1) AS on_time_pct
FROM orders o
JOIN customers c USING (customer_id)
LEFT JOIN reviews r USING (order_id)
WHERE o.order_status = 'delivered'
GROUP BY 1
ORDER BY orders DESC;
```

Verified — returns one row per state (27). Top 5 by volume:

| state | orders | avg_review_score | avg_delivery_days | on_time_pct |
|---|---|---|---|---|
| SP | 40,501 | 4.25 | 8.7 | 94.1 |
| RJ | 12,350 | 3.96 | 15.2 | 86.5 |
| MG | 11,354 | 4.19 | 11.9 | 94.4 |
| RS | 5,345 | 4.19 | 15.3 | 92.8 |
| PR | 4,923 | 4.24 | 11.9 | 95.0 |

The RJ row already tells a story: slowest delivery (15.2 days), lowest on-time
rate (86.5%), lowest satisfaction (3.96) among the high-volume states.

---

## Recommendation

All three are independent and cover bar / line / table. Pick which to build first;
I have not scaffolded any renderer or React yet.
