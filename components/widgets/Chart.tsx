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
import { humanize } from '@/lib/format';

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

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
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">{title}</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey={x} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={64} />
              <Tooltip />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey={x} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={64} />
              <Tooltip />
              {series.length > 1 && <Legend />}
              {series.map((s, i) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  name={humanize(s)}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
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
