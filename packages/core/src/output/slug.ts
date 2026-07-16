/**
 * Slug generation for file names and sidebar links of the output modules.
 * Deterministic: same input ⇒ same output (NFR2).
 */

/**
 * Converts a node/segment id into a slug usable in URLs and file names.
 * Leading underscores are stripped so that e.g. "_misc" becomes "misc"
 * (Starlight treats leading underscores as hidden pages).
 */
export function toSlug(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/^_+/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'page' : slug;
}
