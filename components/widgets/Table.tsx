import {
  formatValue,
  formatMoney,
  humanize,
  humanizeValue,
  isMoneyLabel,
} from '@/lib/format';

/** Money columns get "$"; other strings get humanized; numbers get locale commas. */
function formatCell(column: string, v: unknown): string {
  if (typeof v === 'number') {
    return isMoneyLabel(column) ? formatMoney(v) : formatValue(v);
  }
  if (typeof v === 'string') return humanizeValue(v);
  return formatValue(v);
}

export function Table({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c] === 'number')));
  // the column the rows are sorted by gets a bar behind each value (else the first numeric one)
  const nums = (c: string) => rows.map((r) => Number(r[c]) || 0);
  const sorted = (c: string) => {
    const v = nums(c);
    return v.every((x, i) => i === 0 || x <= v[i - 1]) || v.every((x, i) => i === 0 || x >= v[i - 1]);
  };
  const barCol = columns.find((c) => numeric.has(c) && sorted(c)) ?? columns.find((c) => numeric.has(c));
  const barMax = barCol ? Math.max(...rows.map((r) => Math.abs(Number(r[barCol]) || 0))) : 0;

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <span className="shrink-0 text-xs text-muted">
          {/* about 9 rows fit the box; past that, say it scrolls */}
          {rows.length} rows{rows.length > 9 ? ', scroll for all' : ''}
        </span>
      </div>
      {rows.length === 0 ? (
      <p className="grid h-40 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">
        No rows for these filters.
      </p>
      ) : (
      /* fixed height with its own scroll, so a long result never stretches the page */
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-canvas">
            <tr className="text-muted">
              {columns.map((c) => (
                <th
                  key={c}
                  className={`border-b border-line px-3 py-2 font-medium whitespace-nowrap ${numeric.has(c) ? 'text-right' : 'text-left'}`}
                >
                  {humanize(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-canvas/60">
                {columns.map((c) => {
                  const pct = c === barCol && barMax ? (Math.abs(Number(row[c]) || 0) / barMax) * 100 : 0;
                  return (
                    <td
                      key={c}
                      className={`px-1 py-1 text-ink whitespace-nowrap ${numeric.has(c) ? 'text-right' : ''}`}
                    >
                      {/* a td can't anchor an absolute child reliably, so the bar sits in a div */}
                      <div className="relative px-2 py-1">
                        {pct > 0 && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 right-0 rounded-sm bg-brand-soft"
                            style={{ width: `${pct}%` }}
                          />
                        )}
                        <span className="relative">{formatCell(c, row[c])}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
