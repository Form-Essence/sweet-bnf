/**
 * Unit tests for MCP request handling
 */

import { describe, it, expect } from 'vitest';
import {
  createMCPServer,
  handleRequestDirectly,
  MethodNotFoundError,
  toToolResponse,
} from '../../src/mcpServer.js';

describe('handleRequestDirectly', () => {
  it('answers ping', async () => {
    const server = await createMCPServer();
    await expect(handleRequestDirectly(server, 'ping', {})).resolves.toEqual({});
  });

  it('accepts any notification without a response', async () => {
    const server = await createMCPServer();
    await expect(handleRequestDirectly(server, 'notifications/initialized', {})).resolves.toBeNull();
    await expect(handleRequestDirectly(server, 'notifications/cancelled', { requestId: 1 })).resolves.toBeNull();
  });

  it('reports unknown methods as method-not-found', async () => {
    const server = await createMCPServer();
    await expect(handleRequestDirectly(server, 'prompts/list', {})).rejects.toBeInstanceOf(MethodNotFoundError);
  });

  it('returns invalid tool arguments as an isError result, not a protocol error', async () => {
    const server = await createMCPServer();
    const result = (await handleRequestDirectly(server, 'tools/call', {
      name: 'get_item_details',
      arguments: { ark: '' },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Invalid arguments for get_item_details: ark/);
  });

  it('returns unknown tools as an isError result', async () => {
    const server = await createMCPServer();
    const result = (await handleRequestDirectly(server, 'tools/call', {
      name: 'nope',
      arguments: {},
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});

describe('toToolResponse', () => {
  it('serializes plain results as JSON text', () => {
    expect(toToolResponse({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }] });
  });

  it('passes through results that are already MCP content', () => {
    expect(toToolResponse({ content: [{ text: 'hi' }], isError: true })).toEqual({
      content: [{ type: 'text', text: 'hi' }],
      isError: true,
    });
  });
});
