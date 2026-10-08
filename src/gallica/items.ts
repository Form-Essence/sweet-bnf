/**
 * Item metadata and page enumeration utilities
 * Extended features not in Python version
 */

import { ItemMetadata, PageInfo } from './types.js';
import { HttpClient } from './client.js';
import { IIIFClient } from './iiif.js';
import { normalizeArk } from './ark.js';

/**
 * IIIF metadata values are strings, {"@value": ...} objects, or arrays of either
 */
function metadataValueToString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(metadataValueToString).filter((v) => v.length > 0).join('; ');
  }
  if (value && typeof value === 'object' && '@value' in value) {
    return String((value as { '@value': unknown })['@value']);
  }
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Items client for metadata and page access
 */
export class ItemsClient {
  private iiifClient: IIIFClient;
  private baseUrl: string;

  constructor(_httpClient: HttpClient, iiifClient: IIIFClient, baseUrl: string) {
    this.iiifClient = iiifClient;
    this.baseUrl = baseUrl;
  }

  /**
   * Get full item metadata
   */
  async getItemMetadata(ark: string): Promise<ItemMetadata> {
    const arkId = normalizeArk(ark);
    const manifest = await this.iiifClient.parseManifest(arkId);
    const metadata = (manifest.metadata as Record<string, unknown>) || {};

    const itemMetadata: ItemMetadata = {
      ark: `ark:/12148/${arkId}`,
      gallica_url: `${this.baseUrl}/ark:/12148/${arkId}`,
      manifest_url: this.iiifClient.getManifestUrl(arkId),
      available_formats: ['iiif', 'image'],
      page_count: manifest.pages.length,
      ...this.extractMetadataFromManifest(metadata),
    };

    // Check if text is available
    if (manifest.pages.length > 0 && manifest.pages[0]?.has_text) {
      itemMetadata.available_formats.push('text', 'alto');
    }

    return itemMetadata;
  }

  /**
   * Extract metadata from IIIF manifest metadata array
   */
  private extractMetadataFromManifest(metadata: Record<string, unknown>): Partial<ItemMetadata> {
    const result: Partial<ItemMetadata> = {};

    if (Array.isArray(metadata)) {
      for (const item of metadata) {
        if (item && typeof item === 'object' && 'label' in item && 'value' in item) {
          const label = String(item.label || '');
          const value = metadataValueToString(item.value);
          
          if (label.toLowerCase().includes('title')) {
            result.title = value;
          } else if (label.toLowerCase().includes('creator') || label.toLowerCase().includes('author')) {
            result.creator = value;
          } else if (label.toLowerCase().includes('date')) {
            result.date = value;
          } else if (label.toLowerCase().includes('publisher')) {
            result.publisher = value;
          } else if (label.toLowerCase().includes('description')) {
            result.description = value;
          } else if (label.toLowerCase().includes('type')) {
            result.type = value;
          } else if (label.toLowerCase().includes('language')) {
            result.language = value;
          }
        }
      }
    }

    return result;
  }

  /**
   * Get item pages with options
   */
  async getItemPages(
    ark: string,
    options?: {
      page?: number;
      pageSize?: number;
      range?: [number, number];
    }
  ): Promise<PageInfo[]> {
    const manifest = await this.iiifClient.parseManifest(ark);
    let pages = manifest.pages;

    // Apply filters
    if (options?.range) {
      const [start, end] = options.range;
      pages = pages.filter((p) => p.page >= start && p.page <= end);
    } else if (options?.page !== undefined) {
      // Get single page
      const page = pages.find((p) => p.page === options.page);
      return page ? [page] : [];
    } else if (options?.pageSize !== undefined) {
      // Get first N pages
      pages = pages.slice(0, options.pageSize);
    }

    return pages;
  }
}

