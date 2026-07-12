import type { TileData } from '@/lib/run';
import { formatValue } from '@/lib/format';

function DeltaArrow({ delta }: { delta: NonNullable<TileData['delta']> }) {
  const n = typeof delta.value === 'number' ? delta.value : Number(delta.value);
  const known = Number.isFinite(n);
  const up = known && n > 0;
  const down = known && n < 0;
  const color = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-zinc-500';
  const arrow = up ? '▲' : down ? '▼' : '•';
  return (
    <div className={`mt-2 flex items-center gap-1 text-sm font-medium ${color}`}>
      <span aria-hidden>{arrow}</span>
      <span>{formatValue(delta.value)}</span>
      <span className="font-normal text-zinc-500">{delta.label}</span>
    </div>
  );
}

export function Tile({ title, data }: { title: string; data: TileData }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-zinc-500">{title}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {formatValue(data.value)}
      </div>
      {data.delta && <DeltaArrow delta={data.delta} />}
    </div>
  );
}
