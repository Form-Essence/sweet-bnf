/**
 * HTTP client for Gallica API with throttling, caching, retry logic and error handling
 *
 * Gallica drops connections (TCP reset on every gallica.bnf.fr URL) from IPs that send
 * bursts of requests, so every request goes through a shared queue that keeps at most one
 * request in flight and spaces them out. Retries are limited to errors that can actually
 * succeed on a second try.
 */

import { request } from 'undici';
import { config } from '../config.js';
import { logger } from '../logging.js';

export type GallicaErrorKind =
  | 'bad_request'
  | 'not_found'
  | 'server_error'
  | 'unavailable'
  | 'rate_limited'
  | 'blocked'
  | 'network'
  | 'timeout';

const RETRYABLE_KINDS: ReadonlySet<GallicaErrorKind> = new Set([
  'unavailable',
  'rate_limited',
  'network',
  'timeout',
]);

/**
 * Error raised for any failed Gallica request. The message is written for the model
 * reading the tool result, so it says what happened and what to do about it.
 */
export class GallicaError extends Error {
  readonly kind: GallicaErrorKind;
  readonly statusCode: number | undefined;
  readonly url: string;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: GallicaErrorKind,
    message: string,
    url: string,
    statusCode?: number,
    retryAfterMs?: number
  ) {
    super(message);
    this.name = 'GallicaError';
    this.kind = kind;
    this.url = url;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

export interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Minimal shape of undici's request(), so tests can substitute it
 */
export type RequestFn = (
  url: string,
  options: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
    headersTimeout: number;
    bodyTimeout: number;
  }
) => Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: { arrayBuffer(): Promise<ArrayBuffer> };
}>;

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  deadline?: number;
  minRequestInterval?: number;
  cacheTtl?: number;
  requestFn?: RequestFn;
}

const MAX_CACHE_ENTRIES = 50;
const MAX_RETRY_AFTER_MS = 10000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serializes requests: one in flight at a time, starts spaced by at least `interval` ms
 */
class RequestThrottle {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = 0;

  run<T>(interval: number, fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.lastStart + interval - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastStart = Date.now();
      return fn();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

// Shared by every client in the process: Gallica limits per IP, not per client
const sharedThrottle = new RequestThrottle();

/**
 * Decode a response body. Gallica's ALTO is declared ISO-8859-1 in the XML prolog while
 * the Content-Type header says UTF-8, so neither can be trusted: valid UTF-8 wins,
 * otherwise fall back to the declared or Latin-1 encoding.
 */
export function decodeBody(buffer: ArrayBuffer, contentType?: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    const prolog = new TextDecoder('latin1').decode(buffer.slice(0, 200));
    const declared =
      /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(prolog)?.[1] ??
      /charset=([^;\s]+)/i.exec(contentType ?? '')?.[1];
    const label = declared && !/^utf-?8$/i.test(declared) ? declared : 'windows-1252';
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      return new TextDecoder('windows-1252').decode(buffer);
    }
  }
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return undefined;
}

function errorForStatus(
  statusCode: number,
  headers: Record<string, string>,
  url: string
): GallicaError {
  if (statusCode >= 300 && statusCode < 400) {
    const location = headers['location'] || '';
    if (/altcha|captcha/i.test(location)) {
      return new GallicaError(
        'blocked',
        'Gallica redirected this request to its anti-bot challenge (ALTCHA), so this ' +
          'endpoint cannot be used by automated clients right now.',
        url,
        statusCode
      );
    }
    return new GallicaError(
      'server_error',
      `Gallica answered with an unexpected redirect (HTTP ${statusCode}) to ${location || 'an unknown location'}.`,
      url,
      statusCode
    );
  }
  if (statusCode === 429) {
    return new GallicaError(
      'rate_limited',
      'Gallica is rate-limiting this server (HTTP 429). Wait a minute before retrying and make fewer calls in a row.',
      url,
      statusCode,
      parseRetryAfter(headers['retry-after'])
    );
  }
  if (statusCode === 403) {
    // Seen as "Access Denied: 403 Access Interdit" while an IP ban is being lifted
    return new GallicaError(
      'blocked',
      'Gallica denied access to this server (HTTP 403 Access Denied). Gallica temporarily blocks IP ' +
        'addresses that send too many requests; wait several minutes before retrying.',
      url,
      statusCode
    );
  }
  if (statusCode === 404 || statusCode === 410) {
    return new GallicaError('not_found', `Gallica has no resource at this address (HTTP ${statusCode}).`, url, statusCode);
  }
  if (statusCode >= 400 && statusCode < 500) {
    return new GallicaError('bad_request', `Gallica rejected the request (HTTP ${statusCode}).`, url, statusCode);
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return new GallicaError(
      'unavailable',
      `Gallica is temporarily unavailable (HTTP ${statusCode}). Try again in a few minutes.`,
      url,
      statusCode,
      parseRetryAfter(headers['retry-after'])
    );
  }
  // Gallica also answers 500 for invalid CQL queries and unknown ARKs, so this is not
  // necessarily an outage and is not retried. Callers add context-specific hints.
  return new GallicaError('server_error', `Gallica returned HTTP ${statusCode}.`, url, statusCode);
}

function errorForException(error: unknown, url: string, timeoutMs: number): GallicaError {
  if (error instanceof GallicaError) return error;
  const err = error as { name?: string; code?: string; message?: string };
  const code = err?.code || '';
  if (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return new GallicaError(
      'timeout',
      `Gallica did not respond within ${Math.round(timeoutMs / 1000)}s. It may be overloaded; try again later.`,
      url
    );
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'ECONNREFUSED') {
    return new GallicaError(
      'network',
      `Could not reach Gallica (${code}). Gallica drops connections from IP addresses that ` +
        'send too many requests; this usually clears after a few minutes. Avoid making many calls in a row.',
      url
    );
  }
  return new GallicaError('network', `Could not reach Gallica: ${err?.message || String(error)}`, url);
}

/**
 * Centralized HTTP client for Gallica API
 */
export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number;
  private deadline: number;
  private minRequestInterval: number;
  private cacheTtl: number;
  private requestFn: RequestFn;
  private userAgent: string;
  private cache = new Map<string, { expires: number; response: Promise<HttpResponse> }>();

  constructor(baseUrl: string, options: HttpClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.timeout = options.timeout ?? config.httpTimeout;
    this.retries = options.retries ?? config.httpRetries;
    this.deadline = options.deadline ?? config.httpDeadline;
    this.minRequestInterval = options.minRequestInterval ?? config.minRequestInterval;
    this.cacheTtl = options.cacheTtl ?? config.cacheTtl;
    this.requestFn = options.requestFn ?? (request as unknown as RequestFn);
    this.userAgent = 'node-mcp-bnf/1.0.0 (+https://github.com/Form-Essence/sweet-bnf)';
  }

  /**
   * Make HTTP GET request. Resolves only for 2xx responses; everything else
   * rejects with a GallicaError.
   */
  async get(url: string, params?: Record<string, string | number>): Promise<HttpResponse> {
    // If url is already absolute, use it directly; otherwise resolve against baseUrl
    const fullUrl = url.startsWith('http://') || url.startsWith('https://')
      ? new URL(url)
      : new URL(url, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        fullUrl.searchParams.set(key, String(value));
      }
    }
    const key = fullUrl.toString();

    // Identical concurrent requests share one fetch (e.g. the same manifest for details and pages)
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      logger.debug(`[HTTP] Cache hit: ${key}`);
      return cached.response;
    }

    const response = this.fetchWithRetry(key);
    const entry = { expires: Date.now() + this.cacheTtl, response };
    this.cache.set(key, entry);
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    response.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });
    return response;
  }

  private async fetchWithRetry(url: string): Promise<HttpResponse> {
    const deadline = Date.now() + this.deadline;
    for (let attempt = 0; ; attempt++) {
      try {
        logger.info(`[HTTP] GET request: ${url} (attempt ${attempt + 1}/${this.retries + 1})`);
        return await sharedThrottle.run(this.minRequestInterval, () => this.attempt(url, deadline));
      } catch (error) {
        const gallicaError = errorForException(error, url, this.timeout);
        const delay = gallicaError.retryAfterMs ?? Math.pow(2, attempt) * 1000;
        if (!gallicaError.retryable || attempt >= this.retries || Date.now() + delay >= deadline) {
          logger.warn(`[HTTP] Request failed (${gallicaError.kind}): ${gallicaError.message}`);
          throw gallicaError;
        }
        logger.warn(`[HTTP] Request failed (${gallicaError.kind}), retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  private async attempt(url: string, deadline: number): Promise<HttpResponse> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new GallicaError('timeout', 'Gallica request timed out while waiting in the request queue.', url);
    }
    const timeout = Math.min(this.timeout, remaining);
    let response: Awaited<ReturnType<RequestFn>>;
    let buffer: ArrayBuffer;
    try {
      response = await this.requestFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(timeout),
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });
      buffer = await response.body.arrayBuffer();
    } catch (error) {
      throw errorForException(error, url, timeout);
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value[0] || '' : value || '';
    }
    logger.debug(`[HTTP] Response status: ${response.statusCode}, ${buffer.byteLength} bytes`);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw errorForStatus(response.statusCode, headers, url);
    }
    return {
      statusCode: response.statusCode,
      body: decodeBody(buffer, headers['content-type']),
      headers,
    };
  }

  /**
   * Make HTTP GET request and parse as JSON
   */
  async getJson<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    const response = await this.get(url, params);
    try {
      return JSON.parse(response.body) as T;
    } catch (error) {
      throw new GallicaError(
        'server_error',
        `Gallica returned a response that is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        url
      );
    }
  }

  /**
   * Make HTTP GET request and return XML body
   */
  async getXml(url: string, params?: Record<string, string | number>): Promise<string> {
    const response = await this.get(url, params);
    return response.body;
  }
}
