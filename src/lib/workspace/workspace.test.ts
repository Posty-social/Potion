import { describe, expect, it } from 'vitest'

import { getPage, listPages } from './mock-data'
import { getPageSchema, pageSearchSchema, updateBlockSchema } from './schemas'

describe('workspace data safety', () => {
  it('lists summaries without block content', () => {
    const summaries = listPages()

    expect(summaries.length).toBeGreaterThan(0)
    expect(summaries[0]).not.toHaveProperty('blocks')
    expect(summaries.some((page) => page.slug === 'private-workspace')).toBe(
      true,
    )
  })

  it('does not fall back to the private workspace for unknown slugs', () => {
    expect(getPage('private-workspace')?.title).toBe('Private workspace')
    expect(getPage('missing-page')).toBeUndefined()
  })
})

describe('workspace input validation', () => {
  it('defaults invalid collection views to table', () => {
    expect(pageSearchSchema.parse({ view: 'board' }).view).toBe('table')
    expect(pageSearchSchema.parse({}).view).toBe('table')
  })

  it('accepts only simple page slugs', () => {
    expect(
      getPageSchema.safeParse({ slug: 'deployment-handoff' }).success,
    ).toBe(true)
    expect(
      getPageSchema.safeParse({ slug: '../private-workspace' }).success,
    ).toBe(false)
    expect(getPageSchema.safeParse({ slug: 'Private Workspace' }).success).toBe(
      false,
    )
  })

  it('caps edited block content length', () => {
    expect(
      updateBlockSchema.safeParse({
        pageId: 'page_private_workspace',
        blockId: 'block_summary',
        content: 'Safe update',
        version: 1,
      }).success,
    ).toBe(true)

    expect(
      updateBlockSchema.safeParse({
        pageId: 'page_private_workspace',
        blockId: 'block_summary',
        content: 'x'.repeat(20_001),
        version: 1,
      }).success,
    ).toBe(false)
  })
})
