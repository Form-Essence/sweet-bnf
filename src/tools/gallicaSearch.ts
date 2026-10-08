/**
 * MCP tools for Gallica search - matches all 7 Python search tools
 */

import { z } from 'zod';
import { SearchAPI } from '../gallica/search.js';
import { config } from '../config.js';
import { boolArg, intArg, textArg } from './schemas.js';

/**
 * Zod schema for search parameters
 */
const searchParamsSchema = z.object({
  max_results: intArg().positive().max(50).optional(),
  start_record: intArg().positive().optional(),
});

const exactMatchSchema = searchParamsSchema.extend({
  exact_match: boolArg().optional(),
});

/**
 * Search by title tool
 */
export function createSearchByTitleTool(searchApi: SearchAPI) {
  return {
    name: 'search_by_title',
    description: 'Search for documents in the Gallica digital library by title.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title to search for',
        },
        exact_match: {
          type: 'boolean',
          description: 'If true, search for the exact title; otherwise, search for title containing the words',
          default: false,
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['title'],
    },
    handler: async (args: unknown) => {
      const parsed = exactMatchSchema.extend({ title: textArg() }).parse(args);
      return await searchApi.searchByTitle(
        parsed.title,
        parsed.exact_match ?? false,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Search by author tool
 */
export function createSearchByAuthorTool(searchApi: SearchAPI) {
  return {
    name: 'search_by_author',
    description: 'Search for documents in the Gallica digital library by author.',
    inputSchema: {
      type: 'object',
      properties: {
        author: {
          type: 'string',
          description: 'The author name to search for. Gallica stores names as "Surname, Forename" (e.g. "Hugo, Victor")',
        },
        exact_match: {
          type: 'boolean',
          description: 'If true, match the words as an exact phrase, so use the "Surname, Forename" order ("Hugo, Victor"); "Victor Hugo" with exact_match only finds names written in that order. Otherwise, match all words in any order',
          default: false,
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['author'],
    },
    handler: async (args: unknown) => {
      const parsed = exactMatchSchema.extend({ author: textArg() }).parse(args);
      return await searchApi.searchByAuthor(
        parsed.author,
        parsed.exact_match ?? false,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Search by subject tool
 */
export function createSearchBySubjectTool(searchApi: SearchAPI) {
  return {
    name: 'search_by_subject',
    description: 'Search for documents in the Gallica digital library by subject.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'The subject to search for',
        },
        exact_match: {
          type: 'boolean',
          description: 'If true, search for the exact subject; otherwise, search for subject containing the words',
          default: false,
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['subject'],
    },
    handler: async (args: unknown) => {
      const parsed = exactMatchSchema.extend({ subject: textArg() }).parse(args);
      return await searchApi.searchBySubject(
        parsed.subject,
        parsed.exact_match ?? false,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Search by date tool
 */
export function createSearchByDateTool(searchApi: SearchAPI) {
  return {
    name: 'search_by_date',
    description: 'Search for documents in the Gallica digital library by date. Accepts YYYY, YYYY-MM, or YYYY-MM-DD format.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The date to search for (format: YYYY or YYYY-MM or YYYY-MM-DD)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['date'],
    },
    handler: async (args: unknown) => {
      const parsed = searchParamsSchema.extend({ date: textArg() }).parse(args);
      return await searchApi.searchByDate(
        parsed.date,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Search by document type tool
 */
export function createSearchByDocumentTypeTool(searchApi: SearchAPI) {
  return {
    name: 'search_by_document_type',
    description: 'Search for documents in the Gallica digital library by document type (e.g., monographie, periodique, image, manuscrit, carte, musique, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        doc_type: {
          type: 'string',
          description: 'The document type to search for',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['doc_type'],
    },
    handler: async (args: unknown) => {
      const parsed = searchParamsSchema.extend({ doc_type: textArg() }).parse(args);
      return await searchApi.searchByDocumentType(
        parsed.doc_type,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Advanced search tool
 */
export function createAdvancedSearchTool(searchApi: SearchAPI) {
  return {
    name: 'advanced_search',
    description: 'Perform an advanced search using custom CQL query syntax. Examples: dc.creator all "Victor Hugo" and dc.type all "monographie", dc.subject all "Paris" and dc.type all "carte", dc.language all "eng".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Custom CQL query string',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = searchParamsSchema.extend({ query: textArg() }).parse(args);
      return await searchApi.advancedSearch(
        parsed.query,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

/**
 * Natural language search tool
 */
export function createNaturalLanguageSearchTool(searchApi: SearchAPI) {
  return {
    name: 'natural_language_search',
    description: 'Search the Gallica digital library using natural language. This is a simplified search that uses the "gallica all" operator to search across all fields.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1-50)',
          default: config.defaultMaxRecords,
        },
        start_record: {
          type: 'number',
          description: 'Starting record for pagination',
          default: config.defaultStartRecord,
        },
      },
      required: ['query'],
    },
    handler: async (args: unknown) => {
      const parsed = searchParamsSchema.extend({ query: textArg() }).parse(args);
      return await searchApi.naturalLanguageSearch(
        parsed.query,
        parsed.max_results ?? config.defaultMaxRecords,
        parsed.start_record ?? config.defaultStartRecord
      );
    },
  };
}

