/**
 * Test helpers: a scripted stand-in for undici's request()
 */

import type { RequestFn } from '../../src/gallica/client.js';

export type FakeReply =
  | { status: number; body?: string | Uint8Array; headers?: Record<string, string> }
  | { error: { code?: string; name?: string; message?: string } };

export function fakeRequest(replies: FakeReply[]): RequestFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected request: ${url}`);
    if ('error' in reply) throw Object.assign(new Error(reply.error.message ?? 'fail'), reply.error);
    const bytes = typeof reply.body === 'string' ? new TextEncoder().encode(reply.body) : reply.body ?? new Uint8Array();
    return {
      statusCode: reply.status,
      headers: reply.headers ?? {},
      body: { arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer },
    };
  }) as RequestFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}
