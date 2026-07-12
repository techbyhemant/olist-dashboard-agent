import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt, buildRetryPrompt } from './prompt';

/**
 * Provider boundary for spec generation. Isolating the LLM call here means the
 * retry loop (generateDashboard.ts) is provider-agnostic and unit-testable with
 * the mock, with zero spend / no subprocess.
 *
 * Selection:
 *   MOCK_LLM=1            -> deterministic mock (used by evals; also lets the whole
 *                           loop run with no credentials).
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
  /** Returns the raw model text (expected to be a JSON object). */
  generate(input: GenInput): Promise<string>;
}

const DEFAULT_MODEL = process.env.DASHBOARD_MODEL ?? 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

class MessagesApiGenerator implements SpecGenerator {
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

    // Single-turn inference. No tools, no thinking: the model returns a JSON
    // spec as text, which the pipeline parses + validates (Zod) + retries. The
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
 * model, it returns a DELIBERATELY broken spec on the first attempt (priorError
 * undefined) and a valid one on the retry. It ignores the question content.
 */
class MockGenerator implements SpecGenerator {
  readonly name = 'mock';

  async generate({ priorError }: GenInput): Promise<string> {
    if (!priorError) {
      // metric "revenue" but SQL aliases the column "total" -> runSpec shape check fails.
      return JSON.stringify({
        title: 'Mock dashboard',
        widgets: [
          {
            type: 'tile',
            title: 'Total revenue (delivered)',
            metric: 'revenue',
            sql: `SELECT ROUND(SUM(oi.price), 2) AS total
                  FROM order_items oi JOIN orders o USING (order_id)
                  WHERE o.order_status = 'delivered'`,
          },
        ],
      });
    }
    // Corrected: alias matches the metric, plus a valid bar chart.
    return JSON.stringify({
      title: 'Mock dashboard (corrected)',
      widgets: [
        {
          type: 'tile',
          title: 'Total revenue (delivered)',
          metric: 'revenue',
          sql: `SELECT ROUND(SUM(oi.price), 2) AS revenue
                FROM order_items oi JOIN orders o USING (order_id)
                WHERE o.order_status = 'delivered'`,
        },
        {
          type: 'chart',
          chartType: 'bar',
          title: 'Top categories by revenue',
          x: 'category',
          series: ['revenue'],
          sql: `SELECT t.product_category_name_english AS category,
                       ROUND(SUM(oi.price), 2) AS revenue
                FROM order_items oi
                JOIN orders o USING (order_id)
                JOIN products p USING (product_id)
                LEFT JOIN category_translation t USING (product_category_name)
                WHERE o.order_status = 'delivered'
                GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
        },
      ],
    });
  }
}

export function getGenerator(): SpecGenerator {
  if (process.env.MOCK_LLM === '1' || process.env.MOCK_LLM === 'true') {
    return new MockGenerator();
  }
  return new MessagesApiGenerator();
}
