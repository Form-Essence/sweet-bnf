/**
 * Sequential Reporting Server - matches Python SequentialReportingServer
 * Generates structured reports using a stateful multi-step process
 */

import { GallicaAPI } from './api.js';
import { SearchAPI } from './search.js';
import { SequentialReportState, Source, Graphic, ReportSection, ReportPlan } from './types.js';
import { logger } from '../logging.js';

const DEFAULT_PAGE_COUNT = 4;
const DEFAULT_SOURCE_COUNT = 10;

/**
 * Sequential Reporting Server matching Python implementation
 */
export class SequentialReportingServer {
  private searchApi: SearchAPI;
  private state: SequentialReportState;

  constructor(_gallicaApi: GallicaAPI, searchApi: SearchAPI) {
    this.searchApi = searchApi;
    this.state = {
      topic: null,
      page_count: DEFAULT_PAGE_COUNT,
      source_count: DEFAULT_SOURCE_COUNT,
      sources: [],
      report_sections: [],
      plan: null,
      current_step: 0,
      include_graphics: false,
      graphics: [],
    };
  }

  /**
   * Validate section data - matches Python validate_section_data
   */
  private validateSectionData(inputData: Record<string, unknown>): Record<string, unknown> {
    const validated: Record<string, unknown> = {};

    // Handle initialization with topic
    if ('topic' in inputData) {
      validated.topic = String(inputData.topic);
      if ('page_count' in inputData) {
        try {
          validated.page_count = parseInt(String(inputData.page_count), 10) || DEFAULT_PAGE_COUNT;
        } catch {
          validated.page_count = DEFAULT_PAGE_COUNT;
        }
      }
      if ('source_count' in inputData) {
        try {
          validated.source_count = parseInt(String(inputData.source_count), 10) || DEFAULT_SOURCE_COUNT;
        } catch {
          validated.source_count = DEFAULT_SOURCE_COUNT;
        }
      }
      if ('include_graphics' in inputData) {
        validated.include_graphics = Boolean(inputData.include_graphics);
      }
      return validated;
    }

    // Handle search_sources flag
    if ('search_sources' in inputData && inputData.search_sources) {
      validated.search_sources = true;
      return validated;
    }

    // Validate required fields for section data
    if (!('section_number' in inputData) || !('total_sections' in inputData)) {
      throw new Error('Missing required field: section_number or total_sections');
    }

    let sectionNumber = inputData.section_number;
    if (typeof sectionNumber === 'string' && /^\d+$/.test(sectionNumber)) {
      sectionNumber = parseInt(sectionNumber, 10);
    }
    if (typeof sectionNumber !== 'number') {
      throw new Error('Invalid section_number: must be a number');
    }

    let totalSections = inputData.total_sections;
    if (typeof totalSections === 'string' && /^\d+$/.test(totalSections)) {
      totalSections = parseInt(totalSections, 10);
    }
    if (typeof totalSections !== 'number') {
      throw new Error('Invalid total_sections: must be a number');
    }

    const title = inputData.title ? String(inputData.title) : `Section ${sectionNumber}`;
    let content = inputData.content;
    if (content === null || content === undefined) {
      content = '';
    }
    if (typeof content !== 'string') {
      throw new Error('Invalid content: must be a string');
    }

    const isBibliography = Boolean(inputData.is_bibliography);
    let sourcesUsed = inputData.sources_used;
    if (sourcesUsed === null || sourcesUsed === undefined) {
      sourcesUsed = [];
    }
    if (!Array.isArray(sourcesUsed)) {
      throw new Error('Invalid sources_used: must be an array');
    }

    const nextSectionNeeded = inputData.next_section_needed !== undefined 
      ? Boolean(inputData.next_section_needed) 
      : true;

    return {
      section_number: sectionNumber,
      total_sections: totalSections,
      title,
      content: String(content),
      is_bibliography: isBibliography,
      sources_used: sourcesUsed as number[],
      next_section_needed: nextSectionNeeded,
    };
  }

  /**
   * Search for sources - matches Python search_sources
   */
  async searchSources(topic: string, sourceCount: number = DEFAULT_SOURCE_COUNT): Promise<Source[]> {
    // Errors propagate so the caller reports why no sources were found
    // Try natural language search first
    const results = await this.searchApi.naturalLanguageSearch(topic, sourceCount);

    // If not enough results, try subject search
    let allRecords = results.records || [];
    if (allRecords.length < sourceCount) {
      const subjectResults = await this.searchApi.searchBySubject(
        topic,
        false,
        sourceCount - allRecords.length
      );
      allRecords = [...allRecords, ...(subjectResults.records || [])];
    }

    // Format the results
    const sources: Source[] = [];
    const recordsToProcess = allRecords.slice(0, sourceCount);

    for (let i = 0; i < recordsToProcess.length; i++) {
      const result = recordsToProcess[i];
      if (!result) continue;
      
      const source: Source = {
        id: i + 1,
        title: Array.isArray(result.title) ? (result.title[0] || 'Unknown Title') : (result.title || 'Unknown Title'),
        creator: Array.isArray(result.creator) ? (result.creator[0] || 'Unknown Author') : (result.creator || 'Unknown Author'),
        date: Array.isArray(result.date) ? (result.date[0] || 'Unknown Date') : (result.date || 'Unknown Date'),
        type: Array.isArray(result.type) ? (result.type[0] || 'Unknown Type') : (result.type || 'Unknown Type'),
        language: Array.isArray(result.language) ? (result.language[0] || 'Unknown Language') : (result.language || 'Unknown Language'),
        url: result.gallica_url || '',
        citation: this.formatCitation(result as Record<string, unknown>),
        thumbnail: '',
      };
      sources.push(source);
    }

    return sources;
  }

  /**
   * Search for graphics - matches Python search_graphics
   */
  async searchGraphics(topic: string, count: number = 5): Promise<Graphic[]> {
    try {
      const keywords = topic.split(' ');
      const mainKeyword = keywords[0] || topic;

      // Search for images
      let imageQuery = `gallica all "${mainKeyword}" and dc.type all "image"`;
      let imageResults = await this.searchApi.advancedSearch(imageQuery, count);

      if (!imageResults.records || imageResults.records.length === 0) {
        imageQuery = `gallica all "${topic}" and dc.type all "image"`;
        imageResults = await this.searchApi.advancedSearch(imageQuery, count);
      }

      // Search for maps
      let mapQuery = `gallica all "${mainKeyword}" and dc.type all "carte"`;
      let mapResults = await this.searchApi.advancedSearch(mapQuery, count);

      if (!mapResults.records || mapResults.records.length === 0) {
        mapQuery = `gallica all "${topic}" and dc.type all "carte"`;
        mapResults = await this.searchApi.advancedSearch(mapQuery, count);
      }

      // If still no results, try general visual material
      if ((!imageResults.records || imageResults.records.length === 0) &&
          (!mapResults.records || mapResults.records.length === 0)) {
        const generalQuery = `gallica all "${mainKeyword}" and (dc.type all "image" or dc.type all "carte" or dc.type all "estampe")`;
        imageResults = await this.searchApi.advancedSearch(generalQuery, count);
      }

      const graphics: Graphic[] = [];

      // Process image results
      if (imageResults.records) {
        for (let i = 0; i < imageResults.records.length; i++) {
          const result = imageResults.records[i];
          if (!result) continue;
          
          const url = result.gallica_url || '';
          const cleanUrl = url.replace('/thumbnail', '');
          const arkMatch = cleanUrl.match(/ark:([^\/]+)/);
          const arkId = arkMatch ? arkMatch[1] : '';
          const thumbnail = arkId ? `https://gallica.bnf.fr/ark:${arkId}/thumbnail` : '';
          const title = Array.isArray(result.title) ? (result.title[0] || 'Untitled Image') : (result.title || 'Untitled Image');

          graphics.push({
            id: graphics.length + 1,
            title,
            description: `Image related to ${topic}: ${title}`,
            type: 'image',
            url: cleanUrl,
            thumbnail,
          });
        }
      }

      // Process map results
      if (mapResults.records) {
        for (let i = 0; i < mapResults.records.length; i++) {
          const result = mapResults.records[i];
          if (!result) continue;
          
          const url = result.gallica_url || '';
          const cleanUrl = url.replace('/thumbnail', '');
          const arkMatch = cleanUrl.match(/ark:([^\/]+)/);
          const arkId = arkMatch ? arkMatch[1] : '';
          const thumbnail = arkId ? `https://gallica.bnf.fr/ark:${arkId}/thumbnail` : '';
          const title = Array.isArray(result.title) ? (result.title[0] || 'Untitled Map') : (result.title || 'Untitled Map');

          graphics.push({
            id: graphics.length + 1,
            title,
            description: `Map related to ${topic}: ${title}`,
            type: 'map',
            url: cleanUrl,
            thumbnail,
          });
        }
      }

      // If no graphics found, create placeholders
      if (graphics.length === 0) {
        graphics.push(
          {
            id: 1,
            title: `Illustration related to ${topic}`,
            description: `Illustration related to ${topic}`,
            type: 'image',
            url: 'https://gallica.bnf.fr/',
            thumbnail: 'https://gallica.bnf.fr/themes/gallica2015/images/logo-gallica.png',
          },
          {
            id: 2,
            title: `Map related to ${topic}`,
            description: `Map related to ${topic}`,
            type: 'map',
            url: 'https://gallica.bnf.fr/',
            thumbnail: 'https://gallica.bnf.fr/themes/gallica2015/images/logo-gallica.png',
          }
        );
      }

      return graphics.slice(0, count);
    } catch (error) {
      logger.error(`Error searching for graphics: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Format citation - matches Python _format_citation
   */
  private formatCitation(record: Record<string, unknown>): string {
    const creator = Array.isArray(record.creator) 
      ? record.creator[0] 
      : (record.creator as string | undefined) || 'Unknown Author';
    const title = Array.isArray(record.title) 
      ? record.title[0] 
      : (record.title as string | undefined) || 'Unknown Title';
    const publisher = Array.isArray(record.publisher) 
      ? record.publisher[0] 
      : (record.publisher as string | undefined) || 'Unknown Publisher';
    const date = Array.isArray(record.date) 
      ? record.date[0] 
      : (record.date as string | undefined) || 'n.d.';
    const url = (record.gallica_url as string | undefined) || 
                (Array.isArray(record.identifier) ? record.identifier[0] : (record.identifier as string | undefined)) || 
                'No URL available';

    let docType = Array.isArray(record.type) ? record.type[0] : (record.type as string | undefined) || '';
    docType = String(docType).toLowerCase();

    if (docType.includes('monographie') || docType.includes('book')) {
      return `${creator}. (${date}). ${title}. ${publisher}. Retrieved from ${url}`;
    } else if (docType.includes('periodique') || docType.includes('article')) {
      return `${creator}. (${date}). ${title}. Retrieved from ${url}`;
    } else {
      return `${creator}. (${date}). ${title}. ${publisher}. Retrieved from ${url}`;
    }
  }

  /**
   * Create plan - matches Python create_plan
   */
  private createPlan(topic: string, pageCount: number = DEFAULT_PAGE_COUNT): ReportPlan {
    const totalSections = Math.min(pageCount * 2 + 1, 20); // Cap at 20 sections

    const sections: Array<{ title: string; is_bibliography: boolean }> = [
      { title: 'Bibliography', is_bibliography: true },
      { title: 'Introduction', is_bibliography: false },
    ];

    if (pageCount >= 2) {
      sections.push({ title: 'Historical Context', is_bibliography: false });
    }

    if (pageCount >= 3) {
      sections.push({ title: 'Main Analysis', is_bibliography: false });
      sections.push({ title: 'Key Findings', is_bibliography: false });
    }

    if (pageCount >= 4) {
      sections.push({ title: 'Detailed Examination', is_bibliography: false });
      sections.push({ title: 'Critical Perspectives', is_bibliography: false });
    }

    // Add more sections for longer reports
    const remainingSections = totalSections - sections.length;
    for (let i = 0; i < remainingSections; i++) {
      sections.push({ title: `Additional Analysis ${i + 1}`, is_bibliography: false });
    }

    // Always end with conclusion
    sections.push({ title: 'Conclusion', is_bibliography: false });

    return {
      topic,
      total_sections: sections.length,
      sections,
      current_section: 0,
      steps: [
        'Initialize with topic',
        'Search for sources',
        'Create bibliography',
        'Write introduction',
        'Develop content sections',
        'Write conclusion',
      ],
      current_step: 0,
      next_step: 'Search for sources',
    };
  }

  /**
   * Process section - matches Python process_section
   */
  async processSection(inputData: unknown): Promise<{ content: Array<{ text: string }>; isError?: boolean }> {
    try {
      const data = this.validateSectionData(inputData as Record<string, unknown>);

      // Initialize with topic
      if ('topic' in data) {
        this.state.topic = data.topic as string;
        this.state.page_count = (data.page_count as number) || DEFAULT_PAGE_COUNT;
        this.state.source_count = (data.source_count as number) || DEFAULT_SOURCE_COUNT;
        this.state.include_graphics = Boolean(data.include_graphics);
        this.state.sources = [];
        this.state.graphics = [];
        this.state.report_sections = [];
        this.state.current_step = 0;

        // Create plan
        this.state.plan = this.createPlan(this.state.topic, this.state.page_count);

        return {
          content: [{
            text: JSON.stringify({
              topic: this.state.topic,
              pageCount: this.state.page_count,
              sourceCount: this.state.source_count,
              includeGraphics: this.state.include_graphics,
              plan: this.state.plan,
              nextStep: 'Search for sources using natural_language_search or search_by_subject',
            }),
          }],
        };
      }

      // Search for sources
      if (data.search_sources) {
        if (!this.state.topic) {
          return {
            content: [{ text: 'Error: No topic specified. Please initialize with a topic first.' }],
            isError: true,
          };
        }

        this.state.sources = await this.searchSources(this.state.topic, this.state.source_count);

        // If graphics are requested, search for them
        if (this.state.include_graphics) {
          this.state.graphics = await this.searchGraphics(this.state.topic, 5);
        }

        this.state.current_step = 1;

        return {
          content: [{
            text: JSON.stringify({
              sources: this.state.sources,
              graphics: this.state.include_graphics ? this.state.graphics : [],
              nextStep: 'Create bibliography section',
            }),
          }],
        };
      }

      // Process section data
      const validatedInput = this.validateSectionData(inputData as Record<string, unknown>);

      // Adjust total sections if needed
      if ((validatedInput.section_number as number) > (validatedInput.total_sections as number)) {
        validatedInput.total_sections = validatedInput.section_number;
      }

      // Add section to report
      this.state.report_sections.push(validatedInput as unknown as ReportSection);

      // Update current step in plan
      let nextStep = 'Continue writing the report';
      if (this.state.plan) {
        this.state.plan.current_section = validatedInput.section_number as number;
        const sectionIndex = (validatedInput.section_number as number) - 1;
        if (sectionIndex < this.state.plan.sections.length) {
          const nextSectionTitle = this.state.plan.sections[sectionIndex + 1]?.title || 'Next Section';
          nextStep = `Create section ${(validatedInput.section_number as number) + 1}: ${nextSectionTitle}`;
        } else {
          nextStep = 'Report complete';
        }
      }

      if (!validatedInput.next_section_needed) {
        nextStep = 'Report complete';
      }

      // Calculate progress
      const progress = (this.state.report_sections.length / (validatedInput.total_sections as number)) * 100;

      return {
        content: [{
          text: JSON.stringify({
            sectionNumber: validatedInput.section_number,
            totalSections: validatedInput.total_sections,
            nextSectionNeeded: validatedInput.next_section_needed,
            progress: `${progress.toFixed(1)}%`,
            reportSectionsCount: this.state.report_sections.length,
            nextStep: nextStep,
            sources: validatedInput.is_bibliography ? this.state.sources : undefined,
          }),
        }],
      };
    } catch (error) {
      logger.error(`Error processing report section: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [{
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed',
          }),
        }],
        isError: true,
      };
    }
  }
}

