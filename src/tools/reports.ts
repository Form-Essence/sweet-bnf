/**
 * Sequential reporting tool - matches Python sequential_reporting
 */

import { z } from 'zod';
import { SequentialReportingServer } from '../gallica/sequential_reporting.js';
import { boolArg, intArg } from './schemas.js';

/**
 * Sequential reporting tool matching Python implementation
 */
export function createSequentialReportingTool(reportingServer: SequentialReportingServer) {
  return {
    name: 'sequential_reporting',
    description: `Generate a research report in a sequential, step-by-step manner using Gallica BnF sources.

This tool follows a sequential approach to report generation:
1. Initialize with a topic
2. Search for sources
3. Create bibliography
4. Create content sections in order

Parameters:
- topic: Research topic (only needed for initialization)
- page_count: Number of pages for the report (default: 4)
- source_count: Number of sources to find (default: 10)
- search_sources: Set to true to search for sources after initialization
- section_number: Current section number (1-based)
- total_sections: Total number of sections in the report
- title: Title of the current section
- content: Content for the current section
- is_bibliography: Whether this section is the bibliography
- sources_used: List of source IDs used in this section
- next_section_needed: Whether another section is needed
- include_graphics: Whether to include images and maps in the report`,
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Research topic for the report (only needed for initialization)',
        },
        page_count: {
          type: 'number',
          description: 'Number of pages to generate',
          minimum: 1,
          default: 4,
        },
        source_count: {
          type: 'number',
          description: 'Number of sources to find',
          minimum: 1,
          default: 10,
        },
        search_sources: {
          type: 'boolean',
          description: 'Set to true to search for sources after initialization',
        },
        section_number: {
          type: 'number',
          description: 'Current section number',
          minimum: 1,
        },
        total_sections: {
          type: 'number',
          description: 'Total sections in the report',
          minimum: 1,
        },
        title: {
          type: 'string',
          description: 'Title of the current section',
        },
        content: {
          type: 'string',
          description: 'Content of the current section',
        },
        is_bibliography: {
          type: 'boolean',
          description: 'Whether this section is the bibliography',
        },
        sources_used: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of source IDs used in this section',
        },
        next_section_needed: {
          type: 'boolean',
          description: 'Whether another section is needed',
        },
        include_graphics: {
          type: 'boolean',
          description: 'Whether to include graphics in the report',
          default: false,
        },
      },
      required: ['section_number', 'total_sections', 'title', 'content', 'next_section_needed'],
    },
    handler: async (args: unknown) => {
      // Use a more flexible schema that allows partial validation
      const schema = z.object({
        topic: z.string().optional(),
        page_count: intArg().positive().optional(),
        source_count: intArg().positive().optional(),
        search_sources: boolArg().optional(),
        section_number: intArg().positive().optional(),
        total_sections: intArg().positive().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        is_bibliography: boolArg().optional(),
        sources_used: z.array(intArg()).optional(),
        next_section_needed: boolArg().optional(),
        include_graphics: boolArg().optional(),
      });

      const parsed = schema.parse(args);
      return await reportingServer.processSection(parsed);
    },
  };
}

