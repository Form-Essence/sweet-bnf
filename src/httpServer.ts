/**
 * HTTP server for MCP over HTTP (Vercel deployment)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMCPServer, handleRequestDirectly, MethodNotFoundError } from './mcpServer.js';
import { logger } from './logging.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverInstance: Server | null = null;

// Track active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

/**
 * Initialize server instance (singleton)
 */
async function getServer(): Promise<Server> {
  if (!serverInstance) {
    serverInstance = await createMCPServer();
  }
  return serverInstance;
}

/**
 * HTTP handler for Vercel and standalone server
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Log all incoming requests
  logger.info(`[HTTP] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    logger.info('[HTTP] Handling OPTIONS preflight request');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(200);
    res.end();
    logger.info('[HTTP] OPTIONS request completed');
    return;
  }

  try {
    logger.info('[HTTP] Getting MCP server instance...');
    const server = await getServer();
    logger.info('[HTTP] MCP server instance ready');
    
    // Handle icon/favicon requests
    if (req.method === 'GET' && (req.url === '/icon.svg' || req.url === '/favicon.ico' || req.url === '/icon')) {
      logger.info(`[HTTP] Serving icon: ${req.url}`);
      try {
        const iconPath = join(__dirname, '..', 'public', 'icon.svg');
        const iconContent = await readFile(iconPath, 'utf-8');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.writeHead(200);
        res.end(iconContent);
        logger.info('[HTTP] Icon served successfully');
        return;
      } catch (error) {
        logger.warn(`[HTTP] Could not serve icon: ${error instanceof Error ? error.message : String(error)}`);
        // Fall through to 404
      }
    }
    
    // Handle SSE connection (GET request)
    if (req.method === 'GET' && req.url === '/message') {
      logger.info('[HTTP] Handling GET request for SSE connection');
      // Set CORS headers BEFORE creating transport
      // The transport.start() will call writeHead() which finalizes headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      logger.info('[HTTP] Creating SSEServerTransport...');
      const transport = new SSEServerTransport('/message', res);
      logger.info('[HTTP] Connecting server to transport...');
      // Note: server.connect() automatically calls transport.start()
      await server.connect(transport);
      
      // Store transport by session ID for POST requests
      const sessionId = transport.sessionId;
      activeTransports.set(sessionId, transport);
      logger.info(`[HTTP] Stored transport with sessionId: ${sessionId}, total active sessions: ${activeTransports.size}`);
      
      // Clean up when transport closes
      transport.onclose = () => {
        activeTransports.delete(sessionId);
        logger.info(`[HTTP] Removed transport session: ${sessionId}, remaining sessions: ${activeTransports.size}`);
      };
      
      transport.onerror = (error) => {
        logger.error(`[HTTP] Transport error for session ${sessionId}:`, error);
      };
      
      logger.info(`[HTTP] MCP Server connected via HTTP/SSE (GET), session: ${sessionId}`);
      return;
    }
    
    // Handle POST messages
    if (req.method === 'POST' && req.url?.startsWith('/message')) {
      logger.info('[HTTP] Handling POST request for message');
      logger.info(`[HTTP] Full URL: ${req.url}`);
      logger.info(`[HTTP] Content-Type: ${req.headers['content-type']}`);
      logger.info(`[HTTP] Content-Length: ${req.headers['content-length']}`);
      
      // Extract session ID from query string OR try to get from first available transport
      const url = new URL(req.url || '/message', `http://${req.headers.host || 'localhost'}`);
      let sessionId = url.searchParams.get('sessionId');
      
      // If no sessionId in query, try to use the first (or only) active transport
      // This handles cases where the MCP bridge doesn't send sessionId in query string
      if (!sessionId && activeTransports.size === 1) {
        const firstSessionId = Array.from(activeTransports.keys())[0];
        if (firstSessionId) {
          sessionId = firstSessionId;
          logger.info(`[HTTP] No sessionId in query, using single active session: ${sessionId}`);
        }
      } else if (!sessionId && activeTransports.size > 1) {
        logger.warn(`[HTTP] Multiple active sessions but no sessionId provided: ${Array.from(activeTransports.keys()).join(', ')}`);
      }
      
      logger.info(`[HTTP] SessionId: ${sessionId || 'none'}`);
      logger.info(`[HTTP] Active sessions: ${Array.from(activeTransports.keys()).join(', ') || 'none'}`);
      
      // Handle stateless POST requests (no sessionId)
      // For stateless requests, we parse JSON-RPC manually and call server handlers directly
      // This avoids the SSE transport which requires connection/start()
      if (!sessionId) {
        logger.info('[HTTP] No sessionId provided - handling as stateless POST request');
        
        try {
          // Read request body
          const bodyChunks: Buffer[] = [];
          for await (const chunk of req) {
            bodyChunks.push(chunk);
          }
          const body = Buffer.concat(bodyChunks).toString('utf-8');
          
          logger.info(`[HTTP] Request body: ${body.substring(0, 500)}`);
          
          // Parse JSON-RPC request
          let request: { jsonrpc: string; id?: number | string | null; method: string; params?: unknown };
          try {
            request = JSON.parse(body);
          } catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(400);
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error' }
            }));
            return;
          }
          
          // Validate JSON-RPC format
          if (request.jsonrpc !== '2.0' || !request.method) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(400);
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: request.id ?? null,
              error: { code: -32600, message: 'Invalid Request' }
            }));
            return;
          }
          
          logger.info(`[HTTP] JSON-RPC method: ${request.method}, id: ${request.id}`);
          
          // Call the handler directly (bypassing transport)
          // Wrap in Promise to catch any synchronous errors
          let response: unknown | null;
          try {
            response = await Promise.resolve(handleRequestDirectly(server, request.method, request.params)).catch((error) => {
              logger.error(`[HTTP] Promise rejection in handleRequestDirectly:`, error instanceof Error ? error.message : String(error));
              logger.error(`[HTTP] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
              throw error;
            });
          } catch (error) {
            if (error instanceof MethodNotFoundError) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.writeHead(200);
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: { code: error.code, message: error.message }
              }));
              return;
            }
            logger.error(`[HTTP] Error in handleRequestDirectly:`, error instanceof Error ? error.message : String(error));
            logger.error(`[HTTP] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
            
            // Send error response
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.writeHead(500);
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: {
                  code: -32603,
                  message: 'Internal error',
                  data: error instanceof Error ? error.message : String(error)
                }
              }));
            }
            return;
          }
          
          // Notifications don't need a response
          if (response === null) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(202); // Accepted, as the MCP HTTP transport expects for notifications
            res.end();
            logger.info('[HTTP] Sent 202 Accepted for notification');
            return;
          }
          
          // Format JSON-RPC response
          const jsonrpcResponse = {
            jsonrpc: '2.0',
            id: request.id ?? null,
            result: response
          };
          
          // Send response
          try {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200);
            res.end(JSON.stringify(jsonrpcResponse));
          } catch (error) {
            logger.error(`[HTTP] Error sending response:`, error instanceof Error ? error.message : String(error));
            // Response already sent or connection closed
          }
          
          logger.info('[HTTP] Successfully handled stateless POST request');
          return;
        } catch (error) {
          logger.error(`[HTTP] Error handling stateless POST:`, error instanceof Error ? error.message : String(error));
          logger.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(500);
            res.end(JSON.stringify({ 
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32603,
                message: 'Internal error',
                data: error instanceof Error ? error.message : String(error)
              }
            }));
          }
          return;
        }
      }
      
      // Handle stateful POST requests (with sessionId)
      const transport = activeTransports.get(sessionId);
      if (!transport) {
        logger.warn(`[HTTP] No transport found for sessionId: ${sessionId}`);
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.writeHead(404);
          res.end(JSON.stringify({ 
            error: 'SSE connection not found for session',
            sessionId,
            activeSessions: Array.from(activeTransports.keys())
          }));
        }
        return;
      }
      
      logger.info(`[HTTP] Found transport for sessionId: ${sessionId}, calling handlePostMessage...`);
      // handlePostMessage will set its own headers (including writeHead), so don't set headers here
      try {
        // Wrap handlePostMessage to catch any synchronous errors
        const handlePromise = transport.handlePostMessage(req, res);
        
        // Also listen for errors on the request stream
        req.on('error', (error) => {
          logger.error(`[HTTP] Request stream error:`, error);
        });
        
        await handlePromise;
        logger.info(`[HTTP] Successfully handled POST message for session: ${sessionId}`);
        return;
      } catch (error) {
        logger.error(`[HTTP] Error handling POST message for session ${sessionId}:`, error instanceof Error ? error.message : String(error));
        logger.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.writeHead(500);
          res.end(JSON.stringify({ 
            error: 'Internal server error',
            message: error instanceof Error ? error.message : String(error)
          }));
        }
        return;
      }
    }

    // Test endpoint for debugging
    if (req.method === 'GET' && req.url === '/ping') {
      logger.info('[HTTP] Ping endpoint called');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        activeSessions: Array.from(activeTransports.keys()),
        sessionCount: activeTransports.size
      }));
      return;
    }
    
    // Debug endpoint to log raw POST body
    if (req.method === 'POST' && req.url === '/debug') {
      logger.info('[HTTP] Debug endpoint called');
      const bodyChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        bodyChunks.push(chunk);
      });
      
      await new Promise<void>((resolve) => {
        req.on('end', () => {
          const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString('utf-8') : '';
          logger.info(`[DEBUG] Raw request body (${body.length} bytes): ${body}`);
          try {
            const parsed = JSON.parse(body);
            logger.info(`[DEBUG] Parsed JSON: ${JSON.stringify(parsed, null, 2)}`);
          } catch (e) {
            logger.warn(`[DEBUG] Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
          }
          resolve();
        });
        if (req.readableEnded) {
          resolve();
        }
      });
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'logged',
        bodyLength: bodyChunks.length > 0 ? Buffer.concat(bodyChunks).length : 0
      }));
      return;
    }
    
    // Default response
    logger.warn(`[HTTP] Unhandled request: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found', availableEndpoints: ['/message', '/ping'] }));
    }
  } catch (error) {
    logger.error('[HTTP] Server error:', error instanceof Error ? error.message : String(error));
    logger.error('[HTTP] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}

