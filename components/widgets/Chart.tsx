'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  humanize,
  humanizeValue,
  formatCompact,
  formatMoney,
  formatValue,
  isMoneyLabel,
} from '@/lib/format';

const PALETTE = ['#0e7c5a', '#e0a100', '#2f5d8a', '#b5523b', '#6b5b95', '#5e8c31'];
const AXIS = { fontSize: 12, fill: '#66737f' };
const GRID = '#e8ecea';

export function Chart({
  title,
  chartType,
  x,
  series,
  rows,
}: {
  title: string;
  chartType: 'bar' | 'line';
  x: string;
  series: string[];
  rows: Record<string, unknown>[];
}) {
  // "R$" prefix on the axis only when every series is a money metric.
  const money = series.length > 0 && series.every((s) => isMoneyLabel(s));
  const yTick = (n: number) => (money ? `R$ ${formatCompact(n)}` : formatCompact(n));
  const tooltipValue = (value: unknown, name: unknown, entry: { dataKey?: unknown }) => {
    const key = String(entry?.dataKey ?? '');
    const text =
      typeof value === 'number' && isMoneyLabel(key)
        ? formatMoney(value)
        : formatValue(value);
    return [text, String(name)] as [string, string];
  };
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="mb-4 text-base font-semibold text-ink">{title}</h3>
      <p className="grid h-40 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">
        No rows for these filters.
      </p>
      </section>
    );
  }
  // many categories: lay bars sideways so every label stays readable, even on a phone
  const sideways = chartType === 'bar' && rows.length > 8;
  const height = sideways ? rows.length * 26 + 48 : 288;
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="mb-4 text-base font-semibold text-ink">{title}</h3>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          {sideways ? (
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={AXIS} tickFormatter={yTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey={x} tick={AXIS} width={120} tickFormatter={humanizeValue} interval={0} axisLine={false} tickLine={false} />
              <Tooltip formatter={tooltipValue} labelFormatter={humanizeValue} cursor={{ fill: '#f3f5f4' }} />
              {series.length > 1 && <Legend />}
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} name={humanize(s)} fill={PALETTE[i % PALETTE.length]} radius={[0, 4, 4, 0]} barSize={14} />
              ))}
            </BarChart>
          ) : chartType === 'bar' ? (
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey={x} tick={AXIS} tickFormatter={humanizeValue} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} width={72} tickFormatter={yTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={tooltipValue} labelFormatter={humanizeValue} cursor={{ fill: '#f3f5f4' }} />
              {series.length > 1 && <Legend />}
              {series.map((s, i) => (
                <Bar
                  key={s}
                  dataKey={s}
                  name={humanize(s)}
                  fill={PALETTE[i % PALETTE.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey={x} tick={AXIS} tickFormatter={humanizeValue} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS} width={72} tickFormatter={yTick} axisLine={false} tickLine={false} />
              <Tooltip formatter={tooltipValue} labelFormatter={humanizeValue} />
              {series.length > 1 && <Legend />}
              {series.map((s, i) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  name={humanize(s)}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2.5}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
