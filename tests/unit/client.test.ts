/**
 * Unit tests for the Gallica HTTP client: retry policy, errors, caching, decoding
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, GallicaError, decodeBody } from '../../src/gallica/client.js';
import { fakeRequest, FakeReply } from './helpers.js';

function client(replies: FakeReply[], options: { retries?: number; cacheTtl?: number } = {}) {
  const requestFn = fakeRequest(replies);
  const http = new HttpClient('https://gallica.bnf.fr', {
    requestFn,
    minRequestInterval: 0,
    retries: options.retries ?? 1,
    cacheTtl: options.cacheTtl ?? 0,
  });
  return { http, requestFn };
}

async function failure(promise: Promise<unknown>): Promise<GallicaError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GallicaError);
    return error as GallicaError;
  }
  throw new Error('Expected a GallicaError');
}

describe('HttpClient', () => {
  it('returns 2xx bodies', async () => {
    const { http } = client([{ status: 200, body: 'ok' }]);
    await expect(http.getXml('/SRU', { q: 'x' })).resolves.toBe('ok');
  });

  it('does not retry HTTP 500 (Gallica uses it for bad queries and unknown ARKs)', async () => {
    const { http, requestFn } = client([{ status: 500, body: '<html>boom</html>' }]);
    const error = await failure(http.get('/SRU'));
    expect(error.kind).toBe('server_error');
    expect(error.statusCode).toBe(500);
    expect(error.message).not.toContain('<html>');
    expect(requestFn.calls).toHaveLength(1);
  });

  it('does not retry 4xx', async () => {
    const { http, requestFn } = client([{ status: 400 }]);
    expect((await failure(http.get('/x'))).kind).toBe('bad_request');
    expect(requestFn.calls).toHaveLength(1);
  });

  it('retries 503 once, honouring Retry-After', async () => {
    const { http, requestFn } = client([
      { status: 503, headers: { 'retry-after': '0' } },
      { status: 200, body: 'ok' },
    ]);
    await expect(http.getXml('/x')).resolves.toBe('ok');
    expect(requestFn.calls).toHaveLength(2);
  });

  it('gives up after the configured number of retries', async () => {
    const { http, requestFn } = client([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    ]);
    expect((await failure(http.get('/x'))).kind).toBe('rate_limited');
    expect(requestFn.calls).toHaveLength(2);
  });

  it('reports the ALTCHA redirect as blocked without retrying', async () => {
    const { http, requestFn } = client([
      { status: 302, headers: { location: 'https://gallica.bnf.fr/services/engine/search/altcha?altchaNotVerified=false' } },
    ]);
    const error = await failure(http.get('/ark:/12148/x.texteBrut'));
    expect(error.kind).toBe('blocked');
    expect(requestFn.calls).toHaveLength(1);
  });

  it('reports 403 Access Denied as blocked, not as a bad request', async () => {
    const { http, requestFn } = client([{ status: 403, body: 'Access Denied: 403 Access Interdit' }]);
    const error = await failure(http.get('/SRU'));
    expect(error.kind).toBe('blocked');
    expect(requestFn.calls).toHaveLength(1);
  });

  it('explains connection resets (Gallica IP bans)', async () => {
    const { http, requestFn } = client(
      [{ error: { code: 'ECONNRESET' } }, { error: { code: 'ECONNRESET' } }],
      { retries: 1 }
    );
    const error = await failure(http.get('/x'));
    expect(error.kind).toBe('network');
    expect(error.message).toMatch(/too many requests/);
    expect(requestFn.calls).toHaveLength(2);
  });

  it('maps timeouts', async () => {
    const { http } = client([{ error: { name: 'TimeoutError' } }], { retries: 0 });
    expect((await failure(http.get('/x'))).kind).toBe('timeout');
  });

  it('caches successful responses and shares in-flight requests', async () => {
    const { http, requestFn } = client([{ status: 200, body: 'manifest' }], { cacheTtl: 60000 });
    const [a, b] = await Promise.all([http.getXml('/m.json'), http.getXml('/m.json')]);
    expect([a, b]).toEqual(['manifest', 'manifest']);
    await expect(http.getXml('/m.json')).resolves.toBe('manifest');
    expect(requestFn.calls).toHaveLength(1);
  });

  it('does not cache failures', async () => {
    const { http, requestFn } = client([{ status: 500 }, { status: 200, body: 'ok' }], { cacheTtl: 60000 });
    await failure(http.get('/x'));
    await expect(http.getXml('/x')).resolves.toBe('ok');
    expect(requestFn.calls).toHaveLength(2);
  });
});

describe('decodeBody', () => {
  it('decodes UTF-8', () => {
    const bytes = new TextEncoder().encode('Misérables');
    expect(decodeBody(bytes.buffer as ArrayBuffer, 'text/xml;charset=UTF-8')).toBe('Misérables');
  });

  it('decodes ISO-8859-1 ALTO even when the header claims UTF-8', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><String CONTENT="Misérables"/>';
    const bytes = Uint8Array.from(xml, (c) => c.charCodeAt(0));
    expect(decodeBody(bytes.buffer as ArrayBuffer, 'application/xml;charset=UTF-8')).toContain('Misérables');
  });
});
