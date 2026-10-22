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
