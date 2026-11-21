import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt, buildRetryPrompt } from './prompt';
import recordedJson from './recorded-runs.json';

/**
 * Provider boundary for spec generation. Isolating the LLM call here means the
 * retry loop (generateDashboard.ts) is provider-agnostic and unit-testable with
 * the mock, with zero spend / no subprocess.
 *
 * Selection:
 *   MOCK_LLM=1            -> deterministic mock (used by evals; also lets the whole
 *                           loop run with no credentials).
 *   RECORDED_RUNS=1       -> replays real model output saved by `npm run record`
 *                           (the public demo: real answers, no spend).
 *   otherwise            -> Anthropic Messages API (@anthropic-ai/sdk), authenticated
 *                           with ANTHROPIC_API_KEY. No subprocess, so it deploys on
 *                           serverless (Vercel) unlike the Claude Agent SDK.
 */
export interface GenInput {
  question: string;
  priorError?: string;
}

export interface SpecGenerator {
  readonly name: string;
  /** Returns the raw model text (expected to be a JSON object: title, queries, html). */
  generate(input: GenInput): Promise<string>;
}

export const DEFAULT_MODEL = process.env.DASHBOARD_MODEL ?? 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

export class MessagesApiGenerator implements SpecGenerator {
  readonly name = 'messages-api';

  private preflight() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey || apiKey === 'paste-your-key-here') {
      throw new Error(
        'ANTHROPIC_API_KEY is missing or still the placeholder — set a Console API key in .env.local, or use MOCK_LLM=1.',
      );
    }
  }

  async generate({ question, priorError }: GenInput): Promise<string> {
    this.preflight();
    // Constructed after preflight so a missing key yields the message above,
    // not the SDK's generic "could not resolve authentication method".
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userPrompt = priorError
      ? buildRetryPrompt(question, priorError)
      : buildUserPrompt(question);

    // Single-turn inference. No tools, no thinking: the model returns JSON with
    // queries + closed-vocabulary html, which the pipeline parses, checks and retries. The
    // retry loop is why we don't need structured outputs (unsupported on
    // Sonnet 4.6 anyway).
    const message = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' },
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const resultText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!resultText.trim()) throw new Error('Messages API returned no text content');
    return resultText;
  }
}

/**
 * Deterministic mock. To make the retry loop observable end-to-end without a
 * model, it returns a layout that breaks the tag allow-list on the first attempt
 * (priorError undefined) and a valid one on the retry. It ignores the question.
 */
const REVENUE_SQL = `SELECT ROUND(SUM(oi.price), 2) AS revenue
  FROM order_items oi JOIN orders o USING (order_id)
  WHERE o.order_status = 'delivered'`;

// Both filters, applied to a query that has orders o joined to customers c.
const FILTERED = `($state IS NULL OR c.customer_state = $state)
    AND ($period_from IS NULL OR o.order_purchase_timestamp >= CAST($period_from AS DATE))
    AND ($period_to IS NULL OR o.order_purchase_timestamp < CAST($period_to AS DATE))`;

class MockGenerator implements SpecGenerator {
  readonly name = 'mock';

  async generate({ priorError }: GenInput): Promise<string> {
    if (!priorError) {
      // <div class="grid"> is outside the vocabulary -> the allow-list rejects it.
      return JSON.stringify({
        title: 'Mock dashboard',
        queries: [{ id: 'q_revenue', sql: REVENUE_SQL }],
        html: `<div class="grid"><kpi-tile title="Total revenue (delivered)" query="q_revenue" metric="revenue"></kpi-tile></div>`,
      });
    }
    return JSON.stringify({
      title: 'Mock dashboard (corrected)',
      queries: [
        { id: 'q_states', sql: `SELECT DISTINCT customer_state AS value FROM customers ORDER BY 1` },
        {
          id: 'q_revenue',
          sql: `SELECT ROUND(SUM(oi.price), 2) AS revenue
                FROM order_items oi JOIN orders o USING (order_id) JOIN customers c USING (customer_id)
                WHERE o.order_status = 'delivered' AND ${FILTERED}`,
        },
        {
          id: 'q_orders',
          sql: `SELECT COUNT(DISTINCT o.order_id) AS orders
                FROM orders o JOIN customers c USING (customer_id)
                WHERE o.order_status = 'delivered' AND ${FILTERED}`,
        },
        {
          id: 'q_top',
          sql: `SELECT t.product_category_name_english AS category,
                       ROUND(SUM(oi.price), 2) AS revenue
                FROM order_items oi
                JOIN orders o USING (order_id)
                JOIN customers c USING (customer_id)
                JOIN products p USING (product_id)
                LEFT JOIN category_translation t USING (product_category_name)
                WHERE o.order_status = 'delivered' AND ${FILTERED}
                GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
        },
      ],
      html: `<filter-select name="state" label="Customer state" options-query="q_states"></filter-select>
<date-range name="period" label="Purchase date"></date-range>
<p>Revenue and order count for delivered orders, then the categories that bring in the most.</p>
<grid-row>
  <kpi-tile title="Total revenue (delivered)" query="q_revenue" metric="revenue"></kpi-tile>
  <kpi-tile title="Delivered orders" query="q_orders" metric="orders"></kpi-tile>
</grid-row>
<bar-chart title="Top categories by revenue" query="q_top" x="category" series="revenue"></bar-chart>`,
    });
  }
}

/**
 * Replays what the real model wrote for the example questions (lib/recorded-runs.json).
 * Only the model's text is replayed: parsing, the allow-list check and the SQL
 * all run live, so a recorded rejected draft is rejected again here.
 */
const recorded = recordedJson as { model: string | null; recordedAt: string | null; runs: Record<string, string[]> };
const runs = recorded.runs;
const key = (q: string) => q.trim().toLowerCase();
const byKey = new Map(Object.entries(runs).map(([q, outputs]) => [key(q), outputs]));

export const replayMode = () => process.env.RECORDED_RUNS === '1';
export const hasRecording = (question: string) => byKey.has(key(question));

class ReplayGenerator implements SpecGenerator {
  readonly name = `replay of ${recorded.model}, recorded ${recorded.recordedAt?.slice(0, 10)}`;

  async generate({ question, priorError }: GenInput): Promise<string> {
    const outputs = byKey.get(key(question));
    const out = outputs?.[priorError ? 1 : 0];
    if (!out) throw new Error('no recorded output for this question and attempt');
    return out;
  }
}

export function getGenerator(): SpecGenerator {
  if (process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true') {
    return new MockGenerator();
  }
  if (replayMode()) return new ReplayGenerator();
  return new MessagesApiGenerator();
}
