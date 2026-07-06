import { describe, expect, it } from 'vitest'

import { isWorkspaceAuthRequired } from './access'
import { getPage, listPages } from './mock-data'
import {
  WorkspaceRepositoryError,
  createSeedWorkspaceRepository,
} from './repository'
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

  it('returns cloned pages from the repository', async () => {
    const repository = createSeedWorkspaceRepository()
    const page = await repository.getPage('private-workspace')

    expect(page?.blocks[0]?.content).toBe('Private workspace')

    if (page) {
      page.blocks[0].content = 'Mutated outside repository'
    }

    const freshPage = await repository.getPage('private-workspace')

    expect(freshPage?.blocks[0]?.content).toBe('Private workspace')
  })

  it('updates blocks through a version-checked repository method', async () => {
    const repository = createSeedWorkspaceRepository()
    const update = await repository.updateBlock({
      pageId: 'page_private_workspace',
      blockId: 'block_summary',
      content: 'Updated summary',
      version: 1,
    })

    expect(update).toMatchObject({
      ok: true,
      pageId: 'page_private_workspace',
      blockId: 'block_summary',
      content: 'Updated summary',
      version: 2,
    })
    await expect(
      repository.getPage('private-workspace'),
    ).resolves.toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          id: 'block_summary',
          content: 'Updated summary',
        }),
      ]),
    })
  })

  it('fails closed for stale block versions', async () => {
    const repository = createSeedWorkspaceRepository()

    await expect(
      repository.updateBlock({
        pageId: 'page_private_workspace',
        blockId: 'block_summary',
        content: 'Stale update',
        version: 2,
      }),
    ).rejects.toMatchObject(
      new WorkspaceRepositoryError(
        'version_conflict',
        'Workspace block has changed since it was loaded.',
      ),
    )
  })
})

describe('workspace input validation', () => {
  it('parses the auth gate flag explicitly', () => {
    expect(isWorkspaceAuthRequired()).toBe(false)
    expect(isWorkspaceAuthRequired('false')).toBe(false)
    expect(isWorkspaceAuthRequired('0')).toBe(false)
    expect(isWorkspaceAuthRequired('true')).toBe(true)
    expect(isWorkspaceAuthRequired('yes')).toBe(true)
    expect(isWorkspaceAuthRequired('ON')).toBe(true)
  })

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
