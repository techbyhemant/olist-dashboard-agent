import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateDashboard } from '@/lib/generateDashboard';
import { DEFAULT_MODEL, MessagesApiGenerator, type GenInput, type SpecGenerator } from '@/lib/llm';
import { EXAMPLES } from '@/lib/examples';

/**
 * Records real model output for the example questions into lib/recorded-runs.json,
 * which the public demo replays (RECORDED_RUNS=1). Costs tokens, so it only runs on:
 *   npm run record        (needs ANTHROPIC_API_KEY in .env.local)
 */
it.skipIf(process.env.RECORD_RUNS !== '1')(
  'records the example runs',
  async () => {
    try {
      process.loadEnvFile('.env.local');
    } catch {}
    const api = new MessagesApiGenerator();
    const runs: Record<string, string[]> = {};
    for (const q of EXAMPLES) {
      const outputs: string[] = [];
      const recorder: SpecGenerator = {
        name: api.name,
        async generate(input: GenInput) {
          const out = await api.generate(input);
          outputs.push(out);
          return out;
        },
      };
      const result = await generateDashboard(q, recorder);
      console.log(`${result.ok ? 'ok' : 'FAILED'} after ${result.attempts} attempt(s): ${q}`);
      runs[q] = outputs;
    }
    const file = { model: DEFAULT_MODEL, recordedAt: new Date().toISOString(), runs };
    writeFileSync('lib/recorded-runs.json', JSON.stringify(file, null, 2) + '\n');
  },
  300_000,
);
