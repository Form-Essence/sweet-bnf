/**
 * Unit tests for ALTO text extraction
 */

import { describe, it, expect } from 'vitest';
import { parseAltoXml } from '../../src/gallica/text.js';

const ALTO = `<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>
<alto xmlns="http://bibnum.bnf.fr/ns/alto_prod">
  <Layout><Page><PrintSpace>
    <TextBlock ID="TB1">
      <TextLine><String CONTENT="LES"/><SP/><String CONTENT="MISÉRABLES"/></TextLine>
    </TextBlock>
    <ComposedBlock ID="CB1">
      <TextBlock ID="TB2">
        <TextLine><String CONTENT="Fantine"/><SP/><String CONTENT="&amp;"/><SP/><String CONTENT="Cosette"/></TextLine>
      </TextBlock>
    </ComposedBlock>
    <TextBlock ID="TB3">
      <TextLine><String CONTENT="un"/><SP/><String SUBS_TYPE="HypPart1" SUBS_CONTENT="exemple" CONTENT="exem"/><HYP CONTENT="-"/></TextLine>
      <TextLine><String SUBS_TYPE="HypPart2" SUBS_CONTENT="exemple" CONTENT="ple"/><SP/><String CONTENT="final"/></TextLine>
    </TextBlock>
  </PrintSpace></Page></Layout>
</alto>`;

describe('parseAltoXml', () => {
  it('extracts lines in reading order, including ComposedBlocks', () => {
    expect(parseAltoXml(ALTO)).toBe('LES MISÉRABLES\n\nFantine & Cosette\n\nun exemple\nfinal');
  });

  it('returns an empty string for documents without text', () => {
    expect(parseAltoXml('<alto><Layout><Page><PrintSpace/></Page></Layout></alto>')).toBe('');
  });
});
