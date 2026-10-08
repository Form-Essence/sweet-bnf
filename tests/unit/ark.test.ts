/**
 * Unit tests for ARK normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeArk } from '../../src/gallica/ark.js';

describe('normalizeArk', () => {
  it.each([
    ['bpt6k6566991v', 'bpt6k6566991v'],
    ['ark:/12148/bpt6k6566991v', 'bpt6k6566991v'],
    ['/ark:/12148/bpt6k6566991v', 'bpt6k6566991v'],
    ['https://gallica.bnf.fr/ark:/12148/bpt6k6566991v', 'bpt6k6566991v'],
    ['https://gallica.bnf.fr/ark:/12148/bpt6k6566991v/f11.item', 'bpt6k6566991v'],
    ['https://gallica.bnf.fr/ark:/12148/bpt6k6566991v.texteBrut', 'bpt6k6566991v'],
    ['https://gallica.bnf.fr/ark:/12148/btv1b8438570r/thumbnail', 'btv1b8438570r'],
    ['https://gallica.bnf.fr/ark:/12148/bpt6k6566991v?rk=21459;2', 'bpt6k6566991v'],
    ['ark%3A%2F12148%2Fbpt6k6566991v', 'bpt6k6566991v'],
    ['  bpt6k6566991v  ', 'bpt6k6566991v'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeArk(input)).toBe(expected);
  });

  it('rejects values that are not ARKs', () => {
    expect(() => normalizeArk('Les Misérables')).toThrow(/Invalid ARK/);
    expect(() => normalizeArk('')).toThrow(/Invalid ARK/);
  });
});
