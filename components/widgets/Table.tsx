import {
  formatValue,
  formatMoney,
  humanize,
  humanizeValue,
  isMoneyLabel,
} from '@/lib/format';

/** Money columns get "R$"; other strings get humanized; numbers get locale commas. */
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
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {humanize(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 text-zinc-800 tabular-nums">
                    {formatCell(c, row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
