export function sanitizeImportedText(value: string) {
  const normalized = value.split('\r\n').join('\n').split('\r').join('\n')
  let sanitized = ''

  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0

    if ((codePoint >= 0x20 || character === '\n') && codePoint !== 0x7f) {
      sanitized += character
    }
  }

  return sanitized.trim()
}

export function createUniqueSlug(
  title: string,
  existingSlugs: Set<string>,
  fallback = 'untitled',
) {
  const base =
    sanitizeImportedText(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || fallback

  let slug = base
  let index = 2

  while (existingSlugs.has(slug)) {
    slug = `${base}-${index}`
    index += 1
  }

  return slug
}

/** @deprecated use {@link createUniqueSlug}. Retained for import flows. */
export function createImportSlug(title: string, existingSlugs: Set<string>) {
  return createUniqueSlug(title, existingSlugs, 'private-import')
}
