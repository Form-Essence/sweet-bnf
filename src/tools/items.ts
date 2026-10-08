/**
 * MCP tools for item details, pages, images, and text
 * Extended features not in Python version
 */

import { z } from 'zod';
import { ItemsClient } from '../gallica/items.js';
import { IIIFClient } from '../gallica/iiif.js';
import { TextClient } from '../gallica/text.js';
import { intArg, textArg } from './schemas.js';

/**
 * Get item details tool
 */
export function createGetItemDetailsTool(itemsClient: ItemsClient) {
  return {
    name: 'get_item_details',
    description: 'Get full metadata for a Gallica item by its ARK identifier. Returns bibliographic data, available formats, and helpful URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier, e.g. "bpt6k123456", "ark:/12148/bpt6k123456" or a full Gallica URL from search results',
        },
      },
      required: ['ark'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({ ark: textArg() }).parse(args);
      return await itemsClient.getItemMetadata(parsed.ark);
    },
  };
}

/**
 * Get item pages tool
 */
export function createGetItemPagesTool(itemsClient: ItemsClient) {
  return {
    name: 'get_item_pages',
    description: 'Enumerate pages of a document. Returns logical page numbers, IIIF image URLs, and text availability flags.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Get specific page number',
        },
        page_size: {
          type: 'number',
          description: 'Get first N pages',
        },
        page_range: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Get pages in range [start, end]',
        },
      },
      required: ['ark'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: textArg(),
        page: intArg().positive().optional(),
        page_size: intArg().positive().optional(),
        page_range: z.tuple([intArg().positive(), intArg().positive()]).optional(),
      }).parse(args);

      const options: {
        page?: number;
        pageSize?: number;
        range?: [number, number];
      } = {};

      if (parsed.page !== undefined) {
        options.page = parsed.page;
      } else if (parsed.page_size !== undefined) {
        options.pageSize = parsed.page_size;
      } else if (parsed.page_range !== undefined) {
        options.range = parsed.page_range;
      }

      return await itemsClient.getItemPages(parsed.ark, options);
    },
  };
}

/**
 * Get page image tool
 */
export function createGetPageImageTool(iiifClient: IIIFClient) {
  return {
    name: 'get_page_image',
    description: 'Get IIIF image URL for a specific page. Returns URL and metadata, not binary data.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Page number',
        },
        size: {
          type: 'string',
          description: 'Image size (e.g., "full", "200,", "500,500", "pct:50")',
        },
        region: {
          type: 'string',
          description: 'Image region (e.g., "full", "x,y,w,h")',
        },
      },
      required: ['ark', 'page'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: textArg(),
        page: intArg().positive(),
        size: z.string().optional(),
        region: z.string().optional(),
      }).parse(args);

      const options: { size?: string; region?: string } = {};
      if (parsed.size) options.size = parsed.size;
      if (parsed.region) options.region = parsed.region;
      
      const url = iiifClient.getImageUrl(parsed.ark, parsed.page, options);

      return {
        ark: parsed.ark,
        page: parsed.page,
        iiif_url: url,
        thumbnail_url: iiifClient.getImageUrl(parsed.ark, parsed.page, { size: '200,' }),
      };
    },
  };
}

/**
 * Get page text tool
 */
export function createGetPageTextTool(textClient: TextClient) {
  return {
    name: 'get_page_text',
    description: 'Retrieve the OCR text of one page (from Gallica\'s ALTO OCR). Returns text: null when the page has no OCR. "plain" and "alto" both return plain text; "tei" is not supported by Gallica per page.',
    inputSchema: {
      type: 'object',
      properties: {
        ark: {
          type: 'string',
          description: 'ARK identifier',
        },
        page: {
          type: 'number',
          description: 'Page number',
        },
        format: {
          type: 'string',
          enum: ['plain', 'alto', 'tei'],
          description: 'Text format (default: plain). "alto" is accepted as an alias of "plain".',
        },
      },
      required: ['ark', 'page'],
    },
    handler: async (args: unknown) => {
      const parsed = z.object({
        ark: textArg(),
        page: intArg().positive(),
        format: z.enum(['plain', 'alto', 'tei']).optional(),
      }).parse(args);

      const text = await textClient.getPageText(parsed.ark, parsed.page, parsed.format || 'plain');

      return {
        ark: parsed.ark,
        page: parsed.page,
        format: parsed.format || 'plain',
        text: text,
        available: text !== null,
        ...(text === null
          ? {
              note: parsed.format === 'tei'
                ? 'TEI text is not available per page; use format "plain".'
                : 'Gallica has no OCR text for this page (it may be an image, or the document was not OCRed).',
            }
          : {}),
      };
    },
  };
}

