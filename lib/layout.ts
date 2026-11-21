import { z } from 'zod';
import {
  SqlSchema,
  filterParams,
  formatIssues,
  validateSpec,
  widgetSql,
  type DashboardSpec,
  type Filter,
  type Tile,
  type Widget,
} from './spec';
import { paramNames } from './sql-safety';

/**
 * THE LAYOUT CONTRACT.
 *
 * The model answers with { title, queries: [{ id, sql }], html }. The html is
 * written in a closed vocabulary: a few layout and text tags plus one custom
 * element per widget, each pointing at a query by id. Nothing outside the
 * vocabulary passes: no <script>, no event handlers, no style, no URLs, no
 * unknown tags or attributes. SQL never appears inside the html.
 *
 * We never inject the html. It is tokenized, checked against the allow-list
 * below, and converted into typed widgets (lib/spec.ts) plus a layout tree
 * that React renders with our own components. Every rejection is a specific
 * sentence the retry loop can feed back to the model.
 */

export const LayoutResponseSchema = z
  .object({
    title: z.string().min(1),
    queries: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'query id must be lowercase letters, digits or _'),
            sql: SqlSchema,
          })
          .strict(),
      )
      .min(1, 'at least one query is required'),
    html: z.string().min(1),
  })
  .strict();

type Children = 'blocks' | 'tiles' | 'text' | 'none';
interface TagRule {
  attrs: string[];
  required: string[];
  children: Children;
}

const container: TagRule = { attrs: [], required: [], children: 'blocks' };
const text: TagRule = { attrs: [], required: [], children: 'text' };
const chart: TagRule = { attrs: ['title', 'query', 'x', 'series'], required: ['title', 'query', 'x', 'series'], children: 'none' };

export const TAGS: Record<string, TagRule> = {
  section: container,
  'grid-row': container,
  h2: text,
  h3: text,
  p: text,
  'kpi-group': { attrs: ['title'], required: ['title'], children: 'tiles' },
  'kpi-tile': {
    attrs: ['title', 'query', 'metric', 'delta-query', 'delta-label'],
    required: ['title', 'query', 'metric'],
    children: 'none',
  },
  'bar-chart': chart,
  'line-chart': chart,
  'data-table': { attrs: ['title', 'query', 'columns'], required: ['title', 'query', 'columns'], children: 'none' },
  'filter-select': { attrs: ['name', 'label', 'options-query'], required: ['name', 'label', 'options-query'], children: 'none' },
  'date-range': { attrs: ['name', 'label'], required: ['name', 'label'], children: 'none' },
};
const FILTER_TAGS = new Set(['filter-select', 'date-range']);

/** What React renders: text and containers, with widgets referenced by index into spec.widgets. */
export type LayoutNode =
  | { kind: 'widget'; index: number }
  | { kind: 'text'; tag: 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'section' | 'row'; children: LayoutNode[] };

export type LayoutResult =
  | { ok: true; spec: DashboardSpec; layout: LayoutNode[] }
  | { ok: false; error: string };

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const MAX_ERRORS = 6;
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^<>]*)>|([^<]+)|(<)/g;
const ATTR = /\s+([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/y;

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? _,
  );
}

function parseAttrs(src: string, tag: string, errors: string[]): { attrs: Record<string, string>; selfClosing: boolean } {
  let s = src.trimEnd();
  const selfClosing = s.endsWith('/');
  if (selfClosing) s = s.slice(0, -1).trimEnd();
  const attrs: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    ATTR.lastIndex = i;
    const m = ATTR.exec(s);
    if (!m) {
      errors.push(`<${tag}> has a malformed attribute near "${s.slice(i).trim().slice(0, 30)}"; write every attribute as name="value"`);
      break;
    }
    const name = m[1].toLowerCase();
    if (name in attrs) errors.push(`<${tag}> repeats the attribute "${name}"`);
    attrs[name] = decode(m[2]);
    i = ATTR.lastIndex;
  }
  return { attrs, selfClosing };
}

/** Tokenize into an element tree. Unknown tags still enter the tree so their close tags match. */
function toTree(html: string, errors: string[]): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  for (const m of html.matchAll(TOKEN)) {
    const [, slash, rawName, rawAttrs, text, stray] = m;
    const top = stack[stack.length - 1];
    if (stray) {
      errors.push('found a "<" that does not start a tag; write it as &lt;');
    } else if (text !== undefined) {
      top.children.push(decode(text));
    } else if (rawName) {
      const tag = rawName.toLowerCase();
      if (slash) {
        if (top.tag === tag) stack.pop();
        else errors.push(`</${tag}> does not close the open <${top.tag}>`);
        continue;
      }
      if (!TAGS[tag]) {
        errors.push(`<${tag}> is not allowed; allowed tags: ${Object.keys(TAGS).join(', ')}`);
      }
      const { attrs, selfClosing } = parseAttrs(rawAttrs, tag, errors);
      const el: El = { tag, attrs, children: [] };
      top.children.push(el);
      if (!selfClosing) stack.push(el);
    }
    // comments are skipped
  }
  for (const el of stack.slice(1)) errors.push(`<${el.tag}> is never closed`);
  return root;
}

const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Validate a parsed model response and convert it into typed widgets + layout.
 * Steps: envelope (Zod, incl. SQL safety) → html allow-list → widget contract (Zod).
 */
export function parseLayout(raw: unknown): LayoutResult {
  const env = LayoutResponseSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: formatIssues(env.error) };
  const { title, queries, html } = env.data;

  const errors: string[] = [];
  const sqlById = new Map<string, string>();
  for (const q of queries) {
    if (sqlById.has(q.id)) errors.push(`query id "${q.id}" is used twice`);
    sqlById.set(q.id, q.sql);
  }

  const widgets: Widget[] = [];
  const filters: Filter[] = [];

  function sqlFor(el: El, attr: string): string {
    const id = el.attrs[attr];
    const sql = sqlById.get(id);
    if (sql === undefined) {
      errors.push(`<${el.tag} ${attr}="${id}"> points at no query; known ids: ${[...sqlById.keys()].join(', ')}`);
      return '';
    }
    return sql;
  }

  function checkAttrs(el: El, rule: TagRule) {
    for (const name of Object.keys(el.attrs)) {
      if (!rule.attrs.includes(name)) {
        errors.push(
          `<${el.tag}> does not allow the attribute "${name}"` +
            (rule.attrs.length ? ` (allowed: ${rule.attrs.join(', ')})` : ' (it takes none)'),
        );
      }
    }
    for (const name of rule.required) {
      if (!el.attrs[name]?.trim()) errors.push(`<${el.tag}> needs a non-empty "${name}" attribute`);
    }
    if (('delta-query' in el.attrs) !== ('delta-label' in el.attrs)) {
      errors.push(`<${el.tag}> needs delta-query and delta-label together`);
    }
  }

  function toTile(el: El): Tile {
    const tile: Tile = { title: el.attrs.title, metric: el.attrs.metric, sql: sqlFor(el, 'query') };
    if (el.attrs['delta-query']) {
      tile.delta = { sql: sqlFor(el, 'delta-query'), label: el.attrs['delta-label'] ?? '' };
    }
    return tile;
  }

  function toWidget(el: El): Widget {
    const a = el.attrs;
    switch (el.tag) {
      case 'kpi-tile':
        return { type: 'tile', ...toTile(el) };
      case 'kpi-group':
        return {
          type: 'tileGroup',
          title: a.title,
          tiles: el.children.filter((c): c is El => typeof c !== 'string' && c.tag === 'kpi-tile').map(toTile),
        };
      case 'data-table':
        return { type: 'table', title: a.title, sql: sqlFor(el, 'query'), columns: list(a.columns ?? '') };
      default:
        return {
          type: 'chart',
          chartType: el.tag === 'line-chart' ? 'line' : 'bar',
          title: a.title,
          sql: sqlFor(el, 'query'),
          x: a.x,
          series: list(a.series ?? ''),
        };
    }
  }

  function convert(parent: El, allowed: Children): LayoutNode[] {
    const out: LayoutNode[] = [];
    for (const child of parent.children) {
      if (typeof child === 'string') {
        if (allowed !== 'text' && child.trim()) {
          errors.push(`text "${child.trim().slice(0, 30)}" must sit inside <h2>, <h3> or <p>`);
        }
        continue;
      }
      const rule = TAGS[child.tag];
      if (!rule) continue; // already reported
      const where = parent.tag === '#root' ? 'the top level' : `<${parent.tag}>`;
      if (allowed === 'text' || allowed === 'none') {
        errors.push(`${where} cannot contain <${child.tag}>`);
        continue;
      }
      if (allowed === 'tiles' && child.tag !== 'kpi-tile') {
        errors.push(`<kpi-group> may only contain <kpi-tile>, not <${child.tag}>`);
        continue;
      }
      if (FILTER_TAGS.has(child.tag)) {
        if (parent.tag !== '#root') {
          errors.push(`<${child.tag}> must sit at the top level, not inside ${where}`);
          continue;
        }
        checkAttrs(child, rule);
        const { name, label } = child.attrs;
        filters.push(
          child.tag === 'date-range'
            ? { type: 'dateRange', name, label }
            : { type: 'select', name, label, sql: sqlFor(child, 'options-query') },
        );
        continue; // filters render in the filter bar, not in the layout
      }
      checkAttrs(child, rule);

      if (rule.children === 'text') {
        convert(child, 'text');
        const text = child.children.filter((c) => typeof c === 'string').join('').replace(/\s+/g, ' ').trim();
        if (!text) errors.push(`<${child.tag}> is empty`);
        out.push({ kind: 'text', tag: child.tag as 'h2' | 'h3' | 'p', text });
      } else if (rule.children === 'blocks') {
        out.push({ kind: child.tag === 'grid-row' ? 'row' : 'section', children: convert(child, 'blocks') });
      } else {
        convert(child, rule.children); // reports anything nested where it shouldn't be
        if (allowed === 'tiles') continue; // a tile inside a group belongs to the group's widget
        widgets.push(toWidget(child));
        out.push({ kind: 'widget', index: widgets.length - 1 });
      }
    }
    return out;
  }

  const layout = convert(toTree(html, errors), 'blocks');
  if (!errors.length && !widgets.length) {
    errors.push('the html has no widgets; use kpi-tile, kpi-group, bar-chart, line-chart or data-table');
  }
  if (!errors.length) checkParams(widgets, filters, errors);
  if (errors.length) {
    const more = errors.length > MAX_ERRORS ? ` (+${errors.length - MAX_ERRORS} more)` : '';
    return { ok: false, error: `html: ${errors.slice(0, MAX_ERRORS).join('; ')}${more}` };
  }

  const spec = validateSpec({ title, widgets, ...(filters.length ? { filters } : {}) });
  if (!spec.ok) return spec;
  return { ok: true, spec: spec.spec, layout };
}

/**
 * Every $param a widget query uses must belong to a declared filter, every
 * filter parameter must be used, and option queries take no parameters
 * (their choices must not shift as the viewer filters).
 */
function checkParams(widgets: Widget[], filters: Filter[], errors: string[]) {
  const declared = new Set<string>();
  for (const f of filters) {
    if (filterParams(f).some((p) => declared.has(p))) errors.push(`two filters are named "${f.name}"`);
    filterParams(f).forEach((p) => declared.add(p));
    if (f.type === 'select' && paramNames(f.sql).length) {
      errors.push(`the options-query of filter "${f.name}" must not use $parameters`);
    }
  }
  const known = declared.size ? [...declared].map((p) => `$${p}`).join(', ') : 'none (add a filter tag first)';
  const used = new Set<string>();
  for (const p of widgets.flatMap(widgetSql).flatMap(paramNames)) {
    if (!declared.has(p) && !used.has(p)) errors.push(`a query uses $${p}, but no filter declares it; declared: ${known}`);
    used.add(p);
  }
  for (const p of declared) {
    if (!used.has(p)) errors.push(`no widget query uses $${p}; filter on it with ($${p} IS NULL OR ...) or remove the filter`);
  }
}
