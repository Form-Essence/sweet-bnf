/**
 * Type definitions for Gallica API and MCP server
 */

/**
 * ARK identifier type - format: ark:/12148/{identifier}
 */
export type ARK = string;

/**
 * Search result record with Dublin Core metadata
 */
export interface SearchRecord {
  title?: string | string[];
  creator?: string | string[];
  contributor?: string | string[];
  publisher?: string | string[];
  date?: string | string[];
  description?: string | string[];
  type?: string | string[];
  format?: string | string[];
  identifier?: string | string[];
  source?: string | string[];
  language?: string | string[];
  relation?: string | string[];
  coverage?: string | string[];
  rights?: string | string[];
  subject?: string | string[];
  gallica_url?: string;
}

/**
 * Search result metadata
 */
export interface SearchMetadata {
  query: string;
  total_records: string;
  records_returned: number;
  date_retrieved: string;
}

/**
 * Search result matching Python format
 */
export interface SearchResult {
  metadata: SearchMetadata;
  records: SearchRecord[];
  error?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Source for sequential reporting
 */
export interface Source {
  id: number;
  title: string;
  creator: string;
  date: string;
  type: string;
  language: string;
  url: string;
  citation: string;
  thumbnail: string;
}


/**
 * Graphic (image/map) for sequential reporting
 */
export interface Graphic {
  id: number;
  title: string;
  description: string;
  type: 'image' | 'map';
  url: string;
  thumbnail: string;
}

/**
 * Report section
 */
export interface ReportSection {
  section_number: number;
  total_sections: number;
  title: string;
  content: string;
  is_bibliography: boolean;
  sources_used: number[];
  next_section_needed: boolean;
}

/**
 * Report plan
 */
export interface ReportPlan {
  topic: string;
  total_sections: number;
  sections: Array<{
    title: string;
    is_bibliography: boolean;
  }>;
  current_section: number;
  steps: string[];
  current_step: number;
  next_step: string;
}

/**
 * Sequential reporting state
 */
export interface SequentialReportState {
  topic: string | null;
  page_count: number;
  source_count: number;
  sources: Source[];
  report_sections: ReportSection[];
  plan: ReportPlan | null;
  current_step: number;
  include_graphics: boolean;
  graphics: Graphic[];
}

/**
 * Item metadata (extended feature)
 */
export interface ItemMetadata {
  ark: string;
  title?: string;
  creator?: string;
  date?: string;
  publisher?: string;
  description?: string;
  type?: string;
  language?: string;
  format?: string[];
  manifest_url?: string;
  page_count?: number;
  gallica_url: string;
  available_formats: string[];
}

/**
 * Page information (extended feature)
 */
export interface PageInfo {
  page: number;
  label?: string;
  iiif_image_url: string;
  has_text: boolean;
  thumbnail_url?: string;
}

/**
 * IIIF Image options
 */
export interface IIIFImageOptions {
  region?: string; // e.g., "full", "x,y,w,h"
  size?: string; // e.g., "full", "w,h", "pct:n"
  rotation?: number; // 0, 90, 180, 270
  quality?: string; // "default", "color", "gray", "bitonal", "native"
  format?: string; // "jpg", "png", "webp", etc.
}

