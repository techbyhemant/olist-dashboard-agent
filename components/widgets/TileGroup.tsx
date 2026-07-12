import type { TileData } from '@/lib/run';
import { Tile } from './Tile';

export function TileGroup({
  title,
  tileSpecs,
  data,
}: {
  title: string;
  tileSpecs: { title: string }[];
  data: TileData[];
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tileSpecs.map((t, i) => (
          <Tile key={i} title={t.title} data={data[i]} />
        ))}
      </div>
    </section>
  );
}
