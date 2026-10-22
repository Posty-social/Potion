// Which database rows a view shows. Shared by the UI views and unit tests.

import type { DatabaseFilter, DatabaseProperty, DatabaseRow } from './types'

export function matchesFilter(
  row: DatabaseRow,
  filter: DatabaseFilter,
  property: DatabaseProperty,
): boolean {
  if (!filter.value) {
    return true
  }
  const value = row.values[filter.propertyId]

  if (property.type === 'select' || property.type === 'status') {
    return value === filter.value
  }
  if (property.type === 'multi_select') {
    return Array.isArray(value) && value.includes(filter.value)
  }
  if (property.type === 'checkbox') {
    return String(value === true) === filter.value
  }
  return String(value ?? '')
    .toLowerCase()
    .includes(filter.value.toLowerCase())
}

/**
 * The rows a view shows: archived rows are dropped unless the view has "Show
 * archived" on, then the view's filters apply.
 */
export function filterRows(
  rows: DatabaseRow[],
  options: {
    filters: DatabaseFilter[]
    byId: Map<string, DatabaseProperty>
    showArchived: boolean
  },
): DatabaseRow[] {
  return rows.filter(
    (row) =>
      (options.showArchived || !row.isArchived) &&
      options.filters.every((filter) => {
        const property = options.byId.get(filter.propertyId)
        return property ? matchesFilter(row, filter, property) : true
      }),
  )
}

/**
 * Split a view's rows into active and archived, keeping order. With "Show
 * archived" on, archived rows render in their own list (an Archived board
 * column, or a section below the table) rather than back among the active
 * rows they were grouped with.
 */
export function splitArchived(rows: DatabaseRow[]): {
  active: DatabaseRow[]
  archived: DatabaseRow[]
} {
  const active: DatabaseRow[] = []
  const archived: DatabaseRow[] = []
  for (const row of rows) {
    ;(row.isArchived ? archived : active).push(row)
  }
  return { active, archived }
}
