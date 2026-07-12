import type { DashboardSpec } from '@/lib/spec';
import type { WidgetData } from '@/lib/run';
import { Tile } from './widgets/Tile';
import { TileGroup } from './widgets/TileGroup';
import { Chart } from './widgets/Chart';
import { Table } from './widgets/Table';

/**
 * Maps a validated spec + its executed data to components, as a vertical stack.
 * spec.widgets[i] is aligned with data[i] (runSpec preserves order).
 */
export function DashboardRenderer({
  spec,
  data,
}: {
  spec: DashboardSpec;
  data: WidgetData[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-900">{spec.title}</h2>
      {spec.widgets.map((w, i) => {
        const d = data[i];
        switch (w.type) {
          case 'tile':
            if (d.kind !== 'tile') return null;
            return <Tile key={i} title={w.title} data={d.tile} />;
          case 'tileGroup':
            if (d.kind !== 'tileGroup') return null;
            return <TileGroup key={i} title={w.title} tileSpecs={w.tiles} data={d.tiles} />;
          case 'chart':
            if (d.kind !== 'rows') return null;
            return (
              <Chart
                key={i}
                title={w.title}
                chartType={w.chartType}
                x={w.x}
                series={w.series}
                rows={d.rows}
              />
            );
          case 'table':
            if (d.kind !== 'rows') return null;
            return <Table key={i} title={w.title} columns={w.columns} rows={d.rows} />;
        }
      })}
    </div>
  );
}
