/**
 * Text/OCR utilities for Gallica
 * Handles ALTO XML parsing and plain text extraction
 */

import { XMLParser } from 'fast-xml-parser';
import { GallicaError, HttpClient } from './client.js';
import { normalizeArk } from './ark.js';
import { logger } from '../logging.js';

type OrderedNode = Record<string, unknown> & { ':@'?: Record<string, string> };

/**
 * Text client for retrieving OCR and text content
 */
export class TextClient {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient, baseUrl: string) {
    this.httpClient = httpClient;
    this.baseUrl = baseUrl;
  }

  /**
   * Get page text. Both "plain" and "alto" return text extracted from the page's ALTO OCR:
   * Gallica's .texteBrut endpoint now redirects automated clients to an anti-bot challenge.
   * Returns null when the page has no OCR; throws GallicaError when Gallica cannot be reached.
   */
  async getPageText(
    ark: string,
    page: number,
    format: 'plain' | 'alto' | 'tei' = 'plain'
  ): Promise<string | null> {
    if (format === 'tei') {
      // TEI is not exposed per page by Gallica
      return null;
    }
    return this.getAltoText(normalizeArk(ark), page);
  }

  /**
   * Get ALTO XML and extract text
   */
  private async getAltoText(arkId: string, page: number): Promise<string | null> {
    const url = `${this.baseUrl}/RequestDigitalElement`;
    const params = {
      O: `ark:/12148/${arkId}`,
      E: 'ALTO',
      Deb: String(page),
    };

    let xmlBody: string;
    try {
      xmlBody = await this.httpClient.getXml(url, params);
    } catch (error) {
      // Gallica answers with an error status when a document or page has no OCR
      if (
        error instanceof GallicaError &&
        (error.kind === 'server_error' || error.kind === 'not_found' || error.kind === 'bad_request')
      ) {
        logger.debug(`No ALTO for ${arkId}, page ${page}: ${error.message}`);
        return null;
      }
      throw error;
    }

    const text = parseAltoXml(xmlBody);
    return text.length > 0 ? text : null;
  }
}

function tagName(node: OrderedNode): string | undefined {
  return Object.keys(node).find((key) => key !== ':@');
}

function children(node: OrderedNode, tag: string): OrderedNode[] {
  const value = node[tag];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function lineText(line: OrderedNode, lineTag: string): string {
  const words: string[] = [];
  for (const child of children(line, lineTag)) {
    const tag = tagName(child);
    if (tag?.replace(/^.*:/, '') !== 'String') continue;
    const attrs = child[':@'] ?? {};
    // Hyphenated words: first half carries the whole word in SUBS_CONTENT
    if (attrs['@_SUBS_TYPE'] === 'HypPart2') continue;
    const content = attrs['@_SUBS_TYPE'] === 'HypPart1' && attrs['@_SUBS_CONTENT']
      ? attrs['@_SUBS_CONTENT']
      : attrs['@_CONTENT'];
    if (content && content.trim()) words.push(content.trim());
  }
  return words.join(' ');
}

/**
 * Extract text from ALTO XML in reading order, one OCR line per output line and a
 * blank line between text blocks. Text blocks nested in ComposedBlocks are included.
 */
export function parseAltoXml(xmlBody: string): string {
  let tree: OrderedNode[];
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      parseAttributeValue: false,
      parseTagValue: false,
    });
    tree = parser.parse(xmlBody) as OrderedNode[];
  } catch (error) {
    logger.warn(`Error parsing ALTO XML: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }

  const lines: string[] = [];
  const walk = (nodes: OrderedNode[]) => {
    for (const node of nodes) {
      const tag = tagName(node);
      if (!tag) continue;
      const local = tag.replace(/^.*:/, '');
      if (local === 'TextLine') {
        const text = lineText(node, tag);
        if (text) lines.push(text);
      } else {
        walk(children(node, tag));
        if (local === 'TextBlock' && lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('');
        }
      }
    }
  };
  walk(Array.isArray(tree) ? tree : []);

  return lines.join('\n').trim();
}
