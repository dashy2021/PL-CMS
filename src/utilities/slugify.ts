/**
 * Payload's default slugify keeps only ASCII word characters, which would empty Arabic slugs
 * and mangle any WordPress slug the import keeps as-is. This version keeps letters and digits
 * in any script, so the /blogs/<slug>/ URLs can match WordPress exactly.
 */
export const slugify = ({ valueToSlugify }: { valueToSlugify?: unknown }): string | undefined => {
  if (typeof valueToSlugify !== 'string') return undefined
  return valueToSlugify
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '')
    .toLowerCase()
}
