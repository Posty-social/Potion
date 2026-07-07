// Shared workspace domain types used by the D1 repository, server functions,
// the UI and the MCP server. These are the serialized shapes returned to the
// client (timestamps are ISO strings).
//
// The database model mirrors Notion: a database is a schema of typed
// `properties` plus a set of `rows` (each row is a page), displayed through one
// or more `views` (table / board / list / gallery), each with its own config.

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  initials: string
}

export type WorkspaceBlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'to_do'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'database'

export type WorkspaceBlock = {
  id: string
  type: WorkspaceBlockType
  content: string
  checked: boolean
  databaseId: string | null
  position: string
  version: number
}

// --- Database ------------------------------------------------------------

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'

/** Property types that carry a fixed set of selectable options. */
export const OPTION_PROPERTY_TYPES: PropertyType[] = [
  'select',
  'multi_select',
  'status',
]

export type PropertyOption = {
  id: string
  name: string
  color: string
}

export type DatabaseProperty = {
  id: string
  name: string
  type: PropertyType
  options?: PropertyOption[]
}

// A cell value depends on the property type:
// - title/text/url/date/person: string
// - number: number
// - checkbox: boolean
// - select/status: option id (string)
// - multi_select: option ids (string[])
export type CellValue = string | number | boolean | string[] | null

export type DatabaseRow = {
  id: string
  position: string
  values: Record<string, CellValue>
  pageId: string | null
}

export type DatabaseViewType =
  | 'table'
  | 'board'
  | 'list'
  | 'gallery'
  | 'calendar'

export type SortDirection = 'asc' | 'desc'

export type DatabaseSort = {
  propertyId: string
  direction: SortDirection
}

export type DatabaseFilter = {
  propertyId: string
  value: string
}

export type DatabaseView = {
  id: string
  name: string
  type: DatabaseViewType
  position: string
  /** Board grouping property (a select/status property). */
  groupByPropertyId: string | null
  /** Calendar date property. */
  datePropertyId: string | null
  /** Visible property ids; null means "all properties". Title is always shown. */
  visiblePropertyIds: string[] | null
  sorts: DatabaseSort[]
  filters: DatabaseFilter[]
}

export type WorkspaceDatabase = {
  id: string
  blockId: string
  title: string
  /** The single `title` property; its value is each row's name. */
  titlePropertyId: string
  properties: DatabaseProperty[]
  rows: DatabaseRow[]
  views: DatabaseView[]
}

// --- Pages ---------------------------------------------------------------

export type WorkspacePageSummary = {
  id: string
  slug: string
  title: string
  icon: string
  parentPageId: string | null
  position: string
  updatedAt: string
}

export type WorkspacePage = WorkspacePageSummary & {
  blocks: WorkspaceBlock[]
  databases: WorkspaceDatabase[]
  ancestors: WorkspacePageSummary[]
  childPages: WorkspacePageSummary[]
}

/** Palette for select / status / board-column option colors. */
export const FIELD_OPTION_COLORS = [
  '#dce8f2',
  '#dcebdd',
  '#f1dfbd',
  '#eadff0',
  '#f7d9cf',
  '#d9eeec',
  '#e6e2d6',
] as const

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  title: 'Title',
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  date: 'Date',
  person: 'Person',
  checkbox: 'Checkbox',
  url: 'URL',
}

export function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.trim()
  const parts = source.split(/\s+/).filter(Boolean)

  if (parts.length === 0) {
    return 'U'
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
