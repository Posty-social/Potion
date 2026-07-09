// Shared workspace domain types used by the D1 repository, server functions,
// the UI and the MCP server. These are the serialized shapes returned to the
// client (timestamps are ISO strings).
//
// The database model mirrors Notion: a database is a schema of typed
// `properties` plus a set of `rows` (each row is a page), displayed through one
// or more `views` (table / board / list / gallery), each with its own config.
//
// Leaf enums are inferred from the Zod schemas in `schemas.ts` — those validate
// the same values at runtime, so deriving the types keeps them from drifting.
// The composite shapes below stay explicit: they narrow the loose DB JSON
// (`CollectionField`, `JsonRecord`, `Date`) into the precise client contract,
// which the repository casts *into* — inferring them from it would be circular.

import type { z } from 'zod'

import type {
  blockTypeSchema,
  cellValueSchema,
  propertyTypeSchema,
  sortDirectionSchema,
  viewTypeSchema,
} from './schemas'

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  initials: string
}

export type WorkspaceBlockType = z.infer<typeof blockTypeSchema>

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

// `title` is implicit on every database and never a user-choosable type, so it
// lives outside `propertyTypeSchema` (which validates addable types) and is
// unioned back in here.
export type PropertyType = 'title' | z.infer<typeof propertyTypeSchema>

/** Property types that carry a fixed set of selectable options. */
export const OPTION_PROPERTY_TYPES: PropertyType[] = [
  'select',
  'multi_select',
  'status',
]

/**
 * Read-only property types whose value is derived from the row's own record
 * (its timestamps), not stored in `values` and not user-editable.
 */
export const COMPUTED_PROPERTY_TYPES: PropertyType[] = [
  'created_time',
  'last_edited_time',
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
// - title/text/url/email/phone/date/person: string
// - number: number
// - checkbox: boolean
// - select/status: option id (string)
// - multi_select: option ids (string[])
export type CellValue = z.infer<typeof cellValueSchema>

export type DatabaseRow = {
  id: string
  position: string
  values: Record<string, CellValue>
  /** Markdown body for the row's page, shown in the side peek. */
  body: string | null
  /** ISO timestamps, surfaced for created_time / last_edited_time properties. */
  createdAt: string
  updatedAt: string
  pageId: string | null
}

export type DatabaseViewType = z.infer<typeof viewTypeSchema>

export type SortDirection = z.infer<typeof sortDirectionSchema>

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
  createdAt: string
  updatedAt: string
}

export type WorkspacePage = WorkspacePageSummary & {
  blocks: WorkspaceBlock[]
  databases: WorkspaceDatabase[]
  ancestors: WorkspacePageSummary[]
  childPages: WorkspacePageSummary[]
  /** Page-level properties (Notion-style, shown at the top of the page). */
  properties: DatabaseProperty[]
  propertyValues: Record<string, CellValue>
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
  email: 'Email',
  phone: 'Phone',
  page: 'Page link',
  created_time: 'Created time',
  last_edited_time: 'Last edited time',
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
