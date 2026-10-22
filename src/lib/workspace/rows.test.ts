import { describe, expect, it } from 'vitest'

import { filterRows } from './rows'
import type { DatabaseProperty, DatabaseRow } from './types'

const status: DatabaseProperty = {
  id: 'prop_status',
  name: 'Status',
  type: 'status',
  options: [
    { id: 'opt_todo', name: 'To do', color: '#dce8f2' },
    { id: 'opt_done', name: 'Done', color: '#dcebdd' },
  ],
}
const byId = new Map([[status.id, status]])

function row(id: string, done: boolean, isArchived = false): DatabaseRow {
  return {
    id,
    position: id,
    values: { prop_status: done ? 'opt_done' : 'opt_todo' },
    body: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    pageId: null,
    isArchived,
    archivedAt: isArchived ? new Date(0).toISOString() : null,
  }
}

const rows = [row('a', false), row('b', true), row('c', true, true)]
const ids = (list: DatabaseRow[]) => list.map((r) => r.id)

describe('archive filtering', () => {
  it('hides archived rows by default', () => {
    expect(
      ids(filterRows(rows, { filters: [], byId, showArchived: false })),
    ).toEqual(['a', 'b'])
  })

  it('shows archived rows when the view opts in', () => {
    expect(
      ids(filterRows(rows, { filters: [], byId, showArchived: true })),
    ).toEqual(['a', 'b', 'c'])
  })

  it('applies view filters on top of the archive filter', () => {
    const filters = [{ propertyId: 'prop_status', value: 'opt_done' }]

    expect(
      ids(filterRows(rows, { filters, byId, showArchived: false })),
    ).toEqual(['b'])
    expect(
      ids(filterRows(rows, { filters, byId, showArchived: true })),
    ).toEqual(['b', 'c'])
  })
})
