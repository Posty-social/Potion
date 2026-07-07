import { describe, expect, it } from 'vitest'

import {
  assetUploadIntentSchema,
  buildR2AssetKey,
  missingR2SigningVariables,
  sanitizeAssetFileName,
} from '../assets/intents'
import { createUniqueSlug, sanitizeImportedText } from './import'
import { generateKeyBetween, keyAtEnd } from './ordering'
import {
  cellValuesSchema,
  createPageSchema,
  getPageSchema,
  importTextSchema,
  updateBlockSchema,
} from './schemas'
import { createPublicLinkToken, isPublicLinkToken } from './share'
import { initialsFor } from './types'

describe('workspace ordering', () => {
  it('generates keys that sort in insertion order', () => {
    const first = generateKeyBetween(null, null)
    const second = generateKeyBetween(first, null)
    const between = generateKeyBetween(first, second)

    expect(first < second).toBe(true)
    expect(first < between).toBe(true)
    expect(between < second).toBe(true)
  })

  it('appends after the largest existing key', () => {
    const a = generateKeyBetween(null, null)
    const b = generateKeyBetween(a, null)
    const end = keyAtEnd([b, a])

    expect(end > a).toBe(true)
    expect(end > b).toBe(true)
  })

  it('starts a fresh sequence when there are no keys', () => {
    expect(keyAtEnd([])).toBe(generateKeyBetween(null, null))
  })
})

describe('workspace input validation', () => {
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

  it('requires a title when creating a page', () => {
    expect(createPageSchema.safeParse({ title: 'Notes' }).success).toBe(true)
    expect(createPageSchema.safeParse({ title: '' }).success).toBe(false)
    expect(
      createPageSchema.safeParse({ title: 'Child', parentPageId: 'page_1' })
        .success,
    ).toBe(true)
  })

  it('caps edited block content length', () => {
    expect(
      updateBlockSchema.safeParse({
        pageId: 'page_1',
        blockId: 'block_1',
        content: 'Safe update',
        version: 1,
      }).success,
    ).toBe(true)

    expect(
      updateBlockSchema.safeParse({
        pageId: 'page_1',
        blockId: 'block_1',
        content: 'x'.repeat(20_001),
        version: 1,
      }).success,
    ).toBe(false)
  })

  it('validates collection cell values', () => {
    expect(
      cellValuesSchema.safeParse({ f1: 'text', f2: 3, f3: true, f4: null })
        .success,
    ).toBe(true)
    expect(cellValuesSchema.safeParse({ f1: ['a', 'b'] }).success).toBe(true)
    expect(cellValuesSchema.safeParse({ f1: { nested: true } }).success).toBe(
      false,
    )
  })

  it('sanitizes imported text before use', () => {
    expect(sanitizeImportedText('  one\r\ntwo\x00  ')).toBe('one\ntwo')
    expect(
      importTextSchema.parse({
        title: '  Exported chat  ',
        body: '  Line one\r\nLine two  ',
      }),
    ).toEqual({
      title: 'Exported chat',
      body: 'Line one\nLine two',
    })
  })

  it('deduplicates page slugs', () => {
    expect(createUniqueSlug('Housing Notes', new Set(['housing-notes']))).toBe(
      'housing-notes-2',
    )
    expect(createUniqueSlug('!@#', new Set())).toBe('untitled')
  })

  it('validates token-shaped public links', () => {
    const token = createPublicLinkToken('12345678-90ab-cdef-1234-567890abcdef')

    expect(token).toBe('pub_1234567890abcdef1234567890abcdef')
    expect(isPublicLinkToken(token)).toBe(true)
    expect(isPublicLinkToken('pub_disabled')).toBe(false)
  })

  it('derives user initials', () => {
    expect(initialsFor('Ada Lovelace', 'ada@example.com')).toBe('AL')
    expect(initialsFor('', 'grace@example.com')).toBe('GR')
    expect(initialsFor('Mononym', 'm@example.com')).toBe('MO')
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
