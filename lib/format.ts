// Tokens that shouldn't just be Title-cased when humanizing column keys.
const LABEL_OVERRIDES: Record<string, string> = {
  pct: '%',
  avg: 'Avg',
  id: 'ID',
  sql: 'SQL',
  usd: 'USD',
  qty: 'Qty',
  num: 'No.',
  aov: 'AOV',
  ytd: 'YTD',
};

/**
 * Turn a SQL-ish column key into a human label:
 *   avg_review_score -> "Avg Review Score", on_time_pct -> "On Time %",
 *   customerState -> "Customer State". Handles snake_case and camelCase.
 */
export function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((t) => {
      const lower = t.toLowerCase();
      if (LABEL_OVERRIDES[lower]) return LABEL_OVERRIDES[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Display formatting shared by widgets. Pure + testable. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
