import type { DashboardSpec } from '@/lib/spec';
import type { LayoutNode } from '@/lib/layout';
import type { WidgetData } from '@/lib/run';
import { Tile } from './widgets/Tile';
import { TileGroup } from './widgets/TileGroup';
import { Chart } from './widgets/Chart';
import { Table } from './widgets/Table';

/**
 * Walks the validated layout tree and renders our own components. The model's
 * html is never injected: by now it has been reduced to text nodes, containers
 * and widget indexes. spec.widgets[i] is aligned with data[i] (runSpec keeps order).
 * Without a layout (e.g. a hand-written spec) the widgets stack vertically.
 */
export function DashboardRenderer({
  spec,
  data,
  layout,
}: {
  spec: DashboardSpec;
  data: WidgetData[];
  layout?: LayoutNode[];
}) {
  const nodes = layout ?? spec.widgets.map((_, index): LayoutNode => ({ kind: 'widget', index }));

  function widget(i: number) {
    const w = spec.widgets[i];
    const d = data[i];
    switch (w.type) {
      case 'tile':
        return d.kind === 'tile' ? <Tile title={w.title} data={d.tile} /> : null;
      case 'tileGroup':
        return d.kind === 'tileGroup' ? <TileGroup title={w.title} tileSpecs={w.tiles} data={d.tiles} /> : null;
      case 'chart':
        return d.kind === 'rows' ? (
          <Chart title={w.title} chartType={w.chartType} x={w.x} series={w.series} rows={d.rows} />
        ) : null;
      case 'table':
        return d.kind === 'rows' ? <Table title={w.title} columns={w.columns} rows={d.rows} /> : null;
    }
  }

  function render(list: LayoutNode[]) {
    return list.map((n, k) => {
      switch (n.kind) {
        case 'widget':
          return <div key={k} className="min-w-0">{widget(n.index)}</div>;
        case 'text':
          if (n.tag === 'h2' && n.text === spec.title)
            return <h2 key={k} className="text-2xl font-bold tracking-tight text-ink">{n.text}</h2>;
          if (n.tag === 'h2') return <h3 key={k} className="text-lg font-semibold text-ink">{n.text}</h3>;
          if (n.tag === 'h3') return <h4 key={k} className="text-base font-semibold text-ink">{n.text}</h4>;
          return <p key={k} className="max-w-prose text-sm leading-6 text-muted">{n.text}</p>;
        case 'row':
          return (
            <div key={k} className="grid gap-6 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
              {render(n.children)}
            </div>
          );
        case 'section':
          return <section key={k} className="flex flex-col gap-6">{render(n.children)}</section>;
      }
    });
  }

  // the model often repeats the title as its own <h2>; show it once
  const hasTitle = (list: LayoutNode[]): boolean =>
    list.some((n) => (n.kind === 'text' ? n.tag === 'h2' && n.text === spec.title : n.kind !== 'widget' && hasTitle(n.children)));

  return (
    <div className="flex flex-col gap-6">
      {!hasTitle(nodes) && <h2 className="text-2xl font-bold tracking-tight text-ink">{spec.title}</h2>}
      {render(nodes)}
    </div>
  );
}
