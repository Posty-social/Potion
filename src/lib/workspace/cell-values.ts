// Cell-value helpers shared by the MCP tools (strict normalization of agent
// input) and the UI (display of dates and multi-link url cells). Kept free of
// server-only imports so client components can use the display helpers.

import {
  COMPUTED_PROPERTY_TYPES,
  type CellValue,
  type DatabaseProperty,
} from './types'

/** A user-facing input problem; the MCP layer reports it as invalid input. */
export class CellValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CellValueError'
  }
}

export type MemberRef = { userId: string; name: string; email: string }

// --- URLs ----------------------------------------------------------------

/**
 * The links stored in a url cell. A cell holds one link per line (older cells
 * hold a single link); arrays are accepted too. Blank entries are dropped.
 */
export function splitUrls(value: CellValue | undefined): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\s+/)
      : []
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** True for absolute http(s) URLs — the only links rendered as anchors. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A short label for a link: GitHub PRs/issues become `owner/repo#123`,
 * anything else is its host + path without the scheme.
 */
export function linkLabel(value: string): string {
  try {
    const url = new URL(value)
    const github = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/,
    )
    if (url.hostname === 'github.com' && github) {
      return `${github[1]}/${github[2]}#${github[3]}`
    }
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}

// --- Dates ---------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/

/**
 * Parse a stored date cell as a *local* calendar date. Date cells are
 * date-only (`YYYY-MM-DD`); `new Date('2026-10-22')` would be UTC midnight and
 * render as the previous day west of UTC, so the parts are read directly.
 */
export function parseDateValue(value: CellValue | undefined): Date | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = value.trim().match(ISO_DATE)
  if (!match) {
    return null
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null
}

/** A date cell formatted for display, or the raw text if it isn't a date. */
export function formatDateValue(value: CellValue | undefined): string {
  const date = parseDateValue(value)
  if (!date) {
    return typeof value === 'string' ? value : ''
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** `YYYY-MM-DD` for a date `<input>`, tolerating stored ISO datetimes. */
export function dateInputValue(value: CellValue | undefined): string {
  return parseDateValue(value) && typeof value === 'string'
    ? value.trim().slice(0, 10)
    : ''
}

// --- Strict normalization for agent writes -------------------------------

function describeValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

function quoteList(values: string[]): string {
  return values.length > 0
    ? values.map((value) => `"${value}"`).join(', ')
    : '(none)'
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function resolveOption(
  property: DatabaseProperty,
  raw: unknown,
  addOptionHint: string,
): string {
  const options = property.options ?? []
  if (typeof raw !== 'string') {
    throw new CellValueError(
      `Column "${property.name}" (${property.id}) expects an option id or name, got ${describeValue(raw)}.`,
    )
  }
  const value = raw.trim()
  const byId = options.find((option) => option.id === value)
  if (byId) {
    return byId.id
  }
  const byName = options.find(
    (option) => option.name.trim().toLowerCase() === value.toLowerCase(),
  )
  if (byName) {
    return byName.id
  }
  throw new CellValueError(
    `Column "${property.name}" (${property.id}) has no option "${value}". Options: ${quoteList(
      options.map((option) => option.name),
    )}. ${addOptionHint}`,
  )
}

function resolvePerson(
  property: DatabaseProperty,
  raw: unknown,
  members: MemberRef[],
): string {
  if (typeof raw !== 'string') {
    throw new CellValueError(
      `Column "${property.name}" (${property.id}) expects user ids, emails or names, got ${describeValue(raw)}.`,
    )
  }
  const value = raw.trim()
  const lower = value.toLowerCase()
  const byName = members.filter(
    (candidate) => candidate.name.trim().toLowerCase() === lower,
  )
  const member =
    members.find((candidate) => candidate.userId === value) ??
    members.find((candidate) => candidate.email.toLowerCase() === lower) ??
    (byName.length === 1 ? byName[0] : undefined)
  if (!member) {
    throw new CellValueError(
      byName.length > 1
        ? `Column "${property.name}" (${property.id}): ${byName.length} members are named "${value}". Use their user id or email from list_members.`
        : `Column "${property.name}" (${property.id}): no workspace member matches "${value}". Use a user id, email or name from list_members.`,
    )
  }
  return member.userId
}

/** Normalize one agent-supplied value for a column, or throw a clear error. */
export function normalizeCellValue(
  property: DatabaseProperty,
  raw: unknown,
  context: {
    members: MemberRef[]
    // How to add a missing option, appended to "no such option" errors.
    addOptionHint: string
  },
): CellValue {
  const label = `Column "${property.name}" (${property.id})`

  if (COMPUTED_PROPERTY_TYPES.includes(property.type)) {
    throw new CellValueError(
      `${label} is a computed ${property.type} column and cannot be set.`,
    )
  }

  if (isEmpty(raw)) {
    return null
  }

  switch (property.type) {
    case 'select':
    case 'status':
      return resolveOption(property, raw, context.addOptionHint)
    case 'multi_select': {
      const items = Array.isArray(raw) ? raw : [raw]
      return [
        ...new Set(
          items.map((item) =>
            resolveOption(property, item, context.addOptionHint),
          ),
        ),
      ]
    }
    case 'person': {
      const items = Array.isArray(raw) ? raw : [raw]
      return [
        ...new Set(
          items.map((item) => resolvePerson(property, item, context.members)),
        ),
      ]
    }
    case 'number': {
      const parsed = typeof raw === 'string' ? Number(raw.trim()) : raw
      if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
        throw new CellValueError(
          `${label} expects a number, got ${describeValue(raw)}.`,
        )
      }
      return parsed
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') {
        return raw
      }
      if (raw === 'true' || raw === 'false') {
        return raw === 'true'
      }
      throw new CellValueError(
        `${label} expects true or false, got ${describeValue(raw)}.`,
      )
    }
    case 'date': {
      if (typeof raw !== 'string' || !parseDateValue(raw)) {
        throw new CellValueError(
          `${label} expects an ISO date like "2026-10-22" (or null to clear), got ${describeValue(raw)}.`,
        )
      }
      // Date columns are date-only; keep the calendar date as written.
      return raw.trim().slice(0, 10)
    }
    case 'url': {
      if (
        typeof raw !== 'string' &&
        !(Array.isArray(raw) && raw.every((item) => typeof item === 'string'))
      ) {
        throw new CellValueError(
          `${label} expects a URL, several URLs (one per line), or an array of URLs.`,
        )
      }
      const urls = splitUrls(raw)
      const invalid = urls.filter((url) => !isHttpUrl(url))
      if (invalid.length > 0) {
        throw new CellValueError(
          `${label} only accepts http(s) URLs; invalid: ${quoteList(invalid)}.`,
        )
      }
      return urls.length > 0 ? [...new Set(urls)].join('\n') : null
    }
    default: {
      // title / text / email / phone / page
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return String(raw)
      }
      if (typeof raw !== 'string') {
        throw new CellValueError(
          `${label} expects a string, got ${describeValue(raw)}.`,
        )
      }
      return raw
    }
  }
}

/**
 * Normalize an agent's `values` map for a database. Keys may be column ids or
 * column names (case-insensitive); select/status/multi_select accept option
 * names; person accepts user ids, emails or unique names; dates must be ISO;
 * url columns take several links. Throws `CellValueError` naming the column.
 */
export function normalizeRowValues(input: {
  databaseId: string
  properties: DatabaseProperty[]
  values: Record<string, unknown>
  members: MemberRef[]
}): Record<string, CellValue> {
  const result: Record<string, CellValue> = {}

  for (const [key, raw] of Object.entries(input.values)) {
    const property = resolveColumn(input.properties, key, input.databaseId)

    result[property.id] = normalizeCellValue(property, raw, {
      members: input.members,
      addOptionHint: `Add it first with add_database_option (databaseId "${input.databaseId}", propertyId "${property.id}").`,
    })
  }

  return result
}

// --- Column lookup, filters and readable values (MCP reads) --------------

/** A column by id or (case-insensitive) name, or a clear error. */
export function resolveColumn(
  properties: DatabaseProperty[],
  key: string,
  databaseId: string,
): DatabaseProperty {
  const property =
    properties.find((candidate) => candidate.id === key) ??
    properties.find(
      (candidate) =>
        candidate.name.trim().toLowerCase() === key.trim().toLowerCase(),
    )

  if (!property) {
    throw new CellValueError(
      `Database "${databaseId}" has no column "${key}". Columns: ${properties
        .map((candidate) => `"${candidate.name}" (${candidate.id})`)
        .join(', ')}.`,
    )
  }

  return property
}

/**
 * One `where` condition for a database read, already resolved to ids. Values
 * within a condition are alternatives (OR); conditions combine with AND.
 * - equals: the cell is one of the values (select, status, date, number, …)
 * - includes: the cell (an array) contains one of the values (multi_select,
 *   person)
 * - contains: the cell's text contains one of the values, case-insensitively
 *   (title, text, url, email, phone)
 * - empty: the cell is unset, empty text or an empty list
 */
export type RowCondition = {
  propertyId: string
  mode: 'equals' | 'includes' | 'contains' | 'empty'
  values: Array<string | number | boolean>
}

const TEXT_TYPES = new Set(['title', 'text', 'url', 'email', 'phone'])

/**
 * Turn an agent's `where` map (keys: column ids or names; values: a value, a
 * list of alternatives, or null for "empty") into row conditions, resolving
 * option names, member emails/names and ISO dates exactly like writes do.
 */
export function buildRowConditions(input: {
  databaseId: string
  properties: DatabaseProperty[]
  where: Record<string, unknown>
  members: MemberRef[]
}): RowCondition[] {
  return Object.entries(input.where).map(([key, raw]) => {
    const property = resolveColumn(input.properties, key, input.databaseId)

    if (COMPUTED_PROPERTY_TYPES.includes(property.type)) {
      throw new CellValueError(
        `Column "${property.name}" (${property.id}) is computed and can't be filtered on.`,
      )
    }
    if (isEmpty(raw)) {
      return { propertyId: property.id, mode: 'empty', values: [] }
    }

    const items = Array.isArray(raw) ? raw : [raw]

    if (TEXT_TYPES.has(property.type)) {
      return {
        propertyId: property.id,
        mode: 'contains',
        values: items.map((item) => String(item)),
      }
    }

    const context = {
      members: input.members,
      addOptionHint: `It has to exist before you can filter on it.`,
    }
    const values = items.flatMap((item) => {
      const value = normalizeCellValue(property, item, context)
      return Array.isArray(value) ? value : value === null ? [] : [value]
    })

    return {
      propertyId: property.id,
      mode:
        property.type === 'multi_select' || property.type === 'person'
          ? 'includes'
          : 'equals',
      values,
    }
  })
}

type ReadableValue =
  | CellValue
  | Array<{ id: string; name: string; email: string } | string>

/**
 * A row's cells keyed by column name with human values: option names instead
 * of ids, people as { id, name, email }, url cells as a list of links, and
 * created/last-edited times filled in. Duplicate column names get their id
 * appended so no cell is lost.
 */
export function valuesByName(input: {
  properties: DatabaseProperty[]
  row: {
    values: Record<string, CellValue>
    createdAt: string
    updatedAt: string
  }
  members: MemberRef[]
}): Record<string, ReadableValue> {
  const result: Record<string, ReadableValue> = {}
  const seen = new Set<string>()

  for (const property of input.properties) {
    const label = seen.has(property.name)
      ? `${property.name} (${property.id})`
      : property.name
    seen.add(property.name)

    const value =
      property.type === 'created_time'
        ? input.row.createdAt
        : property.type === 'last_edited_time'
          ? input.row.updatedAt
          : input.row.values[property.id]

    if (value === undefined || value === null) {
      result[label] = null
      continue
    }

    const optionName = (id: string) =>
      property.options?.find((option) => option.id === id)?.name ?? id

    switch (property.type) {
      case 'select':
      case 'status':
        result[label] = typeof value === 'string' ? optionName(value) : value
        break
      case 'multi_select':
        result[label] = Array.isArray(value) ? value.map(optionName) : value
        break
      case 'person': {
        const ids = Array.isArray(value) ? value : [String(value)]
        result[label] = ids.map((id) => {
          const member = input.members.find((m) => m.userId === id)
          return member
            ? { id, name: member.name, email: member.email }
            : { id, name: id, email: '' }
        })
        break
      }
      case 'url':
        result[label] = splitUrls(value)
        break
      default:
        result[label] = value
    }
  }

  return result
}
