/**
 * Unit tests for search functionality
 */

import { describe, it, expect } from 'vitest';
import { SearchAPI, cqlQuote } from '../../src/gallica/search.js';
import { HttpClient, GallicaError } from '../../src/gallica/client.js';
import { fakeRequest, FakeReply } from './helpers.js';

const SRU_RESPONSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<srw:searchRetrieveResponse xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>156</srw:numberOfRecords>
  <srw:records>
    <srw:record>
      <srw:recordData>
        <oai_dc:dc>
          <dc:title>1984</dc:title>
          <dc:creator>Hugo, Victor (1802-1885)</dc:creator>
          <dc:date>0012</dc:date>
          <dc:type xml:lang="fre">monographie imprimée</dc:type>
          <dc:type xml:lang="eng">printed monograph</dc:type>
          <dc:identifier>https://gallica.bnf.fr/ark:/12148/bpt6k6566991v</dc:identifier>
        </oai_dc:dc>
      </srw:recordData>
    </srw:record>
  </srw:records>
</srw:searchRetrieveResponse>`;

const SRU_DIAGNOSTIC = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:diag="http://www.loc.gov/zing/srw/diagnostic/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>0</srw:numberOfRecords>
  <srw:diagnostics>
    <diag:diagnostic>
      <diag:uri>info:srw/diagnostic/1/16</diag:uri>
      <diag:message>Unsupported index</diag:message>
      <diag:details>dc.foo</diag:details>
    </diag:diagnostic>
  </srw:diagnostics>
</srw:searchRetrieveResponse>`;

function searchApi(replies: FakeReply[]) {
  const requestFn = fakeRequest(replies);
  const http = new HttpClient('https://gallica.bnf.fr', { requestFn, minRequestInterval: 0, cacheTtl: 0 });
  return { api: new SearchAPI(http, 'https://gallica.bnf.fr/SRU'), requestFn };
}

function sentQuery(requestFn: { calls: string[] }): string | null {
  return new URL(requestFn.calls[0]!).searchParams.get('query');
}

describe('cqlQuote', () => {
  it('quotes values and drops embedded double quotes', () => {
    expect(cqlQuote('Les Misérables')).toBe('"Les Misérables"');
    expect(cqlQuote('Le "petit" prince')).toBe('"Le petit prince"');
  });
});

describe('SearchAPI', () => {
  describe('CQL query construction', () => {
    it('quotes non-exact title searches so words like "and" are not operators', async () => {
      const { api, requestFn } = searchApi([{ status: 200, body: SRU_RESPONSE }]);
      await api.searchByTitle('Pride and Prejudice');
      expect(sentQuery(requestFn)).toBe('dc.title all "Pride and Prejudice"');
    });

    it('uses adj for exact matches', async () => {
      const { api, requestFn } = searchApi([{ status: 200, body: SRU_RESPONSE }]);
      await api.searchByAuthor('Victor Hugo', true);
      expect(sentQuery(requestFn)).toBe('dc.creator adj "Victor Hugo"');
    });

    it('caps maximumRecords at 50', async () => {
      const { api, requestFn } = searchApi([{ status: 200, body: SRU_RESPONSE }]);
      await api.naturalLanguageSearch('paris', 500, 3);
      const url = new URL(requestFn.calls[0]!);
      expect(url.searchParams.get('maximumRecords')).toBe('50');
      expect(url.searchParams.get('startRecord')).toBe('3');
      expect(url.searchParams.get('query')).toBe('gallica all "paris"');
    });
  });

  describe('response parsing', () => {
    it('extracts Dublin Core fields as strings and the Gallica URL', async () => {
      const { api } = searchApi([{ status: 200, body: SRU_RESPONSE }]);
      const result = await api.searchByTitle('x');
      expect(result.metadata.total_records).toBe('156');
      expect(result.records).toHaveLength(1);
      const record = result.records[0]!;
      expect(record.title).toBe('1984');
      expect(record.date).toBe('0012');
      expect(record.type).toEqual(['monographie imprimée', 'printed monograph']);
      expect(record.gallica_url).toBe('https://gallica.bnf.fr/ark:/12148/bpt6k6566991v');
    });

    it('reports SRU diagnostics as errors', async () => {
      const { api } = searchApi([{ status: 200, body: SRU_DIAGNOSTIC }]);
      await expect(api.advancedSearch('dc.foo all bar')).rejects.toThrow(/Unsupported index: dc\.foo/);
    });

    it('explains Gallica 500s as malformed queries rather than outages', async () => {
      const { api, requestFn } = searchApi([{ status: 500, body: '<html>500</html>' }]);
      const error = await api.advancedSearch('dc.foo all bar').catch((e) => e);
      expect(error).toBeInstanceOf(GallicaError);
      expect(error.kind).toBe('bad_request');
      expect(error.message).toMatch(/malformed/);
      expect(error.message).toContain('dc.foo all bar');
      expect(requestFn.calls).toHaveLength(1);
    });

    it('does not blame the query when Gallica blocks the server', async () => {
      const { api } = searchApi([{ status: 403, body: 'Access Denied' }]);
      const error = await api.searchByTitle('x').catch((e) => e);
      expect(error.kind).toBe('blocked');
      expect(error.message).not.toMatch(/malformed/);
    });
  });
});
