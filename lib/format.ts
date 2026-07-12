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

/**
 * Does a metric/column/title refer to a money amount? Olist amounts are BRL.
 * Excludes counting/score-ish labels that merely mention a money word
 * (e.g. "payment_count").
 */
const MONEY_RE = /revenue|price|freight|payment|sales|gmv|spend|amount/i;
const NOT_MONEY_RE = /count|qty|score|pct|percent|%|rate|days|num/i;
export function isMoneyLabel(label: string): boolean {
  return MONEY_RE.test(label) && !NOT_MONEY_RE.test(label);
}

/**
 * "$ 13,221,498.11" for tiles and table cells. Display-only choice: the
 * underlying amounts are Brazilian Real (Olist is BRL e-commerce data), shown
 * with a plain "$" prefix rather than "R$" for a more universal glance-read.
 */
export function formatMoney(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return formatValue(v);
  return (
    '$ ' +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Compact axis numbers: 1400000 -> "1.4M". */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * Humanize a *data value* for display (axis ticks, tooltip labels, table cells).
 * Only touches lowercase tokens — snake_case ("health_beauty" -> "Health Beauty")
 * and plain lowercase words/phrases ("sao paulo" -> "Sao Paulo"). Dates, codes
 * ("SP"), and mixed-case values pass through untouched.
 */
export function humanizeValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v !== 'string') return String(v);
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(v)) return humanize(v);
  if (/^[a-z][a-z ]*$/.test(v)) {
    return v
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return v;
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
