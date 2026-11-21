import { it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDashboard } from '@/lib/generateDashboard';
import { DEFAULT_MODEL, MessagesApiGenerator, type GenInput, type SpecGenerator } from '@/lib/llm';
import { EXAMPLES } from '@/lib/examples';
import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt } from '@/lib/prompt';

/**
 * Same prompts as MessagesApiGenerator, sent through the Claude Code CLI on your own
 * login instead of an API key. Run from an empty folder with settings, MCP, skills and
 * tools off, so the model sees only our system prompt and the question.
 */
class ClaudeCliGenerator implements SpecGenerator {
  readonly name = 'claude-cli';
  private cwd = mkdtempSync(join(tmpdir(), 'olist-record-'));
  async generate({ question, priorError }: GenInput): Promise<string> {
    const prompt = priorError ? buildRetryPrompt(question, priorError) : buildUserPrompt(question);
    const args = ['-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '',
      '--no-session-persistence', '--output-format', 'text', '--model', DEFAULT_MODEL, '--system-prompt', buildSystemPrompt()];
    const out = execFileSync('claude', args, { cwd: this.cwd, input: prompt, encoding: 'utf8', maxBuffer: 1 << 24 });
    if (!out.trim()) throw new Error('claude CLI returned no text');
    return out;
  }
}

/**
 * Records real model output for the example questions into lib/recorded-runs.json,
 * which the public demo replays (RECORDED_RUNS=1). Costs tokens, so it only runs on:
 *   npm run record                    (needs ANTHROPIC_API_KEY in .env.local)
 *   RECORD_VIA=cli npm run record     (uses your Claude Code login instead)
 * Questions that already have a recording are kept; RECORD_ALL=1 records them again.
 */
it.skipIf(process.env.RECORD_RUNS !== '1')(
  'records the example runs',
  async () => {
    try {
      process.loadEnvFile('.env.local');
    } catch {}
    const api: SpecGenerator = process.env.RECORD_VIA === 'cli' ? new ClaudeCliGenerator() : new MessagesApiGenerator();
    const saved = JSON.parse(readFileSync('lib/recorded-runs.json', 'utf8')) as { runs: Record<string, string[]> };
    const runs: Record<string, string[]> = {};
    for (const q of EXAMPLES) {
      if (process.env.RECORD_ALL !== '1' && saved.runs[q]) {
        runs[q] = saved.runs[q];
        continue;
      }
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
  600_000,
);
