/**
 * Search utilities for the Gallica BnF API
 * Matches Python SearchAPI class functionality
 */

import { XMLParser } from 'fast-xml-parser';
import { GallicaError, HttpClient } from './client.js';
import { SearchResult } from './types.js';
import { config } from '../config.js';
import { logger } from '../logging.js';

/**
 * Quote a user-supplied value for CQL. Double quotes inside the value would end the
 * term early and make Gallica reject the whole query, so they are dropped.
 */
export function cqlQuote(value: string): string {
  return `"${value.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * Search API matching Python SearchAPI class
 */
export class SearchAPI {
  private httpClient: HttpClient;
  private sruUrl: string;

  constructor(httpClient: HttpClient, sruUrl: string) {
    this.httpClient = httpClient;
    this.sruUrl = sruUrl;
  }

  /**
   * Core search method - matches Python GallicaAPI.search
   */
  private async search(
    query: string,
    startRecord: number = config.defaultStartRecord,
    maxRecords: number = config.defaultMaxRecords
  ): Promise<SearchResult> {
    logger.info(`[SEARCH] Executing search query: "${query}" (startRecord: ${startRecord}, maxRecords: ${maxRecords})`);
    const params = {
      version: '1.2',
      operation: 'searchRetrieve',
      query,
      startRecord: String(startRecord),
      maximumRecords: String(Math.min(maxRecords, 50)), // Cap at 50 like Python
    };

    logger.debug(`[SEARCH] Calling Gallica SRU API with params:`, params);
    let xmlBody: string;
    try {
      xmlBody = await this.httpClient.getXml(this.sruUrl, params);
    } catch (error) {
      if (error instanceof GallicaError && (error.kind === 'server_error' || error.kind === 'bad_request')) {
        // Gallica answers HTTP 500 for malformed CQL, so explain that instead of reporting an outage
        throw new GallicaError(
          'bad_request',
          `Gallica rejected the search query (HTTP ${error.statusCode}). This almost always means the CQL ` +
            `query is malformed, not that Gallica is down. Query sent: ${query} — use indexes such as ` +
            'dc.title, dc.creator, dc.subject, dc.date, dc.type, dc.language or gallica, the relations ' +
            'all / any / adj, put multi-word values in double quotes, and combine clauses with and / or / not.',
          error.url,
          error.statusCode
        );
      }
      throw error;
    }
    logger.debug(`[SEARCH] Received XML response, length: ${xmlBody.length} bytes`);
    const result = this.parseSruResponse(xmlBody, query);
    logger.info(`[SEARCH] Search completed: ${result.records.length} records returned out of ${result.metadata.total_records} total`);
    return result;
  }

  /**
   * Parse SRU XML response - matches Python parsing logic
   */
  parseSruResponse(xmlBody: string, query: string): SearchResult {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      // Keep titles such as "1984" and dates such as "0012" as written
      parseTagValue: false,
      parseAttributeValue: false,
    });

    let result;
    try {
      result = parser.parse(xmlBody);
    } catch (error) {
      throw new GallicaError(
        'server_error',
        `Gallica returned a search response that is not valid XML: ${error instanceof Error ? error.message : String(error)}`,
        this.sruUrl
      );
    }

    // Navigate through SRU response structure
    const sruResponse = result['srw:searchRetrieveResponse'] || result.searchRetrieveResponse;
    if (!sruResponse) {
      throw new GallicaError('server_error', 'Gallica returned an unexpected search response (no SRU envelope).', this.sruUrl);
    }

    const diagnostics = sruResponse['srw:diagnostics'] || sruResponse.diagnostics;
    if (diagnostics) {
      const list = diagnostics['diag:diagnostic'] || diagnostics['srw:diagnostic'] || diagnostics.diagnostic;
      const messages = (Array.isArray(list) ? list : [list])
        .filter(Boolean)
        .map((d: Record<string, unknown>) =>
          [d['diag:message'] ?? d['srw:message'] ?? d.message, d['diag:details'] ?? d['srw:details'] ?? d.details]
            .filter((part) => part !== undefined && part !== '')
            .join(': ')
        )
        .filter((m: string) => m.length > 0);
      throw new GallicaError(
        'bad_request',
        `Gallica could not run the search query ${query}: ${messages.join('; ') || 'unspecified SRU diagnostic'}`,
        this.sruUrl
      );
    }

    const numberOfRecords = sruResponse['srw:numberOfRecords']?.['#text'] || 
                            sruResponse.numberOfRecords?.['#text'] ||
                            sruResponse['srw:numberOfRecords'] ||
                            sruResponse.numberOfRecords ||
                            '0';

    const records = sruResponse['srw:records']?.['srw:record'] || 
                   sruResponse.records?.record ||
                   [];

    const recordsArray = Array.isArray(records) ? records : records ? [records] : [];

    const parsedRecords: Array<Record<string, string | string[] | undefined>> = [];

    for (const record of recordsArray) {
      const recordData = record['srw:recordData']?.['oai_dc:dc'] ||
                        record.recordData?.['oai_dc:dc'] ||
                        record['srw:recordData'] ||
                        record.recordData;

      if (!recordData) continue;

      const recordDict: Record<string, string | string[] | undefined> = {};

      // Extract Dublin Core fields
      const dcFields = [
        'title', 'creator', 'contributor', 'publisher', 'date',
        'description', 'type', 'format', 'identifier', 'source',
        'language', 'relation', 'coverage', 'rights', 'subject',
      ];

      for (const field of dcFields) {
        const elements = recordData[`dc:${field}`] || recordData[field];
        if (elements) {
          const values = Array.isArray(elements) ? elements : [elements];
          const textValues = values
            .map((v: unknown) => {
              if (typeof v === 'string') return v.trim();
              if (v && typeof v === 'object' && '#text' in v) return String(v['#text']).trim();
              return String(v).trim();
            })
            .filter((v: string) => v.length > 0);

          if (textValues.length > 0) {
            const value: string | string[] = textValues.length === 1 ? textValues[0]! : textValues;
            recordDict[field] = value;
          }
        }
      }

      // Extract Gallica URL from identifiers
      const identifiers = recordDict.identifier;
      if (identifiers) {
        const idArray = Array.isArray(identifiers) ? identifiers : [identifiers];
        for (const identifier of idArray) {
          if (typeof identifier === 'string' && identifier.includes('gallica.bnf.fr/ark:')) {
            recordDict.gallica_url = identifier;
            break;
          }
        }
      }

      parsedRecords.push(recordDict);
    }

    return {
      metadata: {
        query,
        total_records: String(numberOfRecords),
        records_returned: parsedRecords.length,
        date_retrieved: new Date().toISOString().replace('T', ' ').substring(0, 19),
      },
      records: parsedRecords,
    };
  }

  /**
   * Search by title - matches Python search_by_title
   */
  searchByTitle(
    title: string,
    exactMatch: boolean = false,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    // adj matches the words as a phrase; all matches them in any order
    const query = `dc.title ${exactMatch ? 'adj' : 'all'} ${cqlQuote(title)}`;
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Search by author - matches Python search_by_author
   */
  searchByAuthor(
    author: string,
    exactMatch: boolean = false,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    // adj matches the words as a phrase; all matches them in any order
    const query = `dc.creator ${exactMatch ? 'adj' : 'all'} ${cqlQuote(author)}`;
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Search by subject - matches Python search_by_subject
   */
  searchBySubject(
    subject: string,
    exactMatch: boolean = false,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    // adj matches the words as a phrase; all matches them in any order
    const query = `dc.subject ${exactMatch ? 'adj' : 'all'} ${cqlQuote(subject)}`;
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Search by date - matches Python search_by_date
   * Accepts YYYY, YYYY-MM, or YYYY-MM-DD format
   */
  searchByDate(
    date: string,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    const query = `dc.date all ${cqlQuote(date)}`;
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Search by document type - matches Python search_by_document_type
   */
  searchByDocumentType(
    docType: string,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    const query = `dc.type all ${cqlQuote(docType)}`;
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Advanced search with custom CQL - matches Python advanced_search
   */
  advancedSearch(
    query: string,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    return this.search(query, startRecord, maxResults);
  }

  /**
   * Natural language search - matches Python natural_language_search
   */
  naturalLanguageSearch(
    query: string,
    maxResults: number = config.defaultMaxRecords,
    startRecord: number = config.defaultStartRecord
  ): Promise<SearchResult> {
    const formattedQuery = `gallica all ${cqlQuote(query)}`;
    return this.search(formattedQuery, startRecord, maxResults);
  }
}

