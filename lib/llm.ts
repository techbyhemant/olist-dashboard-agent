import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import { buildSystemPrompt, buildUserPrompt, buildRetryPrompt } from './prompt';

/**
 * Provider boundary for spec generation. Isolating the LLM call here means the
 * retry loop (generateDashboard.ts) is provider-agnostic and unit-testable with
 * the mock, with zero spend / no subprocess.
 *
 * Selection:
 *   MOCK_LLM=1            -> deterministic mock (used by evals; also lets the whole
 *                           loop run with no credentials).
 *   otherwise            -> Claude Agent SDK (uses Claude Code auth, i.e. your
 *                           CLAUDE_CODE_OAUTH_TOKEN when ANTHROPIC_API_KEY is unset).
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

class AgentSdkGenerator implements SpecGenerator {
  readonly name = 'agent-sdk';

  private preflight() {
    const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (oauth === 'paste-your-token-here') {
      throw new Error(
        'CLAUDE_CODE_OAUTH_TOKEN in .env.local is still the placeholder — paste your real token.',
      );
    }
    if (!oauth && !apiKey) {
      throw new Error(
        'No credentials found. Set CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) in .env.local, or use MOCK_LLM=1.',
      );
    }
    if (oauth && apiKey) {
      // Not fatal, but ANTHROPIC_API_KEY wins, so the OAuth token would be ignored.
      console.warn(
        '[llm] Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; the API key takes precedence.',
      );
    }
  }

  async generate({ question, priorError }: GenInput): Promise<string> {
    this.preflight();
    const userPrompt = priorError
      ? buildRetryPrompt(question, priorError)
      : buildUserPrompt(question);

    let resultText = '';
    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: DEFAULT_MODEL,
        systemPrompt: buildSystemPrompt(), // replaces the coding-agent system prompt
        allowedTools: [], // pure inference — no file/bash/tool access
        maxTurns: 1,
        settingSources: [], // ignore project CLAUDE.md / settings for determinism
        cwd: os.tmpdir(), // don't write session files into the repo
      },
    })) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          resultText = message.result;
        } else {
          throw new Error(
            `Agent SDK returned ${message.subtype}: ${message.errors?.join('; ') ?? 'unknown error'}`,
          );
        }
      }
    }
    if (!resultText.trim()) throw new Error('Agent SDK returned empty result');
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
  return new AgentSdkGenerator();
}
