import { describe, expect, it } from 'vitest'

import {
  CellValueError,
  buildRowConditions,
  valuesByName,
  dateInputValue,
  formatDateValue,
  linkLabel,
  normalizeCellValue,
  parseDateValue,
  splitUrls,
} from './cell-values'
import { optionColorSchema } from './schemas'
import {
  FIELD_OPTION_COLORS,
  nextOptionColor,
  resolveOptionColor,
  type DatabaseProperty,
} from './types'

describe('date cells', () => {
  it('parses a stored date as the same local calendar day', () => {
    // new Date('2026-11-03') is UTC midnight, i.e. Nov 2 west of UTC; the
    // stored calendar date must survive whatever the viewer's timezone is.
    const date = parseDateValue('2026-11-03')
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([
      2026, 10, 3,
    ])
    expect(formatDateValue('2026-11-03')).toContain('3')
  })

  it('tolerates datetimes and rejects impossible dates', () => {
    expect(parseDateValue('2026-11-03T23:30:00-08:00')?.getDate()).toBe(3)
    expect(dateInputValue('2026-11-03T23:30:00Z')).toBe('2026-11-03')
    expect(parseDateValue('2026-02-30')).toBeNull()
    expect(parseDateValue('soon')).toBeNull()
    expect(dateInputValue(null)).toBe('')
  })
})

describe('url cells', () => {
  it('splits newline-separated and array values', () => {
    expect(splitUrls('https://a.test\n\n https://b.test ')).toEqual([
      'https://a.test',
      'https://b.test',
    ])
    expect(splitUrls(['https://a.test', ''])).toEqual(['https://a.test'])
    expect(splitUrls(null)).toEqual([])
  })

  it('labels GitHub PRs compactly', () => {
    expect(linkLabel('https://github.com/posty/app/pull/42')).toBe(
      'posty/app#42',
    )
    expect(linkLabel('https://example.com/docs')).toBe('example.com/docs')
  })
})

describe('normalizeCellValue', () => {
  const context = { members: [], addOptionHint: '' }

  it('refuses to write computed columns', () => {
    const created: DatabaseProperty = {
      id: 'prop_created',
      name: 'Created',
      type: 'created_time',
    }
    expect(() => normalizeCellValue(created, 'x', context)).toThrow(
      CellValueError,
    )
  })

  it('coerces numbers and checkboxes from strings', () => {
    expect(
      normalizeCellValue({ id: 'n', name: 'N', type: 'number' }, '42', context),
    ).toBe(42)
    expect(
      normalizeCellValue(
        { id: 'c', name: 'C', type: 'checkbox' },
        'true',
        context,
      ),
    ).toBe(true)
    expect(() =>
      normalizeCellValue(
        { id: 'n', name: 'N', type: 'number' },
        'lots',
        context,
      ),
    ).toThrow(/expects a number/)
  })
})

describe('option colours', () => {
  it('resolves palette names and hex values', () => {
    expect(resolveOptionColor('Green')).toBe('#dcebdd')
    expect(resolveOptionColor('grey')).toBe('#e6e2d6')
    expect(resolveOptionColor('#DCE8F2')).toBe('#dce8f2')
    expect(resolveOptionColor('#ff0000')).toBeNull()
    expect(optionColorSchema.safeParse('magenta').success).toBe(false)
  })

  it('picks the first unused colour, then cycles', () => {
    expect(nextOptionColor([])).toBe(FIELD_OPTION_COLORS[0])
    expect(nextOptionColor([{ color: FIELD_OPTION_COLORS[0] }])).toBe(
      FIELD_OPTION_COLORS[1],
    )
    // After deleting the first option the gap is reused, not duplicated.
    expect(nextOptionColor([{ color: FIELD_OPTION_COLORS[1] }])).toBe(
      FIELD_OPTION_COLORS[0],
    )
    const full = FIELD_OPTION_COLORS.map((color) => ({ color }))
    expect(nextOptionColor(full)).toBe(FIELD_OPTION_COLORS[0])
  })
})

describe('buildRowConditions', () => {
  const properties: DatabaseProperty[] = [
    { id: 'prop_title', name: 'Name', type: 'title' },
    {
      id: 'prop_status',
      name: 'Status',
      type: 'status',
      options: [{ id: 'opt_done', name: 'Done', color: '#dcebdd' }],
    },
    { id: 'prop_owner', name: 'Owner', type: 'person' },
    { id: 'prop_flag', name: 'Flag', type: 'checkbox' },
    { id: 'prop_created', name: 'Created', type: 'created_time' },
  ]
  const build = (where: Record<string, unknown>) =>
    buildRowConditions({
      databaseId: 'database_1',
      properties,
      where,
      members: [{ userId: 'user_ada', name: 'Ada', email: 'ada@x.y' }],
    })

  it('resolves names to ids and picks the match mode per column type', () => {
    expect(
      build({ status: 'done', Owner: 'ada@x.y', Name: 'bug', Flag: 'true' }),
    ).toEqual([
      { propertyId: 'prop_status', mode: 'equals', values: ['opt_done'] },
      { propertyId: 'prop_owner', mode: 'includes', values: ['user_ada'] },
      { propertyId: 'prop_title', mode: 'contains', values: ['bug'] },
      { propertyId: 'prop_flag', mode: 'equals', values: [true] },
    ])
    expect(build({ Owner: null })).toEqual([
      { propertyId: 'prop_owner', mode: 'empty', values: [] },
    ])
  })

  it('rejects unknown columns and computed columns', () => {
    expect(() => build({ Priority: 'high' })).toThrow(/has no column/)
    expect(() => build({ Created: '2026-01-01' })).toThrow(/computed/)
  })
})

describe('valuesByName', () => {
  it('keys cells by name and keeps duplicate names apart', () => {
    const out = valuesByName({
      properties: [
        { id: 'a', name: 'Notes', type: 'text' },
        { id: 'b', name: 'Notes', type: 'text' },
        { id: 'c', name: 'Created', type: 'created_time' },
      ],
      row: {
        values: { a: 'one', b: 'two' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      members: [],
    })
    expect(out).toEqual({
      Notes: 'one',
      'Notes (b)': 'two',
      Created: '2026-01-01T00:00:00.000Z',
    })
  })
})
