import type { DashboardSpec } from './spec';

/**
 * Hardcoded spec used for the pre-LLM checkpoint — exercises every widget type
 * (tileGroup, tile+delta, bar chart, line chart, table) against the real CSVs.
 * Once the LLM loop lands, this becomes a render/test fixture.
 */
export const SAMPLE_SPEC: DashboardSpec = {
  title: 'Olist — Store Overview (hardcoded checkpoint)',
  widgets: [
    {
      type: 'tileGroup',
      title: 'Business at a glance',
      tiles: [
        {
          title: 'Total revenue (delivered)',
          metric: 'revenue',
          sql: `SELECT ROUND(SUM(oi.price), 2) AS revenue
                FROM order_items oi JOIN orders o USING (order_id)
                WHERE o.order_status = 'delivered'`,
        },
        {
          title: 'Delivered orders',
          metric: 'orders',
          sql: `SELECT COUNT(*) AS orders FROM orders WHERE order_status = 'delivered'`,
        },
        {
          title: 'Avg review score',
          metric: 'avg_score',
          sql: `SELECT ROUND(AVG(review_score), 2) AS avg_score FROM reviews`,
        },
      ],
    },
    {
      type: 'tile',
      title: 'Revenue — Aug 2018',
      metric: 'revenue',
      sql: `SELECT ROUND(SUM(oi.price), 2) AS revenue
            FROM order_items oi JOIN orders o USING (order_id)
            WHERE o.order_status = 'delivered'
              AND date_trunc('month', o.order_purchase_timestamp) = DATE '2018-08-01'`,
      delta: {
        label: 'vs Jul 2018 (%)',
        sql: `SELECT ROUND(100.0 * (aug - jul) / jul, 1) AS pct FROM (
                SELECT
                  SUM(CASE WHEN m = '2018-08' THEN price END) AS aug,
                  SUM(CASE WHEN m = '2018-07' THEN price END) AS jul
                FROM (
                  SELECT strftime(date_trunc('month', o.order_purchase_timestamp), '%Y-%m') AS m,
                         oi.price
                  FROM order_items oi JOIN orders o USING (order_id)
                  WHERE o.order_status = 'delivered'
                )
              )`,
      },
    },
    {
      type: 'chart',
      chartType: 'bar',
      title: 'Top categories by revenue',
      x: 'category',
      series: ['revenue'],
      sql: `SELECT t.product_category_name_english AS category,
                   ROUND(SUM(oi.price), 2) AS revenue
            FROM order_items oi
            JOIN orders o USING (order_id)
            JOIN products p USING (product_id)
            LEFT JOIN category_translation t USING (product_category_name)
            WHERE o.order_status = 'delivered'
            GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
    },
    {
      type: 'chart',
      chartType: 'line',
      title: 'Monthly revenue (2017-01 .. 2018-08)',
      x: 'month',
      series: ['revenue'],
      sql: `SELECT strftime(date_trunc('month', o.order_purchase_timestamp), '%Y-%m') AS month,
                   ROUND(SUM(oi.price), 2) AS revenue
            FROM orders o JOIN order_items oi USING (order_id)
            WHERE o.order_status = 'delivered'
              AND o.order_purchase_timestamp >= DATE '2017-01-01'
              AND o.order_purchase_timestamp <  DATE '2018-09-01'
            GROUP BY 1 ORDER BY 1`,
    },
    {
      type: 'table',
      title: 'Delivery & satisfaction by state',
      columns: ['state', 'orders', 'avg_review_score', 'avg_delivery_days', 'on_time_pct'],
      sql: `SELECT c.customer_state AS state,
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
            GROUP BY 1 ORDER BY orders DESC LIMIT 10`,
    },
  ],
};
