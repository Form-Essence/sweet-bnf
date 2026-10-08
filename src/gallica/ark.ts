/**
 * ARK identifier normalization
 */

/**
 * Reduce any form of Gallica ARK reference to the bare identifier.
 *
 * Accepts "bpt6k6566991v", "ark:/12148/bpt6k6566991v",
 * "https://gallica.bnf.fr/ark:/12148/bpt6k6566991v/f11.item" and similar.
 * Search results return full URLs, so tools must accept those too.
 */
export function normalizeArk(input: string): string {
  let value = input.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw value if it is not valid percent-encoding
  }
  value = value.replace(/[?#].*$/, '');

  const match = value.match(/ark:\/?12148\/([^/?#]+)/i);
  const id = match ? match[1]! : value.replace(/^\/+/, '').split('/')[0]!;

  // Strip Gallica view/format suffixes such as ".item", ".texteBrut", ".thumbnail"
  const bare = id.replace(/\.[A-Za-z]+$/, '');
  if (!/^[A-Za-z0-9]+$/.test(bare)) {
    throw new Error(
      `Invalid ARK identifier: "${input}". Expected something like "bpt6k6566991v", ` +
        `"ark:/12148/bpt6k6566991v" or "https://gallica.bnf.fr/ark:/12148/bpt6k6566991v".`
    );
  }
  return bare;
}
