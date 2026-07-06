import { describe, expect, it } from 'vitest'

import {
  assetUploadIntentSchema,
  buildR2AssetKey,
  missingR2SigningVariables,
  sanitizeAssetFileName,
} from '../assets/intents'
import { isWorkspaceAuthRequired } from './access'
import { createImportSlug, sanitizeImportedText } from './import'
import { getPage, listPages } from './mock-data'
import {
  WorkspaceRepositoryError,
  createSeedWorkspaceRepository,
} from './repository'
import {
  getPageSchema,
  importPrivateChatSchema,
  pageSearchSchema,
  updateBlockSchema,
} from './schemas'
import { createPublicLinkToken, isPublicLinkToken } from './share'

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

  it('imports sanitized private chats with public links disabled', async () => {
    const repository = createSeedWorkspaceRepository()
    const imported = await repository.importPrivateChat({
      title: 'Housing Notes',
      transcript: 'Deb\r\n\x00Aimee',
      source: 'Notion reference',
    })

    expect(imported).toMatchObject({
      slug: 'housing-notes',
      title: 'Housing Notes',
    })

    const page = await repository.getPage('housing-notes')

    expect(page?.share).toMatchObject({
      publicEnabled: false,
      includeChildren: false,
      tokenPreview: 'pub_disabled',
    })
    expect(page?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'quote',
          content: 'Deb\nAimee',
          properties: { source: 'Notion reference' },
        }),
      ]),
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

  it('sanitizes private import input before repository use', () => {
    expect(sanitizeImportedText('  one\r\ntwo\x00  ')).toBe('one\ntwo')
    expect(
      importPrivateChatSchema.parse({
        title: '  Exported chat  ',
        transcript: '  Line one\r\nLine two  ',
      }),
    ).toEqual({
      title: 'Exported chat',
      transcript: 'Line one\nLine two',
    })
  })

  it('deduplicates private import slugs', () => {
    expect(createImportSlug('Housing Notes', new Set(['housing-notes']))).toBe(
      'housing-notes-2',
    )
    expect(createImportSlug('!@#', new Set())).toBe('private-import')
  })

  it('validates token-shaped public links', () => {
    const token = createPublicLinkToken('12345678-90ab-cdef-1234-567890abcdef')

    expect(token).toBe('pub_1234567890abcdef1234567890abcdef')
    expect(isPublicLinkToken(token)).toBe(true)
    expect(isPublicLinkToken('pub_disabled')).toBe(false)
  })

  it('validates R2 asset upload intents and sanitized keys', () => {
    expect(
      assetUploadIntentSchema.safeParse({
        fileName: 'notes.png',
        mime: 'image/png',
        sizeBytes: 1024,
      }).success,
    ).toBe(true)
    expect(
      assetUploadIntentSchema.safeParse({
        fileName: 'large.bin',
        mime: 'application/octet-stream',
        sizeBytes: 51 * 1024 * 1024,
      }).success,
    ).toBe(false)
    expect(sanitizeAssetFileName(' private/chat?.png ')).toBe(
      'private-chat-.png',
    )
    expect(
      buildR2AssetKey({
        assetId: 'asset_123',
        fileName: ' private/chat?.png ',
      }),
    ).toBe('assets/asset_123/private-chat-.png')
    expect(
      missingR2SigningVariables({
        CLOUDFLARE_ACCOUNT_ID: 'account',
        R2_BUCKET_NAME: 'bucket',
      }),
    ).toEqual(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
  })
})
