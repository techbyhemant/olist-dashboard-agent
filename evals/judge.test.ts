import { describe, it, expect } from 'vitest';
import { generateDashboard } from '@/lib/generateDashboard';
import { getGenerator } from '@/lib/llm';
import { judgeSpec } from './_judge';
import { GOLDEN_QUESTIONS } from './fixtures/golden';

/**
 * EVAL LAYER 3 — LLM-as-judge (real model; GATED + costs tokens).
 * Off by default so CI is free/deterministic. Run with:
 *   RUN_LLM_EVALS=1 npm test
 * (requires CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY; ensure MOCK_LLM is unset).
 */
const ENABLED = process.env.RUN_LLM_EVALS === '1';

describe.skipIf(!ENABLED)('Layer 3 — LLM-as-judge on golden questions', () => {
  for (const g of GOLDEN_QUESTIONS) {
    it(
      `answers: ${g.id}`,
      async () => {
        delete process.env.MOCK_LLM; // force the real generator
        const result = await generateDashboard(g.question, getGenerator());
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const verdict = await judgeSpec(g.question, result.spec);
        // A passing dashboard should clearly address the question.
        expect(verdict.score, verdict.reason).toBeGreaterThanOrEqual(4);
      },
      120_000,
    );
  }
});
