import type { TileData } from '@/lib/run';
import { formatValue, formatMoney, isMoneyLabel } from '@/lib/format';

function DeltaArrow({ delta }: { delta: NonNullable<TileData['delta']> }) {
  const n = typeof delta.value === 'number' ? delta.value : Number(delta.value);
  const known = Number.isFinite(n);
  const up = known && n > 0;
  const down = known && n < 0;
  const color = up ? 'text-brand' : down ? 'text-[#b5523b]' : 'text-muted';
  const arrow = up ? '▲' : down ? '▼' : '•';
  return (
    <div className={`mt-2 flex items-center gap-1 text-sm font-medium ${color}`}>
      <span aria-hidden>{arrow}</span>
      <span>{formatValue(delta.value)}</span>
      <span className="font-normal text-muted">{delta.label}</span>
    </div>
  );
}

export function Tile({ title, data }: { title: string; data: TileData }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="text-sm text-muted">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-ink">
        {isMoneyLabel(title) ? formatMoney(data.value) : formatValue(data.value)}
      </div>
      {data.delta && <DeltaArrow delta={data.delta} />}
    </div>
  );
}
