import { streamDashboard, type StreamEvent } from '@/lib/generateDashboard';

export const runtime = 'nodejs'; // DuckDB native addon + Agent SDK subprocess
export const dynamic = 'force-dynamic';

/**
 * POST { question: string }
 * -> 400 { ok:false, error }                     (bad request, plain JSON)
 * -> 200 NDJSON stream of StreamEvent lines:
 *      { "type":"log", "entry": {...} }   (one per pipeline step, as it happens)
 *      { "type":"result", "result": {...} }   (final; ok:true with spec+data, or ok:false)
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 });
  }

  const question = (body as { question?: unknown })?.question;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return Response.json(
      { ok: false, error: 'Provide a non-empty "question" string.' },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const write = (controller: ReadableStreamDefaultController, ev: StreamEvent) =>
    controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of streamDashboard(question.trim())) {
          write(controller, ev);
        }
      } catch (e) {
        write(controller, {
          type: 'result',
          result: { ok: false, error: `Server error: ${(e as Error).message}`, log: [], attempts: 0 },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no', // discourage proxy buffering
    },
  });
}
