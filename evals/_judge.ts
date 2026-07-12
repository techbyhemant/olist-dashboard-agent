import Anthropic from '@anthropic-ai/sdk';
import type { DashboardSpec } from '@/lib/spec';

/**
 * LLM-as-judge helper (not a test file — the `_` prefix keeps it out of the
 * vitest include glob). Asks the model to score, 1-5, how well a generated spec
 * answers the question. Used sparingly: only the gated Layer-3 eval calls this.
 */
export interface Judgement {
  score: number; // 1-5
  reason: string;
}

const JUDGE_SYSTEM = `You are a strict evaluator of analytics dashboards. Given an
operator question and a dashboard spec (JSON), rate 1-5 how well the dashboard
ANSWERS the question (5 = directly and completely; 1 = irrelevant). Judge relevance
of widgets/metrics to the question, not styling. Return ONLY JSON:
{"score": <1-5 integer>, "reason": "<one sentence>"}`;

export async function judgeSpec(question: string, spec: DashboardSpec): Promise<Judgement> {
  const prompt = `Question: ${question}\n\nSpec:\n${JSON.stringify(spec, null, 2)}\n\nReturn the JSON judgement.`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: process.env.DASHBOARD_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const fence = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed = JSON.parse(fence ? fence[1] : text);
  return { score: Number(parsed.score), reason: String(parsed.reason ?? '') };
}
